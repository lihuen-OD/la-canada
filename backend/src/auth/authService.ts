import { Prisma, type PrismaClient } from '../generated/prisma/client';
import {
  InvalidCredentialsError,
  InvalidSessionError,
  SessionRefreshUnavailableError,
} from '../errors/AppError';
import { verifyAgainstDummy, verifyPin } from './pin';
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

/**
 * Nunca incluye `username` (Etapa 3B.2: es un identificador técnico interno,
 * no algo que se muestre a la propia persona autenticada) ni, por supuesto,
 * `pinHash`, intentos fallidos o fecha de bloqueo.
 */
export interface PublicUser {
  id: string;
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
  role: 'ADMIN' | 'EMPLOYEE';
  status: string;
  employee: { id: string; displayName: string; colorHex: string } | null;
}): PublicUser {
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    employee: user.employee,
  };
}

const USER_SELECT_FOR_AUTH = {
  id: true,
  role: true,
  status: true,
  pinHash: true,
  failedLoginAttempts: true,
  lockedUntil: true,
  employee: { select: { id: true, displayName: true, colorHex: true } },
} as const;

/**
 * Protección persistente contra fuerza bruta sobre el PIN (10.000
 * combinaciones posibles) — ver `docs/SECURITY.md`, "Autenticación por PIN".
 * Valores fijos, no configurables por entorno: la política de bloqueo es
 * una decisión de producto, no un parámetro de despliegue.
 */
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

function isLocked(user: { lockedUntil: Date | null }): boolean {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now();
}

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
 * Login — identidad seleccionada (`userId`) + PIN de 4 dígitos (Etapa
 * 3B.2, reemplaza username+contraseña). Sin distinguir en la respuesta
 * usuario inexistente, PIN incorrecto, estado no ACTIVE, o cuenta
 * bloqueada por intentos fallidos: siempre `InvalidCredentialsError` (evita
 * enumeración de cuentas y de motivos de bloqueo). Cuando el usuario no
 * existe, no tiene `pinHash` todavía, o está bloqueado, se verifica igual
 * contra un hash dummy para no delatar la diferencia por tiempo de
 * respuesta entre esos casos y un PIN real incorrecto.
 */
export async function login(
  prisma: PrismaClient,
  params: { userId: string; pin: string } & RequestMeta,
): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: USER_SELECT_FOR_AUTH,
  });

  if (!user || user.status !== 'ACTIVE' || !user.pinHash || isLocked(user)) {
    await verifyAgainstDummy(params.pin);
    await recordAuditLogSafe(prisma, {
      actorUserId: user?.id ?? null,
      action: 'auth.login.failed',
      entityType: 'User',
      entityId: user?.id ?? params.userId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    throw new InvalidCredentialsError();
  }

  const pinValid = await verifyPin(user.pinHash, params.pin);
  if (!pinValid) {
    // Incremento atómico (`SET col = col + 1` a nivel SQL, vía el operador
    // `increment` de Prisma) — nunca "leer contador, sumar en JS, escribir
    // contador+1", que perdería incrementos bajo intentos concurrentes.
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });

    // Toma atómica del bloqueo: bajo una ráfaga concurrente, varias
    // solicitudes pueden cruzar el umbral con su propio incremento (el
    // conteo en sí nunca se pierde, pero *cuál* de ellas "aplica" el
    // bloqueo sí puede duplicarse si no se condiciona la escritura). Igual
    // que la toma atómica de sesión en `refresh()`: el `updateMany` exige
    // que `lockedUntil` esté nulo o ya vencido *en el momento de escribir*
    // — Postgres solo dejar pasar la escritura de la primera solicitud que
    // llega a ese estado; el resto, al desbloquearse, reevalúa el `WHERE`
    // contra la fila ya bloqueada por la primera y no matchea (`count: 0`).
    // Así, sin importar cuántas solicitudes concurrentes crucen el umbral,
    // como máximo una queda marcada como `justLocked` y solo esa audita el
    // evento de bloqueo.
    let justLocked = false;
    if (updated.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      const lockClaim = await prisma.user.updateMany({
        where: {
          id: user.id,
          OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
        },
        data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
      });
      justLocked = lockClaim.count === 1;
    }

    await recordAuditLogSafe(prisma, {
      actorUserId: user.id,
      action: 'auth.login.failed',
      entityType: 'User',
      entityId: user.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    if (justLocked) {
      await recordAuditLogSafe(prisma, {
        actorUserId: user.id,
        action: 'auth.login.locked',
        entityType: 'User',
        entityId: user.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });
    }
    throw new InvalidCredentialsError();
  }

  // Login correcto: resetea el contador y cualquier bloqueo vigente (nunca
  // se resetean solos por el paso del tiempo — ver el campo en schema.prisma).
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });

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

