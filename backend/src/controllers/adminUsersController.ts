import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { recordAuditLog } from '../auth/auditLog';
import { hashPin, validatePinPolicy } from '../auth/pin';
import {
  activateBodySchema,
  listUsersQuerySchema,
  resetPinBodySchema,
  statusChangeBodySchema,
} from '../auth/schemas';
import { isAllowedStatusTransition, statusChangeRevokesSessions } from '../auth/userStatus';
import {
  AuthenticationRequiredError,
  InvalidStatusTransitionError,
  NotFoundError,
  SelfLockoutError,
  ValidationError,
} from '../errors/AppError';

function requestMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  return { ipAddress: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

function requireTargetId(req: Request): string {
  const id = req.params.id;
  if (!id || Array.isArray(id)) {
    throw new ValidationError('Falta el id de usuario en la URL.');
  }
  return id;
}

/** Listado paginado — nunca expone `pinHash` (select explícito, nunca `include` de todo el modelo). `username` sí se incluye acá (a diferencia de `GET /auth/login-options`): es una vista administrativa, no el selector público de login. */
export async function listUsers(req: Request, res: Response): Promise<void> {
  const parsed = listUsersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError('Parámetros de paginación/filtro inválidos.');
  }
  const { page, pageSize, status, role } = parsed.data;
  const where = { ...(status ? { status } : {}), ...(role ? { role } : {}) };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        employee: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.set('Cache-Control', 'no-store');
  res.status(200).json({ users, pagination: { page, pageSize, total } });
}

/** El PIN inicial lo asigna el administrador al activar — nunca lo elige ni lo ve el propio usuario en este paso. */
export async function activateUser(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw new AuthenticationRequiredError();
  const targetId = requireTargetId(req);
  const parsed = activateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('El body debe incluir un PIN inicial de 4 dígitos.');
  }
  const policy = validatePinPolicy(parsed.data.pin);
  if (!policy.ok) {
    throw new ValidationError(policy.reason);
  }

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: targetId } });
    if (!user) throw new NotFoundError('Usuario no encontrado.');
    if (user.status !== 'PENDING_ACTIVATION') {
      throw new InvalidStatusTransitionError(
        'Solo se pueden activar usuarios en estado PENDING_ACTIVATION.',
      );
    }

    const pinHash = await hashPin(parsed.data.pin);
    await tx.user.update({ where: { id: targetId }, data: { status: 'ACTIVE', pinHash } });
    await recordAuditLog(tx, {
      actorUserId: req.auth?.userId,
      action: 'admin.user.activated',
      entityType: 'User',
      entityId: targetId,
      previousState: { status: user.status },
      newState: { status: 'ACTIVE' },
      ...requestMeta(req),
    });
  });

  res.set('Cache-Control', 'no-store');
  res.status(200).json({ ok: true });
}

/**
 * Cambio de PIN — exclusivo de ADMIN, nunca del propio empleado (no existe
 * ningún endpoint de "cambiar mi propio PIN"). Transaccional: hash nuevo,
 * revocación de todas las sesiones activas, y reseteo de intentos
 * fallidos/bloqueo se confirman juntos o ninguno — nunca queda el PIN
 * cambiado con las sesiones viejas todavía vigentes, ni al revés.
 */
export async function resetPin(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw new AuthenticationRequiredError();
  const targetId = requireTargetId(req);
  const parsed = resetPinBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('El body debe incluir un PIN nuevo de 4 dígitos.');
  }
  const policy = validatePinPolicy(parsed.data.pin);
  if (!policy.ok) {
    throw new ValidationError(policy.reason);
  }

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: targetId } });
    if (!user) throw new NotFoundError('Usuario no encontrado.');

    const pinHash = await hashPin(parsed.data.pin);
    await tx.user.update({
      where: { id: targetId },
      data: { pinHash, failedLoginAttempts: 0, lockedUntil: null },
    });
    const revoked = await tx.session.updateMany({
      where: { userId: targetId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAuditLog(tx, {
      actorUserId: req.auth?.userId,
      action: 'admin.user.pin_reset',
      entityType: 'User',
      entityId: targetId,
      ...requestMeta(req),
    });
    if (revoked.count > 0) {
      await recordAuditLog(tx, {
        actorUserId: req.auth?.userId,
        action: 'admin.user.sessions_revoked_by_pin_reset',
        entityType: 'Session',
        entityId: targetId,
        newState: { revokedSessionsCount: revoked.count },
        ...requestMeta(req),
      });
    }
  });

  res.set('Cache-Control', 'no-store');
  res.status(200).json({ ok: true });
}

export async function changeStatus(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw new AuthenticationRequiredError();
  const targetId = requireTargetId(req);
  const parsed = statusChangeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('El body debe incluir un status válido.');
  }
  const { status: nextStatus } = parsed.data;
  const actorUserId = req.auth.userId;

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: targetId } });
    if (!user) throw new NotFoundError('Usuario no encontrado.');

    if (!isAllowedStatusTransition(user.status, nextStatus)) {
      throw new InvalidStatusTransitionError(
        `No se puede pasar de ${user.status} a ${nextStatus}.`,
      );
    }

    const isSelf = actorUserId === targetId;
    const wouldLockOut = isSelf && user.role === 'ADMIN' && statusChangeRevokesSessions(nextStatus);
    if (wouldLockOut) {
      const otherActiveAdmins = await tx.user.count({
        where: { role: 'ADMIN', status: 'ACTIVE', id: { not: targetId } },
      });
      if (otherActiveAdmins === 0) {
        throw new SelfLockoutError();
      }
    }

    await tx.user.update({ where: { id: targetId }, data: { status: nextStatus } });

    if (statusChangeRevokesSessions(nextStatus)) {
      await tx.session.updateMany({
        where: { userId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await recordAuditLog(tx, {
      actorUserId,
      action: 'admin.user.status_changed',
      entityType: 'User',
      entityId: targetId,
      previousState: { status: user.status },
      newState: { status: nextStatus },
      ...requestMeta(req),
    });
  });

  res.set('Cache-Control', 'no-store');
  res.status(200).json({ ok: true });
}
