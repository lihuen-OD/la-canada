import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { hashPassword } from '../../auth/password';
import {
  activateUser,
  changeStatus,
  listUsers,
  resetPassword,
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
const INITIAL_PASSWORD = 'contraseña inicial de activación bastante larga';
const RESET_PASSWORD = 'contraseña reseteada bastante larga también';

let actorUserId: string;
let targetUserId: string;
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
      passwordHash: await hashPassword('contraseña del actor de prueba también larga'),
    },
    select: { id: true },
  });
  actorUserId = actor.id;

  const target = await prisma.user.create({
    data: {
      username: TARGET_USERNAME,
      role: 'EMPLOYEE',
      status: 'PENDING_ACTIVATION',
      passwordHash: null,
    },
    select: { id: true },
  });
  targetUserId = target.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ actorUserId: actorUserId }, { entityId: targetUserId }, { actorUserId: targetUserId }],
    },
  });
  await prisma.session.deleteMany({ where: { userId: { in: [actorUserId, targetUserId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [actorUserId, targetUserId] } } });

  expect(await prisma.user.count()).toBe(baselineUserCount);
  expect(await prisma.session.count()).toBe(baselineSessionCount);
  expect(await prisma.auditLog.count()).toBe(baselineAuditLogCount);
});

describe('adminUsersController — flujo real contra demo', () => {
  it('activateUser: PENDING_ACTIVATION -> ACTIVE, guarda password hasheado, audita', async () => {
    const { res } = fakeRes();
    const req = fakeReq({
      actingAsUserId: actorUserId,
      targetId: targetUserId,
      body: { password: INITIAL_PASSWORD },
    });
    await activateUser(req, res);

    const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId } });
    expect(target.status).toBe('ACTIVE');
    expect(target.passwordHash).not.toBeNull();
    expect(target.passwordHash).not.toBe(INITIAL_PASSWORD);

    const audit = await prisma.auditLog.findMany({
      where: { entityId: targetUserId, action: 'admin.user.activated' },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.newState)).not.toMatch(new RegExp(INITIAL_PASSWORD));
  });

  it('activateUser: una segunda activación (ya ACTIVE) es rechazada, no silenciosa', async () => {
    const { res } = fakeRes();
    const req = fakeReq({
      actingAsUserId: actorUserId,
      targetId: targetUserId,
      body: { password: INITIAL_PASSWORD },
    });
    await expect(activateUser(req, res)).rejects.toThrow();
  });

  it('resetPassword: cambia el hash y revoca todas las sesiones activas del usuario', async () => {
    // Sesión activa previa, simulando que el usuario ya estaba logueado.
    await prisma.session.create({
      data: {
        userId: targetUserId,
        refreshTokenHash: `test-reset-${RUN_ID}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const { res } = fakeRes();
    const req = fakeReq({
      actingAsUserId: actorUserId,
      targetId: targetUserId,
      body: { password: RESET_PASSWORD },
    });
    await resetPassword(req, res);

    const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId } });
    expect(target.passwordHash).not.toBeNull();

    const sessions = await prisma.session.findMany({ where: { userId: targetUserId } });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);

    const audit = await prisma.auditLog.findMany({
      where: { entityId: targetUserId, action: 'admin.user.password_reset' },
    });
    expect(audit.length).toBeGreaterThanOrEqual(1);
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

  it('listUsers: filtra por status sin exponer passwordHash', async () => {
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
    expect(testTargetRow).not.toHaveProperty('passwordHash');
  });
});
