import type { PrismaClient } from '../generated/prisma/client';
import { InvalidCredentialsError, InvalidSessionError } from '../errors/AppError';
import { normalizeUsername } from '../utils/username';
import { verifyAgainstDummy, verifyPassword } from './password';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  type AccessTokenClaims,
} from './tokens';
import { accessTokenSecret, accessTokenTtlSeconds, refreshTokenTtlSeconds } from './config';
import { recordAuditLog, recordAuditLogSafe } from './auditLog';

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface PublicUser {
  id: string;
  username: string;
  role: 'ADMIN' | 'EMPLOYEE';
  status: string;
  employee: { id: string; displayName: string; colorHex: string } | null;
}

export interface LoginResult {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshToken: string;
  refreshTokenTtlSeconds: number;
  user: PublicUser;
}

function toPublicUser(user: {
  id: string;
  username: string;
  role: 'ADMIN' | 'EMPLOYEE';
  status: string;
  employee: { id: string; displayName: string; colorHex: string } | null;
}): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    employee: user.employee,
  };
}

const USER_SELECT_FOR_AUTH = {
  id: true,
  username: true,
  role: true,
  status: true,
  passwordHash: true,
  employee: { select: { id: true, displayName: true, colorHex: true } },
} as const;

async function issueSession(
  prisma: PrismaClient,
  params: { userId: string; role: 'ADMIN' | 'EMPLOYEE' } & RequestMeta,
): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const session = await prisma.session.create({
    data: {
      userId: params.userId,
      refreshTokenHash,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      expiresAt: new Date(Date.now() + refreshTokenTtlSeconds * 1000),
    },
    select: { id: true },
  });

  const claims: AccessTokenClaims = {
    userId: params.userId,
    sessionId: session.id,
    role: params.role,
  };
  const accessToken = await signAccessToken(claims, accessTokenSecret, accessTokenTtlSeconds);

  return { accessToken, refreshToken, sessionId: session.id };
}

/**
 * Login — sin distinguir en la respuesta usuario inexistente, contraseña
 * incorrecta, o estado no ACTIVE: siempre `InvalidCredentialsError` (evita
 * enumeración de cuentas). Cuando el usuario no existe o no tiene
 * `passwordHash` todavía (PENDING_ACTIVATION), se verifica igual contra un
 * hash dummy para no delatar la diferencia por tiempo de respuesta.
 */
