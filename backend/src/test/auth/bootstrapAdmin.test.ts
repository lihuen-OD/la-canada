import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client';
import { bootstrapAdmin } from '../../scripts/bootstrapAdmin';
import { createFakePrisma } from './fakePrisma';

const VALID_PIN = '7392';

describe('bootstrapAdmin', () => {
  it('rechaza un PIN que no cumple la política (menos de 4 dígitos), sin tocar la base', async () => {
    const { prisma, users } = createFakePrisma();
    const result = await bootstrapAdmin(prisma as unknown as PrismaClient, {
      username: 'admin',
      pin: '12',
    });
    expect(result.created).toBe(false);
    expect(users.size).toBe(0);
  });

  it('rechaza un PIN con más de 4 dígitos', async () => {
    const { prisma } = createFakePrisma();
    const result = await bootstrapAdmin(prisma as unknown as PrismaClient, {
      username: 'admin',
      pin: '123456',
    });
    expect(result.created).toBe(false);
  });

  it('rechaza un PIN con caracteres no numéricos', async () => {
    const { prisma } = createFakePrisma();
    const result = await bootstrapAdmin(prisma as unknown as PrismaClient, {
      username: 'admin',
      pin: '12ab',
    });
    expect(result.created).toBe(false);
  });

  it('rechaza un username que queda vacío tras normalizarlo', async () => {
    const { prisma } = createFakePrisma();
    const result = await bootstrapAdmin(prisma as unknown as PrismaClient, {
      username: '   ',
      pin: VALID_PIN,
    });
    expect(result.created).toBe(false);
  });

  it('crea el primer administrador correctamente, con el PIN hasheado (nunca en texto plano)', async () => {
    const { prisma, users, auditLogs } = createFakePrisma();
    const result = await bootstrapAdmin(prisma as unknown as PrismaClient, {
      username: 'Admin Principal',
      pin: VALID_PIN,
    });
    expect(result.created).toBe(true);
    if (result.created) {
      const created = users.get(result.userId);
      expect(created?.role).toBe('ADMIN');
      expect(created?.status).toBe('ACTIVE');
      expect(created?.pinHash).not.toBe(VALID_PIN);
      expect(created).not.toHaveProperty('pin');
    }
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]?.action).toBe('auth.bootstrap_admin');
    expect(JSON.stringify(auditLogs)).not.toContain(VALID_PIN);
  });

  it('es seguro ante una segunda ejecución: si ya existe un ADMIN activo, no crea otro', async () => {
    const { prisma, users } = createFakePrisma([
      {
        id: 'existing-admin',
        username: 'admin-existente',
        role: 'ADMIN',
        status: 'ACTIVE',
        pinHash: 'hash-cualquiera',
        failedLoginAttempts: 0,
        lockedUntil: null,
        employee: null,
      },
    ]);
    const result = await bootstrapAdmin(prisma as unknown as PrismaClient, {
      username: 'otro-admin',
      pin: VALID_PIN,
    });
    expect(result.created).toBe(false);
    expect(users.size).toBe(1);
  });

  it('rechaza un username ya existente (aunque no sea ADMIN activo)', async () => {
    const { prisma } = createFakePrisma([
      {
        id: 'existing-employee',
        username: 'ya-existe',
        role: 'EMPLOYEE',
        status: 'PENDING_ACTIVATION',
        pinHash: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        employee: null,
      },
    ]);
    const result = await bootstrapAdmin(prisma as unknown as PrismaClient, {
      username: 'ya-existe',
      pin: VALID_PIN,
    });
    expect(result.created).toBe(false);
  });
});
