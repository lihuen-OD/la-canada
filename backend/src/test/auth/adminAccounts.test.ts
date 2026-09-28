import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Etapa 5U — alta de ADMIN adicional con un Prisma simulado mínimo: contrato
 * estricto, username técnico, transacción única (User + UserProfile +
 * AuditLog), nada sensible en la respuesta ni en la auditoría, e
 * idempotencia sin el PIN en la huella. La SQL real se prueba contra `demo`
 * en `adminUsers.integration.test.ts`.
 */
const db = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    user: { create: fn() },
    userProfile: { create: fn() },
    auditLog: { create: fn() },
    idempotencyRecord: { create: fn(), update: fn(), findUnique: fn() },
    $transaction: fn(),
  };
});
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import { Prisma } from '../../generated/prisma/client';
import {
  TECHNICAL_USERNAME_PATTERN,
  createAdminAccount,
  generateTechnicalUsername,
} from '../../auth/adminAccounts';
import { createAdminBodySchema } from '../../auth/schemas';
import { verifyPin } from '../../auth/pin';

const META = { ipAddress: null, userAgent: 'vitest' };
const CREATED_AT = new Date('2026-09-28T18:00:00Z');

beforeEach(() => {
  for (const group of Object.values(db)) {
    if (typeof group === 'function') group.mockReset();
    else for (const method of Object.values(group)) method.mockReset();
  }
  db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
  db.user.create.mockResolvedValue({ id: 'new-admin', createdAt: CREATED_AT });
  db.userProfile.create.mockResolvedValue({});
  db.auditLog.create.mockResolvedValue({});
  db.idempotencyRecord.create.mockResolvedValue({ id: 'rec-1' });
  db.idempotencyRecord.update.mockResolvedValue({});
});

describe('contrato de POST /admin/users/admins', () => {
  it('acepta nombre + PIN como string y conserva el cero inicial', () => {
    expect(createAdminBodySchema.parse({ displayName: '  Ana   Lía ', pin: '0123' })).toEqual({
      displayName: 'Ana Lía',
      pin: '0123',
    });
  });

  it('rechaza rol, ids, username, estado, pinHash y PIN que no sean exactamente 4 dígitos', () => {
    const base = { displayName: 'Ana', pin: '0123' };
    for (const extra of [
      { role: 'ADMIN' },
      { userId: 'x' },
      { employeeId: 'x' },
      { username: 'x' },
      { status: 'ACTIVE' },
      { pinHash: 'x' },
    ]) {
      expect(
        createAdminBodySchema.safeParse({ ...base, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
    for (const pin of ['123', '12345', '12a4', ' 1234', 1234]) {
      expect(createAdminBodySchema.safeParse({ ...base, pin }).success, String(pin)).toBe(false);
    }
    expect(createAdminBodySchema.safeParse({ ...base, displayName: 'A' }).success).toBe(false);
    expect(createAdminBodySchema.safeParse({ pin: '0123' }).success).toBe(false);
  });
});

describe('username técnico', () => {
  it('admin-<16 hex>, aleatorio, sin relación con el nombre', () => {
    const values = new Set(Array.from({ length: 200 }, generateTechnicalUsername));
    expect(values.size).toBe(200);
    for (const value of values) expect(value).toMatch(TECHNICAL_USERNAME_PATTERN);
  });
});

describe('createAdminAccount', () => {
  it('una sola transacción: User ADMIN/ACTIVE con Argon2id + UserProfile + AuditLog', async () => {
    const result = await createAdminAccount('actor-1', { displayName: 'Ana', pin: '0123' }, META);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const data = db.user.create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({
      role: 'ADMIN',
      status: 'ACTIVE',
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    expect(data.username).toMatch(TECHNICAL_USERNAME_PATTERN);
    expect(data.username).not.toMatch(/ana/i);
    expect(data.pinHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPin(data.pinHash, '0123')).toBe(true);
    expect(data).not.toHaveProperty('employeeId');
    expect(db.userProfile.create.mock.calls[0]?.[0].data).toEqual({
      userId: 'new-admin',
      displayName: 'Ana',
    });
    const audit = db.auditLog.create.mock.calls[0]?.[0].data;
    expect(audit).toMatchObject({
      actorUserId: 'actor-1',
      action: 'admin.user.created',
      entityId: 'new-admin',
    });
    expect(JSON.stringify(audit)).not.toMatch(/0123|argon2|admin-[0-9a-f]{16}/);
    expect(result).toEqual({
      kind: 'created',
      body: {
        user: {
          id: 'new-admin',
          role: 'ADMIN',
          status: 'ACTIVE',
          displayName: 'Ana',
          createdAt: CREATED_AT.toISOString(),
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/pin|username|attempts|locked|token/i);
  });

  it('si falla el perfil o la auditoría, la transacción entera falla (todo o nada)', async () => {
    db.auditLog.create.mockRejectedValueOnce(new Error('audit down'));
    await expect(
      createAdminAccount('actor-1', { displayName: 'Ana', pin: '0123' }, META),
    ).rejects.toThrow('audit down');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('una colisión del username técnico se reintenta con OTRO valor', async () => {
    const collision = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['username'] },
    });
    db.user.create.mockRejectedValueOnce(collision);
    await createAdminAccount('actor-1', { displayName: 'Ana', pin: '0123' }, META);
    const [first, second] = db.user.create.mock.calls.map((call) => call[0].data.username);
    expect(first).not.toBe(second);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it('con Idempotency-Key la huella NO incluye el PIN', async () => {
    await createAdminAccount(
      'actor-1',
      { displayName: 'Ana', pin: '0123' },
      META,
      'clave-idem-123',
    );
    const reservation = db.idempotencyRecord.create.mock.calls[0]?.[0].data;
    expect(reservation).toMatchObject({
      endpoint: 'POST /admin/users/admins',
      key: 'clave-idem-123',
    });
    const { createHash } = await import('node:crypto');
    const withPin = createHash('sha256')
      .update(JSON.stringify(['POST /admin/users/admins', 'Ana', '0123']))
      .digest('hex');
    expect(reservation.requestHash).not.toBe(withPin);
    const stored = db.idempotencyRecord.update.mock.calls[0]?.[0].data.responseBody;
    expect(JSON.stringify(stored)).not.toMatch(/0123|pin|username/i);
  });

  it('un PIN inválido no llega a hashearse ni a abrir la transacción', async () => {
    await expect(
      createAdminAccount('actor-1', { displayName: 'Ana', pin: '12' }, META),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
