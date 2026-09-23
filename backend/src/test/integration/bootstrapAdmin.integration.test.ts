import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { bootstrapAdmin } from '../../scripts/bootstrapAdmin';

/**
 * Contra Neon real (`demo`). Ejercita únicamente el núcleo puro y testeable
 * `bootstrapAdmin(prisma, input)` — nunca `main()` (el CLI interactivo real
 * no se invoca en esta etapa, ver AGENTS.md regla 3 y el pedido explícito de
 * la Etapa 3B.1). Si este archivo llega a crear un admin de verdad (solo
 * ocurre cuando `demo` todavía no tiene ningún ADMIN activo), lo elimina en
 * `afterAll` — nunca queda un administrador persistente de esta suite.
 */

let createdUserId: string | undefined;
let baselineUserCount: number;
let baselineAuditLogCount: number;
let hadActiveAdminBeforeSuite: boolean;

beforeAll(async () => {
  baselineUserCount = await prisma.user.count();
  baselineAuditLogCount = await prisma.auditLog.count();
  const existingActiveAdmin = await prisma.user.findFirst({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
  });
  hadActiveAdminBeforeSuite = existingActiveAdmin !== null;
});

afterAll(async () => {
  if (createdUserId) {
    await prisma.auditLog.deleteMany({ where: { actorUserId: createdUserId } });
    await prisma.user.delete({ where: { id: createdUserId } }).catch(() => undefined);
  }

  expect(await prisma.user.count()).toBe(baselineUserCount);
  expect(await prisma.auditLog.count()).toBe(baselineAuditLogCount);
});

describe('bootstrapAdmin — núcleo puro contra demo', () => {
  it('primera llamada: crea el admin solo si demo todavía no tenía uno activo; si ya tenía, se rechaza (idempotencia real)', async () => {
    const username = `test-bootstrap-admin-${Date.now()}`;
    const result = await bootstrapAdmin(prisma, {
      username,
      password: 'contraseña de bootstrap de prueba bastante larga',
    });

    if (hadActiveAdminBeforeSuite) {
      expect(result.created).toBe(false);
      if (!result.created) {
        expect(result.reason).toMatch(/ya existe un administrador activo/i);
      }
    } else {
      expect(result.created).toBe(true);
      if (result.created) {
        createdUserId = result.userId;
        const admin = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
        expect(admin.role).toBe('ADMIN');
        expect(admin.status).toBe('ACTIVE');
        expect(admin.passwordHash).not.toBeNull();

        const audit = await prisma.auditLog.findMany({
          where: { actorUserId: result.userId, action: 'auth.bootstrap_admin' },
        });
        expect(audit).toHaveLength(1);
      }
    }
  });

  it('segunda llamada inmediatamente después: nunca crea un segundo admin (idempotente de verdad)', async () => {
    const secondUsername = `test-bootstrap-admin-second-${Date.now()}`;
    const result = await bootstrapAdmin(prisma, {
      username: secondUsername,
      password: 'otra contraseña de bootstrap también bastante larga',
    });
    expect(result.created).toBe(false);

    const secondUserExists = await prisma.user.findUnique({ where: { username: secondUsername } });
    expect(secondUserExists).toBeNull();
  });

  it('rechaza una contraseña que no cumple la política, sin tocar la base', async () => {
    const username = `test-bootstrap-admin-weak-${Date.now()}`;
    const result = await bootstrapAdmin(prisma, { username, password: 'corta' });
    expect(result.created).toBe(false);

    const userExists = await prisma.user.findUnique({ where: { username } });
    expect(userExists).toBeNull();
  });
});
