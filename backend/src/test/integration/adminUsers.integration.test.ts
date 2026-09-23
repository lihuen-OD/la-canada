import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { hashPin } from '../../auth/pin';
import { getLoginOptions, login } from '../../auth/authService';
import {
  activateUser,
  changeStatus,
  listUsers,
  resetPin,
} from '../../controllers/adminUsersController';

/**
 * Contra Neon real (`demo`) — igual que `auth.integration.test.ts`: usa el
 * cliente Prisma singleton real, `req`/`res` de Express se simulan a mano
 * (los controladores no reciben Express inyectado), y todo lo creado se
 * limpia en `afterAll` con verificación de que los conteos globales de
 * `users`/`sessions`/`audit_logs` vuelven exactamente a su línea de base.
 * No se ejecuta nunca `npm run auth:bootstrap-admin` ni su `main()` — el
 * admin que actúa acá es un usuario de prueba creado directamente por este
 * archivo, no por el bootstrap real.
 */

const RUN_ID = Date.now();
const ACTOR_USERNAME = `test-admin-actor-${RUN_ID}`;
const TARGET_USERNAME = `test-admin-target-${RUN_ID}`;
const INITIAL_PIN = '3054';
const RESET_PIN_VALUE = '6187';

let actorUserId: string;
let targetUserId: string;
let neverActivatedUserId: string;
let baselineUserCount: number;
let baselineSessionCount: number;
let baselineAuditLogCount: number;

function fakeRes(): { res: Response; getBody: () => unknown } {
  let capturedBody: unknown;
  const res = {
    set: () => res,
    status: () => res,
    json: (body: unknown) => {
      capturedBody = body;
      return res;
    },
  } as unknown as Response;
  return { res, getBody: () => capturedBody };
}

function fakeReq(params: {
  actingAsUserId: string;
  targetId: string;
  body?: unknown;
  query?: Record<string, string>;
}): Request {
  return {
    auth: { userId: params.actingAsUserId, sessionId: crypto.randomUUID(), role: 'ADMIN' },
    params: { id: params.targetId },
    body: params.body ?? {},
    query: params.query ?? {},
    ip: '127.0.0.1',
    header: (name: string) =>
      name.toLowerCase() === 'user-agent' ? 'vitest-integration' : undefined,
  } as unknown as Request;
}

beforeAll(async () => {
  baselineUserCount = await prisma.user.count();
  baselineSessionCount = await prisma.session.count();
  baselineAuditLogCount = await prisma.auditLog.count();

  const actor = await prisma.user.create({
    data: {
      username: ACTOR_USERNAME,
      role: 'ADMIN',
      status: 'ACTIVE',
      pinHash: await hashPin('9931'),
    },
    select: { id: true },
  });
  actorUserId = actor.id;

  const target = await prisma.user.create({
    data: {
      username: TARGET_USERNAME,
      role: 'EMPLOYEE',
      status: 'PENDING_ACTIVATION',
      pinHash: null,
    },
    select: { id: true },
  });
  targetUserId = target.id;

  // Usuario sintético que llega a DEACTIVATED sin pasar nunca por
  // /activate — reproduce exactamente el hueco real que exponía
  // `changeStatus` antes de agregar el guard de `pinHash` (ver
  // `adminUsersController.ts`, comentario junto al chequeo `nextStatus ===
  // 'ACTIVE' && !user.pinHash`).
  const neverActivated = await prisma.user.create({
    data: {
      username: `test-admin-never-activated-${RUN_ID}`,
      role: 'EMPLOYEE',
      status: 'DEACTIVATED',
      pinHash: null,
    },
    select: { id: true },
  });
  neverActivatedUserId = neverActivated.id;
});

afterAll(async () => {
  const allTestUserIds = [actorUserId, targetUserId, neverActivatedUserId];
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ actorUserId: { in: allTestUserIds } }, { entityId: { in: allTestUserIds } }],
    },
  });
  await prisma.session.deleteMany({ where: { userId: { in: allTestUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: allTestUserIds } } });

  expect(await prisma.user.count()).toBe(baselineUserCount);
  expect(await prisma.session.count()).toBe(baselineSessionCount);
  expect(await prisma.auditLog.count()).toBe(baselineAuditLogCount);
});

