import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client';
import { bootstrapAdmin } from '../../scripts/bootstrapAdmin';
import { createFakePrisma } from './fakePrisma';

const VALID_PASSWORD = 'contraseña de administrador bastante larga';

describe('bootstrapAdmin', () => {
  it('rechaza una contraseña que no cumple la política, sin tocar la base', async () => {
    const { prisma, users } = createFakePrisma();
    const result = await bootstrapAdmin(prisma as unknown as PrismaClient, {
      username: 'admin',
      password: 'corta',
    });
    expect(result.created).toBe(false);
    expect(users.size).toBe(0);
  });

  it('rechaza un username que queda vacío tras normalizarlo', async () => {
    const { prisma } = createFakePrisma();
    const result = await bootstrapAdmin(prisma as unknown as PrismaClient, {
      username: '   ',
      password: VALID_PASSWORD,
    });
    expect(result.created).toBe(false);
  });

  it('crea el primer administrador correctamente', async () => {
    const { prisma, users, auditLogs } = createFakePrisma();
    const result = await bootstrapAdmin(prisma as unknown as PrismaClient, {
      username: 'Admin Principal',
      password: VALID_PASSWORD,
    });
    expect(result.created).toBe(true);
    if (result.created) {
      const created = users.get(result.userId);
      expect(created?.role).toBe('ADMIN');
      expect(created?.status).toBe('ACTIVE');
      expect(created?.passwordHash).not.toBe(VALID_PASSWORD);
      expect(created).not.toHaveProperty('password');
    }
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]?.action).toBe('auth.bootstrap_admin');
  });

  it('es seguro ante una segunda ejecución: si ya existe un ADMIN activo, no crea otro', async () => {
    const { prisma, users } = createFakePrisma([
      {
        id: 'existing-admin',
        username: 'admin-existente',
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash: 'hash-cualquiera',
        employee: null,
      },
    ]);
    const result = await bootstrapAdmin(prisma as unknown as PrismaClient, {
      username: 'otro-admin',
      password: VALID_PASSWORD,
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
        passwordHash: null,
        employee: null,
      },
    ]);
    const result = await bootstrapAdmin(prisma as unknown as PrismaClient, {
      username: 'ya-existe',
      password: VALID_PASSWORD,
    });
    expect(result.created).toBe(false);
  });
});