/** Identidad mínima para el selector público de login — ver `docs/ARCHITECTURE.md`, "Autenticación por PIN". */
export interface LoginOption {
  id: string;
  displayName: string;
  role: 'ADMIN' | 'EMPLOYEE';
  colorHex: string | null;
}

/**
 * Etiqueta genérica para un `ADMIN` sin `Employee` vinculado (el caso
 * normal: el admin se crea vía `bootstrapAdmin`, nunca vía el seed de
 * empleados) — nunca se usa `username` como reemplazo, aunque estuviera
 * disponible, porque es un identificador técnico interno, no un nombre
 * pensado para mostrarse.
 */
const ADMIN_FALLBACK_DISPLAY_NAME = 'Administrador';

/**
 * Únicamente usuarios `status: ACTIVE` — los `PENDING_ACTIVATION` todavía no
 * tienen PIN (no pueden autenticarse), y `SUSPENDED`/`DEACTIVATED` no deben
 * ofrecerse como identidad seleccionable aunque conserven su PIN antiguo.
 * Nunca selecciona `pinHash`, `username`, intentos fallidos ni fecha de
 * bloqueo — ver la lista explícita de campos exportados en `LoginOption`.
 * Orden estable: por `createdAt` ascendente, igual que `GET /admin/users`.
 */
