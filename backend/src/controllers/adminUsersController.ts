import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { recordAuditLog } from '../auth/auditLog';
import { hashPin, validatePinPolicy } from '../auth/pin';
import { TECHNICAL_USERNAME_PATTERN, createAdminAccount } from '../auth/adminAccounts';
import { assertAdminCanBeDeactivated } from '../auth/adminLockout';
import {
  activateBodySchema,
  createAdminBodySchema,
  userDisplayNameBodySchema,
  listUsersQuerySchema,
  resetPinBodySchema,
  statusChangeBodySchema,
} from '../auth/schemas';
import { isAllowedStatusTransition, statusChangeRevokesSessions } from '../auth/userStatus';
import {
  AuthenticationRequiredError,
  DisplayNameUsesEmployeeError,
  InvalidStatusTransitionError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError';

function requestMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  return { ipAddress: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
        /** Etapa 5F — nombre visible del perfil personal (ADMIN sin Employee). */
        personalProfile: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.set('Cache-Control', 'no-store');
  res.status(200).json({
    // Etapa 5U: `technicalUsername` = generado por el sistema (`admin-…`): la UI no lo muestra.
    users: users.map((user) => ({
      ...user,
      technicalUsername: TECHNICAL_USERNAME_PATTERN.test(user.username),
    })),
    pagination: { page, pageSize, total },
  });
}

/**
 * `PATCH /admin/users/:id/display-name` (solo ADMIN, Etapa 5U): corrige el
 * nombre visible de una cuenta SIN Employee (otro ADMIN) en `UserProfile`. No
 * toca `username`, rol, estado, PIN ni sesiones. Una persona con ficha de
 * equipo se corrige en Datos del equipo (`Employee.displayName`): una sola vía
 * por nombre. Auditado con el nombre anterior y el nuevo.
 */
export async function changeDisplayName(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw new AuthenticationRequiredError();
  const targetId = requireTargetId(req);
  if (!UUID_PATTERN.test(targetId)) throw new ValidationError('El identificador no es válido.');
  const parsed = userDisplayNameBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Nombre inválido.');
  }
  const { displayName } = parsed.data;
  const actorUserId = req.auth.userId;
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: targetId },
      select: { id: true, employeeId: true, personalProfile: { select: { displayName: true } } },
    });
    if (!user) throw new NotFoundError('Usuario no encontrado.');
    if (user.employeeId) throw new DisplayNameUsesEmployeeError();
    const previous = user.personalProfile?.displayName ?? null;
    if (previous !== displayName) {
      await tx.userProfile.upsert({
        where: { userId: targetId },
        create: { userId: targetId, displayName },
        update: { displayName },
      });
      await recordAuditLog(tx, {
        actorUserId,
        action: 'admin.user.display_name_updated',
        entityType: 'User',
        entityId: targetId,
        previousState: { displayName: previous },
        newState: { displayName },
        ...requestMeta(req),
      });
    }
    return { user: { id: targetId, displayName } };
  });
  res.set('Cache-Control', 'no-store');
  res.status(200).json(result);
}

/**
 * `POST /admin/users/admins` (solo ADMIN, Etapa 5U): crea otro administrador
 * ya ACTIVO con su PIN y su nombre visible, sin Employee. `201` con datos
 * mínimos: nunca el PIN, el hash, el username técnico, intentos, bloqueo ni
 * tokens. Acepta `Idempotency-Key` (doble envío = una sola cuenta).
 */
export async function createAdmin(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw new AuthenticationRequiredError();
  const parsed = createAdminBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? 'Datos del administrador inválidos.',
    );
  }
  const result = await createAdminAccount(
    req.auth.userId,
    parsed.data,
    requestMeta(req),
    req.header('idempotency-key') ?? undefined,
  );
  res.set('Cache-Control', 'no-store');
  res.status(result.kind === 'replay' ? result.status : 201).json(result.body);
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

    // Invariante real de la base (CHECK `users_active_requires_pin_hash_check`,
    // ver docs/DATABASE.md): ACTIVE exige pinHash no nulo. La matriz de
    // transiciones permite SUSPENDED/DEACTIVATED → ACTIVE por diseño (para
    // reactivar a alguien que YA tenía PIN antes de suspenderse/
    // deshabilitarse), pero un usuario que llegó a DEACTIVATED directo
    // desde PENDING_ACTIVATION (sin pasar nunca por /activate) todavía no
    // tiene pinHash — sin este chequeo, ese intento de reactivación
    // rompería el CHECK de Postgres y devolvería un 500 crudo en vez de un
    // rechazo controlado. No hay ninguna transición de vuelta a
    // PENDING_ACTIVATION una vez pasado ese estado, así que la única forma
    // de darle un PIN a esa persona es activarla desde PENDING_ACTIVATION
    // en su momento original — este mensaje lo deja explícito.
    if (nextStatus === 'ACTIVE' && !user.pinHash) {
      throw new InvalidStatusTransitionError(
        'No se puede reactivar: este usuario nunca llegó a tener un PIN asignado (nunca pasó por la activación inicial).',
      );
    }

    // Etapa 5U: nunca a uno mismo, nunca el último ADMIN activo, y a prueba
    // de dos ADMIN desactivándose en simultáneo (bloqueo de filas, ver
    // `auth/adminLockout.ts`). El actor de este endpoint siempre es un ADMIN
    // activo, así que "a uno mismo" también entra por esta condición.
    if (
      user.role === 'ADMIN' &&
      user.status === 'ACTIVE' &&
      statusChangeRevokesSessions(nextStatus)
    ) {
      await assertAdminCanBeDeactivated(tx, actorUserId, targetId);
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