export async function login(
  prisma: PrismaClient,
  params: { username: string; password: string } & RequestMeta,
): Promise<LoginResult> {
  const normalizedUsername = normalizeUsername(params.username);
  const user = await prisma.user.findUnique({
    where: { username: normalizedUsername },
    select: USER_SELECT_FOR_AUTH,
  });

  if (!user || user.status !== 'ACTIVE' || !user.passwordHash) {
    await verifyAgainstDummy(params.password);
    await recordAuditLogSafe(prisma, {
      actorUserId: user?.id ?? null,
      action: 'auth.login.failed',
      entityType: 'User',
      entityId: user?.id ?? normalizedUsername,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    throw new InvalidCredentialsError();
  }

  const passwordValid = await verifyPassword(user.passwordHash, params.password);
  if (!passwordValid) {
    await recordAuditLogSafe(prisma, {
      actorUserId: user.id,
      action: 'auth.login.failed',
      entityType: 'User',
      entityId: user.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    throw new InvalidCredentialsError();
  }

  const { accessToken, refreshToken, sessionId } = await issueSession(prisma, {
    userId: user.id,
    role: user.role,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  await recordAuditLogSafe(prisma, {
    actorUserId: user.id,
    action: 'auth.login.success',
    entityType: 'Session',
    entityId: sessionId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  return {
    accessToken,
    accessTokenExpiresInSeconds: accessTokenTtlSeconds,
    refreshToken,
    refreshTokenTtlSeconds,
    user: toPublicUser(user),
  };
}

export interface RefreshResult {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshToken: string;
  refreshTokenTtlSeconds: number;
}

type RotationOutcome =
  | { kind: 'invalid' }
  | {
      kind: 'rotated';
      accessToken: string;
      refreshToken: string;
      previousSessionId: string;
      newSessionId: string;
      userId: string;
    };

/**
 * Rotación transaccional: revocar la sesión vieja y crear la nueva deben
 * confirmarse juntas o ninguna. Ningún camino lanza dentro del callback de
 * `$transaction` — Prisma revierte TODA la transacción ante cualquier
 * excepción del callback, y la detección de reuso necesita que su efecto de
 * seguridad (revocar todas las sesiones activas + auditar) quede
 * confirmado aunque el resultado final para quien llama sea un error. Por
 * eso el callback siempre `return`a un resultado discriminado, y recién
 * después de que la transacción confirma se decide si corresponde lanzar
 * `InvalidSessionError`. La auditoría del caso normal (rotación exitosa)
 * queda deliberadamente FUERA de esa transacción (best-effort, vía
 * `recordAuditLogSafe`, después de confirmar) — un problema al auditar no
 * debe deshacer una rotación válida. La detección de reuso audita DENTRO
 * de la transacción (con `recordAuditLog` estricto): ahí el registro es
 * parte del efecto de seguridad, no un best-effort secundario.
 */
export async function refresh(
  prisma: PrismaClient,
  params: { refreshToken: string } & RequestMeta,
): Promise<RefreshResult> {
  const tokenHash = hashRefreshToken(params.refreshToken);

  const outcome: RotationOutcome = await prisma.$transaction(async (tx) => {
    const session = await tx.session.findUnique({ where: { refreshTokenHash: tokenHash } });
    if (!session) {
      return { kind: 'invalid' };
    }

    if (session.revokedAt) {
      // Reuso de un refresh token ya revocado: posible robo. Se revocan
      // TODAS las sesiones activas de ese usuario (no solo la reusada) —
      // el modelo actual no rastrea "familias" de tokens, así que la
      // respuesta segura y sin campos especulativos nuevos es cortar todo
      // acceso vigente de esa cuenta.
      await tx.session.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await recordAuditLog(tx, {
        actorUserId: session.userId,
        action: 'auth.refresh.reuse_detected',
        entityType: 'Session',
        entityId: session.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });
      return { kind: 'invalid' };
    }

    if (session.expiresAt.getTime() < Date.now()) {
      return { kind: 'invalid' };
    }

    const user = await tx.user.findUnique({
      where: { id: session.userId },
      select: { id: true, role: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      return { kind: 'invalid' };
    }

    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);

    await tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const newSession = await tx.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: newRefreshTokenHash,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        expiresAt: new Date(Date.now() + refreshTokenTtlSeconds * 1000),
      },
      select: { id: true },
    });

    const accessToken = await signAccessToken(
      { userId: user.id, sessionId: newSession.id, role: user.role },
      accessTokenSecret,
      accessTokenTtlSeconds,
    );

    return {
      kind: 'rotated',
      accessToken,
      refreshToken: newRefreshToken,
      previousSessionId: session.id,
      newSessionId: newSession.id,
      userId: user.id,
    };
  });

  if (outcome.kind === 'invalid') {
    throw new InvalidSessionError();
  }

  await recordAuditLogSafe(prisma, {
    actorUserId: outcome.userId,
    action: 'auth.refresh.rotated',
    entityType: 'Session',
    entityId: outcome.newSessionId,
    previousState: { sessionId: outcome.previousSessionId },
    newState: { sessionId: outcome.newSessionId },
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  return {
    accessToken: outcome.accessToken,
    accessTokenExpiresInSeconds: accessTokenTtlSeconds,
    refreshToken: outcome.refreshToken,
    refreshTokenTtlSeconds,
  };
}

/**
 * Idempotente y sin revelar si el token existía: siempre "éxito" desde la
 * perspectiva del cliente. Si había una sesión activa para ese hash, se
 * revoca (nunca se borra la fila).
 */
export async function logout(
  prisma: PrismaClient,
  params: { refreshToken: string | undefined } & RequestMeta,
): Promise<void> {
  if (!params.refreshToken) {
    return;
  }
  const tokenHash = hashRefreshToken(params.refreshToken);
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: tokenHash } });
  if (!session || session.revokedAt) {
    return;
  }
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  await recordAuditLogSafe(prisma, {
    actorUserId: session.userId,
    action: 'auth.logout',
    entityType: 'Session',
    entityId: session.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

export async function getPublicUserById(
  prisma: PrismaClient,
  userId: string,
): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: USER_SELECT_FOR_AUTH,
  });
  if (!user) return null;
  return toPublicUser(user);
}