export async function getLoginOptions(prisma: PrismaClient): Promise<LoginOption[]> {
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      role: true,
      employee: { select: { displayName: true, colorHex: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const options: LoginOption[] = [];
  for (const user of users) {
    if (user.role === 'EMPLOYEE' && !user.employee) {
      // Invariante de negocio: todo User EMPLOYEE debería estar vinculado a
      // un Employee real (así los siembra el seed). Si no lo estuviera, no
      // hay ningún nombre real para mostrar — se excluye del selector en vez
      // de inventar un nombre o exponer el username interno.
      continue;
    }
    options.push({
      id: user.id,
      displayName: user.employee?.displayName ?? ADMIN_FALLBACK_DISPLAY_NAME,
      role: user.role,
      colorHex: user.employee?.colorHex ?? null,
    });
  }
  return options;
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

/** Revoca todas las sesiones activas de un usuario y audita el motivo — usado tanto ante reuso clásico como ante una carrera de rotación concurrente detectada. */
async function revokeAllActiveSessionsAndAudit(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    action: string;
    relatedSessionId: string;
  } & RequestMeta,
): Promise<void> {
  await tx.session.updateMany({
    where: { userId: params.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await recordAuditLog(tx, {
    actorUserId: params.userId,
    action: params.action,
    entityType: 'Session',
    entityId: params.relatedSessionId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

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
 *
 * **Rotación concurrente**: el `findUnique` inicial NO alcanza para decidir
 * con seguridad que esta solicitud puede rotar la sesión — dos solicitudes
 * con el mismo refresh token pueden leerla ambas como "activa" antes de que
 * cualquiera escriba. La revocación de la sesión vieja se hace entonces con
 * un `updateMany` condicionado por `id` + `revokedAt: null` + vigencia
 * (`expiresAt` futuro) — no con un `update` incondicional. Bajo el nivel de
 * aislamiento por defecto de Postgres (READ COMMITTED) esto ya alcanza para
 * la exclusión mutua real: un `UPDATE` toma un lock de fila al ejecutarse, y
 * si dos transacciones intentan actualizar la misma fila, la segunda queda
 * bloqueada hasta que la primera confirme — al desbloquearse, Postgres
 * vuelve a evaluar el `WHERE` contra la fila ya committeada por la primera,
 * así que la segunda ve `revoked_at` ya no nulo y su `updateMany` afecta 0
 * filas. No hace falta `SERIALIZABLE` ni un `SELECT ... FOR UPDATE`
 * explícito: la propia semántica de re-chequeo del `UPDATE` en READ
 * COMMITTED ya es la exclusión mutua. Si `count !== 1`, se trata igual que
 * un reuso (no se sabe si fue una carrera benigna o un robo real corriendo
 * en paralelo a la rotación legítima): no se emite un refresh token nuevo,
 * se revocan conservadoramente todas las sesiones activas del usuario
 * (incluida la que la solicitud ganadora acababa de crear, si ya llegó a
 * confirmar), se audita, y se responde con el mismo error genérico.
 */
export async function refresh(
  prisma: PrismaClient,
  params: { refreshToken: string } & RequestMeta,
): Promise<RefreshResult> {
  const tokenHash = hashRefreshToken(params.refreshToken);

  let outcome: RotationOutcome;
  try {
    outcome = await rotateSession(prisma, tokenHash, params);
  } catch (error) {
    if (!isTransactionUnavailable(error)) throw error;
    outcome = await resolveInterruptedRotation(prisma, tokenHash, params);
  }

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
 * `P2028` (la transacción no pudo iniciarse o expiró) y `P2034` (conflicto
 * de escritura/deadlock): en ambos casos Postgres revirtió TODO lo de esta
 * transacción. Son esperables bajo concurrencia real contra Neon — p. ej.
 * varios refresh simultáneos donde uno no consigue conexión dentro del
 * `maxWait` — y nunca deben llegar crudos al cliente como 500.
 */
function isTransactionUnavailable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2028' || error.code === 'P2034')
  );
}

/**
 * Etapa 5P — la transacción de rotación no confirmó nada (ver
 * `isTransactionUnavailable`). Se decide contra el estado REAL, releído
 * fuera de la transacción revertida:
 * - sesión revocada: otra solicitud concurrente ya consumió este token →
 *   esta es un perdedor de la carrera. Se aplica la misma respuesta de
 *   seguridad que la rama `claim.count !== 1` (revocación conservadora +
 *   auditoría) en una transacción NUEVA y corta — así el efecto de
 *   seguridad no depende de la transacción que expiró — y error genérico;
 * - sesión inexistente o vencida: inválida, como siempre;
 * - sesión activa y vigente: nadie la tocó — fue una falla de
 *   infraestructura sin carrera. `503` reintentable: no se rota ni se
 *   revoca nada, y el refresh token del cliente sigue siendo válido.
 */
async function resolveInterruptedRotation(
  prisma: PrismaClient,
  tokenHash: string,
  params: RequestMeta,
): Promise<RotationOutcome> {
  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: tokenHash },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true },
  });
  if (!session) return { kind: 'invalid' };
  if (session.revokedAt === null) {
    if (session.expiresAt.getTime() < Date.now()) return { kind: 'invalid' };
    throw new SessionRefreshUnavailableError();
  }
  try {
    await prisma.$transaction((tx) =>
      revokeAllActiveSessionsAndAudit(tx, {
        userId: session.userId,
        action: 'auth.refresh.concurrent_rotation_detected',
        relatedSessionId: session.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      }),
    );
  } catch (error) {
    // Sin la revocación confirmada no se afirma nada: reintentable, nunca 500.
    if (isTransactionUnavailable(error)) throw new SessionRefreshUnavailableError();
    throw error;
  }
  return { kind: 'invalid' };
}

async function rotateSession(
  prisma: PrismaClient,
  tokenHash: string,
  params: RequestMeta,
): Promise<RotationOutcome> {
  return prisma.$transaction(async (tx) => {
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
      await revokeAllActiveSessionsAndAudit(tx, {
        userId: session.userId,
        action: 'auth.refresh.reuse_detected',
        relatedSessionId: session.id,
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

    // Toma atómica de la sesión: solo una solicitud concurrente puede ganar
    // esta escritura condicionada (ver comentario de la función). Si otra
    // ya la reclamó entre nuestra lectura y este `updateMany`, `count` da 0.
    const claim = await tx.session.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    if (claim.count !== 1) {
      await revokeAllActiveSessionsAndAudit(tx, {
        userId: session.userId,
        action: 'auth.refresh.concurrent_rotation_detected',
        relatedSessionId: session.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });
      return { kind: 'invalid' };
    }

    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);

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
