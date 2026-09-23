import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { recordAuditLog } from '../auth/auditLog';
import { hashPassword, validatePasswordPolicy } from '../auth/password';
import {
  activateBodySchema,
  listUsersQuerySchema,
  resetPasswordBodySchema,
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

/** Listado paginado — nunca expone `passwordHash` (select explícito, nunca `include` de todo el modelo). */
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

export async function activateUser(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw new AuthenticationRequiredError();
  const targetId = requireTargetId(req);
  const parsed = activateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('El body debe incluir una contraseña inicial válida.');
  }
  const policy = validatePasswordPolicy(parsed.data.password);
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

    const passwordHash = await hashPassword(parsed.data.password);
    await tx.user.update({ where: { id: targetId }, data: { status: 'ACTIVE', passwordHash } });
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

export async function resetPassword(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw new AuthenticationRequiredError();
  const targetId = requireTargetId(req);
  const parsed = resetPasswordBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('El body debe incluir una contraseña nueva válida.');
  }
  const policy = validatePasswordPolicy(parsed.data.password);
  if (!policy.ok) {
    throw new ValidationError(policy.reason);
  }

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: targetId } });
    if (!user) throw new NotFoundError('Usuario no encontrado.');

    const passwordHash = await hashPassword(parsed.data.password);
    await tx.user.update({ where: { id: targetId }, data: { passwordHash } });
    await tx.session.updateMany({
      where: { userId: targetId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAuditLog(tx, {
      actorUserId: req.auth?.userId,
      action: 'admin.user.password_reset',
      entityType: 'User',
      entityId: targetId,
      ...requestMeta(req),
    });
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
