import { beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client';
import { hashPassword } from '../../auth/password';
import { getPublicUserById, login, logout, refresh } from '../../auth/authService';
import { InvalidCredentialsError, InvalidSessionError } from '../../errors/AppError';
import { createFakePrisma, type FakeUserRecord } from './fakePrisma';

const KNOWN_PASSWORD = 'contraseña de prueba bastante larga y segura';
let knownPasswordHash: string;

const META = { ipAddress: '127.0.0.1', userAgent: 'vitest' };

beforeAll(async () => {
  knownPasswordHash = await hashPassword(KNOWN_PASSWORD);
});

function activeUser(overrides: Partial<FakeUserRecord> = {}): FakeUserRecord {
  return {
    id: 'user-active-1',
    username: 'empleada.activa',
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    passwordHash: knownPasswordHash,
    employee: { id: 'employee-1', displayName: 'Empleada Activa', colorHex: '#4a7c59' },
    ...overrides,
  };
}

describe('login', () => {
  it('login válido: crea sesión y devuelve access token + datos públicos', async () => {
    const { prisma, sessions } = createFakePrisma([activeUser()]);
    const result = await login(prisma as unknown as PrismaClient, {
      username: 'empleada.activa',
      password: KNOWN_PASSWORD,
      ...META,
    });
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.user.username).toBe('empleada.activa');
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(sessions.size).toBe(1);
  });

  it('normaliza el username antes de buscarlo (mismo criterio que el seed)', async () => {
    const { prisma } = createFakePrisma([activeUser({ username: 'coke' })]);
    const result = await login(prisma as unknown as PrismaClient, {
      username: '  Coke  ',
      password: KNOWN_PASSWORD,
      ...META,
    });
    expect(result.user.username).toBe('coke');
  });

  it('login con contraseña incorrecta: InvalidCredentialsError genérico', async () => {
    const { prisma } = createFakePrisma([activeUser()]);
    await expect(
      login(prisma as unknown as PrismaClient, {
        username: 'empleada.activa',
        password: 'contraseña-incorrecta',
        ...META,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('usuario inexistente: mismo error genérico que contraseña incorrecta (sin enumeración)', async () => {
    const { prisma } = createFakePrisma([]);
    await expect(
      login(prisma as unknown as PrismaClient, {
        username: 'no-existe',
        password: KNOWN_PASSWORD,
        ...META,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it.each(['PENDING_ACTIVATION', 'SUSPENDED', 'DEACTIVATED'] as const)(
    'usuario en estado %s: mismo error genérico, nunca deja loguear',
    async (status) => {
      const { prisma } = createFakePrisma([activeUser({ status, username: 'no-activo' })]);
      await expect(
        login(prisma as unknown as PrismaClient, {
          username: 'no-activo',
          password: KNOWN_PASSWORD,
          ...META,
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    },
  );

  it('usuario PENDING_ACTIVATION sin passwordHash: no revienta, responde igual que credenciales inválidas', async () => {
    const { prisma } = createFakePrisma([
      activeUser({ status: 'PENDING_ACTIVATION', passwordHash: null, username: 'pendiente' }),
    ]);
    await expect(
      login(prisma as unknown as PrismaClient, {
        username: 'pendiente',
        password: 'cualquier-cosa-larga-1234',
        ...META,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});

describe('refresh', () => {
  async function loginFresh() {
    const fake = createFakePrisma([activeUser()]);
    const result = await login(fake.prisma as unknown as PrismaClient, {
      username: 'empleada.activa',
      password: KNOWN_PASSWORD,
      ...META,
    });
    return { ...fake, firstRefreshToken: result.refreshToken };
  }

  it('refresh válido rota el token — el viejo deja de servir', async () => {
    const { prisma, firstRefreshToken } = await loginFresh();
    const rotated = await refresh(prisma as unknown as PrismaClient, {
      refreshToken: firstRefreshToken,
      ...META,
    });
    expect(rotated.refreshToken).not.toBe(firstRefreshToken);
    expect(rotated.accessToken).toEqual(expect.any(String));

    // El token viejo, reusado, ahora dispara detección de reuso (ver test de abajo) — acá solo confirmamos que ya no es el vigente.
    await expect(
      refresh(prisma as unknown as PrismaClient, { refreshToken: firstRefreshToken, ...META }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });

  it('detecta reutilización de un refresh token revocado y revoca TODAS las sesiones activas del usuario', async () => {
    const { prisma, sessions, firstRefreshToken } = await loginFresh();
    await refresh(prisma as unknown as PrismaClient, { refreshToken: firstRefreshToken, ...META }); // rota una vez

    // Reusar el primero (ya revocado) — debe fallar Y revocar la sesión nueva también.
    await expect(
      refresh(prisma as unknown as PrismaClient, { refreshToken: firstRefreshToken, ...META }),
    ).rejects.toBeInstanceOf(InvalidSessionError);

    const allRevoked = [...sessions.values()].every((s) => s.revokedAt !== null);
    expect(allRevoked).toBe(true);
  });

  it('rechaza un refresh token que no existe', async () => {
    const { prisma } = createFakePrisma([activeUser()]);
    await expect(
      refresh(prisma as unknown as PrismaClient, { refreshToken: 'token-inventado', ...META }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });

  it('rechaza una sesión vencida', async () => {
    const { prisma, firstRefreshToken, sessions } = await loginFresh();
    for (const [id, session] of sessions) {
      sessions.set(id, { ...session, expiresAt: new Date(Date.now() - 1000) });
    }
    await expect(
      refresh(prisma as unknown as PrismaClient, { refreshToken: firstRefreshToken, ...META }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });

  it('rechaza el refresh si el usuario ya no está ACTIVE', async () => {
    const { prisma, users, firstRefreshToken } = await loginFresh();
    const user = users.get('user-active-1');
    if (user) users.set('user-active-1', { ...user, status: 'SUSPENDED' });
    await expect(
      refresh(prisma as unknown as PrismaClient, { refreshToken: firstRefreshToken, ...META }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });
});

describe('logout', () => {
  it('revoca la sesión correspondiente al refresh token', async () => {
    const fake = createFakePrisma([activeUser()]);
    const result = await login(fake.prisma as unknown as PrismaClient, {
      username: 'empleada.activa',
      password: KNOWN_PASSWORD,
      ...META,
    });
    await logout(fake.prisma as unknown as PrismaClient, {
      refreshToken: result.refreshToken,
      ...META,
    });
    const session = [...fake.sessions.values()][0];
    expect(session?.revokedAt).not.toBeNull();
  });

  it('es idempotente: sin cookie, no lanza y no hace nada', async () => {
    const { prisma } = createFakePrisma([]);
    await expect(
      logout(prisma as unknown as PrismaClient, { refreshToken: undefined, ...META }),
    ).resolves.toBeUndefined();
  });

  it('es idempotente: con un token ya revocado (o inexistente), no lanza', async () => {
    const { prisma } = createFakePrisma([]);
    await expect(
      logout(prisma as unknown as PrismaClient, { refreshToken: 'token-que-no-existe', ...META }),
    ).resolves.toBeUndefined();
  });
});

describe('getPublicUserById', () => {
  it('devuelve solo campos públicos, nunca passwordHash', async () => {
    const { prisma } = createFakePrisma([activeUser()]);
    const user = await getPublicUserById(prisma as unknown as PrismaClient, 'user-active-1');
    expect(user).not.toBeNull();
    expect(user).not.toHaveProperty('passwordHash');
    expect(user?.employee?.displayName).toBe('Empleada Activa');
  });

  it('devuelve null si no existe', async () => {
    const { prisma } = createFakePrisma([]);
    const user = await getPublicUserById(prisma as unknown as PrismaClient, 'no-existe');
    expect(user).toBeNull();
  });
});