describe('adminUsersController — flujo real contra demo', () => {
  it('activateUser: PENDING_ACTIVATION -> ACTIVE, guarda el PIN hasheado (nunca en texto plano), audita', async () => {
    const { res } = fakeRes();
    const req = fakeReq({
      actingAsUserId: actorUserId,
      targetId: targetUserId,
      body: { pin: INITIAL_PIN },
    });
    await activateUser(req, res);

    const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId } });
    expect(target.status).toBe('ACTIVE');
    expect(target.pinHash).not.toBeNull();
    expect(target.pinHash).not.toBe(INITIAL_PIN);

    const audit = await prisma.auditLog.findMany({
      where: { entityId: targetUserId, action: 'admin.user.activated' },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.newState)).not.toMatch(new RegExp(INITIAL_PIN));
    expect(JSON.stringify(audit)).not.toContain(INITIAL_PIN);
  });

  it('activateUser: una segunda activación (ya ACTIVE) es rechazada, no silenciosa', async () => {
    const { res } = fakeRes();
    const req = fakeReq({
      actingAsUserId: actorUserId,
      targetId: targetUserId,
      body: { pin: INITIAL_PIN },
    });
    await expect(activateUser(req, res)).rejects.toThrow();
  });

  it('el PIN inicial recién asignado funciona para iniciar sesión de verdad', async () => {
    const result = await login(prisma, {
      userId: targetUserId,
      pin: INITIAL_PIN,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-integration',
    });
    expect(result.accessToken).toEqual(expect.any(String));
  });

  it('resetPin: cambia el hash, revoca todas las sesiones activas, y resetea intentos fallidos + bloqueo', async () => {
    // Sesión activa previa, simulando que el usuario ya estaba logueado, y
    // un historial de intentos fallidos con la cuenta a punto de bloquearse.
    await prisma.session.create({
      data: {
        userId: targetUserId,
        refreshTokenHash: `test-reset-${RUN_ID}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.user.update({
      where: { id: targetUserId },
      data: { failedLoginAttempts: 4, lockedUntil: new Date(Date.now() + 60_000) },
    });

    const { res } = fakeRes();
    const req = fakeReq({
      actingAsUserId: actorUserId,
      targetId: targetUserId,
      body: { pin: RESET_PIN_VALUE },
    });
    await resetPin(req, res);

    const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId } });
    expect(target.pinHash).not.toBeNull();
    expect(target.pinHash).not.toBe(INITIAL_PIN);
    expect(target.failedLoginAttempts).toBe(0);
    expect(target.lockedUntil).toBeNull();

    const sessions = await prisma.session.findMany({ where: { userId: targetUserId } });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);

    const audit = await prisma.auditLog.findMany({
      where: { entityId: targetUserId, action: 'admin.user.pin_reset' },
    });
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(audit)).not.toContain(RESET_PIN_VALUE);

    const sessionsRevokedAudit = await prisma.auditLog.findMany({
      where: { entityId: targetUserId, action: 'admin.user.sessions_revoked_by_pin_reset' },
    });
    expect(sessionsRevokedAudit.length).toBeGreaterThanOrEqual(1);
  });

  it('el PIN anterior deja de servir inmediatamente después del reset, y el nuevo sí funciona', async () => {
    await expect(
      login(prisma, {
        userId: targetUserId,
        pin: INITIAL_PIN,
        ipAddress: '127.0.0.1',
        userAgent: 'vitest-integration',
      }),
    ).rejects.toThrow();

    const result = await login(prisma, {
      userId: targetUserId,
      pin: RESET_PIN_VALUE,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-integration',
    });
    expect(result.accessToken).toEqual(expect.any(String));
  });

  it('changeStatus: ACTIVE -> SUSPENDED revoca sesiones activas y audita la transición', async () => {
    await prisma.session.create({
      data: {
        userId: targetUserId,
        refreshTokenHash: `test-suspend-${RUN_ID}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const { res } = fakeRes();
    const req = fakeReq({
      actingAsUserId: actorUserId,
      targetId: targetUserId,
      body: { status: 'SUSPENDED' },
    });
    await changeStatus(req, res);

    const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId } });
    expect(target.status).toBe('SUSPENDED');

    const activeSessions = await prisma.session.findMany({
      where: { userId: targetUserId, revokedAt: null },
    });
    expect(activeSessions).toHaveLength(0);
  });

  it('changeStatus: una transición no permitida (SUSPENDED -> PENDING_ACTIVATION) es rechazada', async () => {
    const { res } = fakeRes();
    const req = fakeReq({
      actingAsUserId: actorUserId,
      targetId: targetUserId,
      body: { status: 'PENDING_ACTIVATION' },
    });
    await expect(changeStatus(req, res)).rejects.toThrow();
  });

  it('changeStatus: un admin no puede auto-suspenderse si es el único ADMIN activo', async () => {
    // Nos aseguramos de que el único ADMIN activo real relevante para este chequeo sea el actor de prueba:
    // el propio actor intenta auto-suspenderse. Si existen otros ADMIN activos reales del seed, la protección
    // de auto-lockout no se dispara (comportamiento correcto) — igualmente confirmamos que la llamada no
    // deja al actor de prueba en un estado inconsistente cuando sí se dispara.
    const otherActiveAdmins = await prisma.user.count({
      where: { role: 'ADMIN', status: 'ACTIVE', id: { not: actorUserId } },
    });

    const { res } = fakeRes();
    const req = fakeReq({
      actingAsUserId: actorUserId,
      targetId: actorUserId,
      body: { status: 'SUSPENDED' },
    });

    if (otherActiveAdmins === 0) {
      await expect(changeStatus(req, res)).rejects.toThrow();
      const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorUserId } });
      expect(actor.status).toBe('ACTIVE');
    } else {
      await changeStatus(req, res);
      // Revertimos para no dejar al actor de prueba suspendido antes de la limpieza final.
      await prisma.user.update({ where: { id: actorUserId }, data: { status: 'ACTIVE' } });
    }
  });

  it('listUsers: filtra por status sin exponer pinHash', async () => {
    const { res, getBody } = fakeRes();
    const req = fakeReq({
      actingAsUserId: actorUserId,
      targetId: targetUserId,
      query: { status: 'SUSPENDED', page: '1', pageSize: '50' },
    });
    await listUsers(req, res);

    const payload = getBody() as { users: Array<Record<string, unknown>> };
    const testTargetRow = payload.users.find((u) => u.id === targetUserId);
    expect(testTargetRow).toBeDefined();
    expect(testTargetRow).not.toHaveProperty('pinHash');
  });

  it('un usuario SUSPENDED no puede iniciar sesión (aunque conserve su pinHash)', async () => {
    const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId } });
    expect(target.status).toBe('SUSPENDED');
    expect(target.pinHash).not.toBeNull();

    await expect(
      login(prisma, {
        userId: targetUserId,
        pin: RESET_PIN_VALUE,
        ipAddress: '127.0.0.1',
        userAgent: 'vitest-integration',
      }),
    ).rejects.toThrow();
  });

  it('un usuario SUSPENDED desaparece de /auth/login-options', async () => {
    const options = await getLoginOptions(prisma);
    expect(options.find((option) => option.id === targetUserId)).toBeUndefined();
  });

  it('changeStatus: reactivar (DEACTIVATED -> ACTIVE) a alguien que nunca tuvo PIN se rechaza limpiamente, no revienta el CHECK de la base', async () => {
    const { res } = fakeRes();
    const req = fakeReq({
      actingAsUserId: actorUserId,
      targetId: neverActivatedUserId,
      body: { status: 'ACTIVE' },
    });

    await expect(changeStatus(req, res)).rejects.toThrow();

    const stillDeactivated = await prisma.user.findUniqueOrThrow({
      where: { id: neverActivatedUserId },
    });
    expect(stillDeactivated.status).toBe('DEACTIVATED');
    expect(stillDeactivated.pinHash).toBeNull();
  });

  it('changeStatus: DEACTIVATED -> SUSPENDED (transición permitida, sin relación con el pinHash) sí se acepta', async () => {
    const { res } = fakeRes();
    const req = fakeReq({
      actingAsUserId: actorUserId,
      targetId: neverActivatedUserId,
      body: { status: 'SUSPENDED' },
    });

    await changeStatus(req, res);

    const target = await prisma.user.findUniqueOrThrow({ where: { id: neverActivatedUserId } });
    expect(target.status).toBe('SUSPENDED');
  });
});
