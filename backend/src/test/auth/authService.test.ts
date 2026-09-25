import { beforeAll, describe, expect, it } from 'vitest';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { hashPin } from '../../auth/pin';
import { getLoginOptions, getPublicUserById, login, logout, refresh } from '../../auth/authService';
import {
  InvalidCredentialsError,
  InvalidSessionError,
  SessionRefreshUnavailableError,
} from '../../errors/AppError';
import { createFakePrisma, type FakeUserRecord } from './fakePrisma';

const KNOWN_PIN = '4821';
let knownPinHash: string;

const META = { ipAddress: '127.0.0.1', userAgent: 'vitest' };

beforeAll(async () => {
  knownPinHash = await hashPin(KNOWN_PIN);
});

function activeUser(overrides: Partial<FakeUserRecord> = {}): FakeUserRecord {
  return {
    id: crypto.randomUUID(),
    username: 'empleada.activa',
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    pinHash: knownPinHash,
    failedLoginAttempts: 0,
    lockedUntil: null,
    employee: { id: 'employee-1', displayName: 'Empleada Activa', colorHex: '#4a7c59' },
    createdAt: new Date(),
    ...overrides,
  };
}

describe('login', () => {
  it('login válido con PIN correcto: crea sesión y devuelve access token + datos públicos', async () => {
    const user = activeUser();
    const { prisma, sessions } = createFakePrisma([user]);
    const result = await login(prisma as unknown as PrismaClient, {
      userId: user.id,
      pin: KNOWN_PIN,
      ...META,
    });
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.user.id).toBe(user.id);
    expect(result.user).not.toHaveProperty('username');
    expect(result.user).not.toHaveProperty('pinHash');
    expect(sessions.size).toBe(1);
  });

  it('PIN con cero inicial funciona de punta a punta, y su variante sin el cero nunca sirve como si fuera el mismo PIN', async () => {
    const pinWithLeadingZero = '0091';
    const user = activeUser({ pinHash: await hashPin(pinWithLeadingZero) });
    const { prisma } = createFakePrisma([user]);
    const result = await login(prisma as unknown as PrismaClient, {
      userId: user.id,
      pin: pinWithLeadingZero,
      ...META,
    });
    expect(result.accessToken).toEqual(expect.any(String));

    // '91' (como si algo hubiera parseado el string a número y perdido el
    // cero) nunca debe autenticar contra el hash de '0091'.
    await expect(
      login(prisma as unknown as PrismaClient, { userId: user.id, pin: '91', ...META }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('login con PIN incorrecto: InvalidCredentialsError genérico', async () => {
    const user = activeUser();
    const { prisma } = createFakePrisma([user]);
    await expect(
      login(prisma as unknown as PrismaClient, { userId: user.id, pin: '0000', ...META }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('usuario inexistente: mismo error genérico que PIN incorrecto (sin enumeración)', async () => {
    const { prisma } = createFakePrisma([]);
    await expect(
      login(prisma as unknown as PrismaClient, {
        userId: crypto.randomUUID(),
        pin: KNOWN_PIN,
        ...META,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it.each(['PENDING_ACTIVATION', 'SUSPENDED', 'DEACTIVATED'] as const)(
    'usuario en estado %s: mismo error genérico, nunca deja loguear',
    async (status) => {
      const user = activeUser({ status });
      const { prisma } = createFakePrisma([user]);
      await expect(
        login(prisma as unknown as PrismaClient, { userId: user.id, pin: KNOWN_PIN, ...META }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    },
  );

  it('usuario PENDING_ACTIVATION sin pinHash: no revienta, responde igual que credenciales inválidas', async () => {
    const user = activeUser({ status: 'PENDING_ACTIVATION', pinHash: null });
    const { prisma } = createFakePrisma([user]);
    await expect(
      login(prisma as unknown as PrismaClient, { userId: user.id, pin: '1234', ...META }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('nunca incluye el PIN en la auditoría (ni en éxito ni en fallo)', async () => {
    const user = activeUser();
    const { prisma, auditLogs } = createFakePrisma([user]);
    await login(prisma as unknown as PrismaClient, { userId: user.id, pin: KNOWN_PIN, ...META });
    await expect(
      login(prisma as unknown as PrismaClient, { userId: user.id, pin: '0000', ...META }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    const serialized = JSON.stringify(auditLogs);
    expect(serialized).not.toContain(KNOWN_PIN);
    expect(serialized).not.toContain('0000');
  });

  describe('protección contra fuerza bruta', () => {
    it('5 fallos consecutivos bloquean la cuenta', async () => {
      const user = activeUser();
      const { prisma, users } = createFakePrisma([user]);
      for (let i = 0; i < 5; i++) {
        await expect(
          login(prisma as unknown as PrismaClient, { userId: user.id, pin: '0000', ...META }),
        ).rejects.toBeInstanceOf(InvalidCredentialsError);
      }
      const updated = users.get(user.id);
      expect(updated?.failedLoginAttempts).toBe(5);
      expect(updated?.lockedUntil).not.toBeNull();
      expect(updated?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    });

    it('la cuenta bloqueada rechaza el login aunque el PIN sea correcto', async () => {
      const user = activeUser({ lockedUntil: new Date(Date.now() + 60_000) });
      const { prisma } = createFakePrisma([user]);
      await expect(
        login(prisma as unknown as PrismaClient, { userId: user.id, pin: KNOWN_PIN, ...META }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('un bloqueo ya vencido permite volver a intentar', async () => {
      const user = activeUser({ lockedUntil: new Date(Date.now() - 1000) });
      const { prisma } = createFakePrisma([user]);
      await expect(
        login(prisma as unknown as PrismaClient, { userId: user.id, pin: KNOWN_PIN, ...META }),
      ).resolves.toBeDefined();
    });

    it('un login correcto resetea el contador de intentos y el bloqueo', async () => {
      const user = activeUser({ failedLoginAttempts: 3 });
      const { prisma, users } = createFakePrisma([user]);
      await login(prisma as unknown as PrismaClient, { userId: user.id, pin: KNOWN_PIN, ...META });
      const updated = users.get(user.id);
      expect(updated?.failedLoginAttempts).toBe(0);
      expect(updated?.lockedUntil).toBeNull();
    });

    it('un bloqueo nuevo genera además una auditoría distinta de "login fallido"', async () => {
      const user = activeUser();
      const { prisma, auditLogs } = createFakePrisma([user]);
      for (let i = 0; i < 5; i++) {
        await expect(
          login(prisma as unknown as PrismaClient, { userId: user.id, pin: '0000', ...META }),
        ).rejects.toBeInstanceOf(InvalidCredentialsError);
      }
      const lockedAudit = auditLogs.filter((a) => a.action === 'auth.login.locked');
      const failedAudit = auditLogs.filter((a) => a.action === 'auth.login.failed');
      expect(lockedAudit).toHaveLength(1);
      expect(failedAudit).toHaveLength(5);
    });
  });
});

describe('getLoginOptions', () => {
  it('incluye únicamente usuarios ACTIVE, en orden estable por createdAt', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const t1 = new Date('2026-01-02T00:00:00Z');
    const t2 = new Date('2026-01-03T00:00:00Z');
    const active1 = activeUser({
      id: crypto.randomUUID(),
      createdAt: t1,
      employee: { id: 'e1', displayName: 'Segunda', colorHex: '#111111' },
    });
    const active2 = activeUser({
      id: crypto.randomUUID(),
      createdAt: t0,
      employee: { id: 'e2', displayName: 'Primera', colorHex: '#222222' },
    });
    const pending = activeUser({
      id: crypto.randomUUID(),
      status: 'PENDING_ACTIVATION',
      pinHash: null,
      createdAt: t2,
    });
    const suspended = activeUser({ id: crypto.randomUUID(), status: 'SUSPENDED', createdAt: t2 });

    const { prisma } = createFakePrisma([active1, active2, pending, suspended]);
    const options = await getLoginOptions(prisma as unknown as PrismaClient);

    expect(options.map((o) => o.displayName)).toEqual(['Primera', 'Segunda']);
  });

  it('un ADMIN sin Employee vinculado se muestra con la etiqueta genérica "Administrador"', async () => {
    const admin = activeUser({
      id: crypto.randomUUID(),
      role: 'ADMIN',
      employee: null,
    });
    const { prisma } = createFakePrisma([admin]);
    const options = await getLoginOptions(prisma as unknown as PrismaClient);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ id: admin.id, role: 'ADMIN', displayName: 'Administrador' });
  });

  it('un EMPLOYEE sin Employee vinculado (no debería pasar en datos reales) se excluye en vez de exponer el username', async () => {
    const orphanEmployee = activeUser({ id: crypto.randomUUID(), employee: null });
    const { prisma } = createFakePrisma([orphanEmployee]);
    const options = await getLoginOptions(prisma as unknown as PrismaClient);
    expect(options).toHaveLength(0);
  });

  it('nunca expone pinHash, username, intentos fallidos ni fecha de bloqueo', async () => {
    const user = activeUser();
    const { prisma } = createFakePrisma([user]);
    const options = await getLoginOptions(prisma as unknown as PrismaClient);
    expect(options).toHaveLength(1);
    expect(options[0]).not.toHaveProperty('pinHash');
    expect(options[0]).not.toHaveProperty('username');
    expect(options[0]).not.toHaveProperty('failedLoginAttempts');
    expect(options[0]).not.toHaveProperty('lockedUntil');
    expect(options[0]).not.toHaveProperty('status');
  });
});

describe('refresh', () => {
  async function loginFresh() {
    const user = activeUser();
    const fake = createFakePrisma([user]);
    const result = await login(fake.prisma as unknown as PrismaClient, {
      userId: user.id,
      pin: KNOWN_PIN,
      ...META,
    });
    return { ...fake, user, firstRefreshToken: result.refreshToken };
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
    const { prisma, users, user, firstRefreshToken } = await loginFresh();
    const existing = users.get(user.id);
    if (existing) users.set(user.id, { ...existing, status: 'SUSPENDED' });
    await expect(
      refresh(prisma as unknown as PrismaClient, { refreshToken: firstRefreshToken, ...META }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });
});

describe('refresh — transacción interrumpida bajo concurrencia real (Etapa 5P)', () => {
  const txError = (code: 'P2028' | 'P2034') =>
    new Prisma.PrismaClientKnownRequestError('Transaction API error', {
      code,
      clientVersion: 'fake',
    });

  async function loginFresh() {
    const user = activeUser();
    const fake = createFakePrisma([user]);
    const result = await login(fake.prisma as unknown as PrismaClient, {
      userId: user.id,
      pin: KNOWN_PIN,
      ...META,
    });
    return { ...fake, user, token: result.refreshToken };
  }

  it.each(['P2028', 'P2034'] as const)(
    '%s y otra solicitud ya rotó el token → perdedor: 401 genérico + revocación conservadora confirmada',
    async (code) => {
      const fake = await loginFresh();
      const client = fake.prisma as unknown as PrismaClient;
      // El "ganador" concurrente consume el token mientras esta transacción falla.
      fake.transactionFailures.push({
        error: txError(code),
        beforeFail: () => {
          for (const [id, session] of fake.sessions) {
            fake.sessions.set(id, { ...session, revokedAt: new Date() });
          }
          fake.sessions.set('winner', {
            ...[...fake.sessions.values()][0]!,
            id: 'winner',
            refreshTokenHash: 'winner-hash',
            revokedAt: null,
          });
        },
      });
      await expect(refresh(client, { refreshToken: fake.token, ...META })).rejects.toBeInstanceOf(
        InvalidSessionError,
      );
      expect([...fake.sessions.values()].every((session) => session.revokedAt !== null)).toBe(true);
      expect(
        fake.auditLogs.filter((log) => log.action === 'auth.refresh.concurrent_rotation_detected'),
      ).toHaveLength(1);
    },
  );

  it('P2028 sin carrera (sesión intacta) → 503 reintentable, sin rotar ni revocar nada', async () => {
    const fake = await loginFresh();
    const client = fake.prisma as unknown as PrismaClient;
    const auditsBefore = fake.auditLogs.length;
    fake.transactionFailures.push({ error: txError('P2028') });
    const failure = await refresh(client, { refreshToken: fake.token, ...META }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SessionRefreshUnavailableError);
    expect(failure).toMatchObject({ statusCode: 503, code: 'AUTH_REFRESH_UNAVAILABLE' });
    expect([...fake.sessions.values()].filter((s) => s.revokedAt === null)).toHaveLength(1);
    expect(fake.auditLogs).toHaveLength(auditsBefore);
    // El mismo token sigue sirviendo en el reintento.
    await expect(refresh(client, { refreshToken: fake.token, ...META })).resolves.toMatchObject({
      accessToken: expect.any(String),
    });
  });

  it('si también falla la revocación conservadora → 503, nunca un error crudo de Prisma', async () => {
    const fake = await loginFresh();
    const client = fake.prisma as unknown as PrismaClient;
    fake.transactionFailures.push(
      {
        error: txError('P2028'),
        beforeFail: () => {
          for (const [id, session] of fake.sessions) {
            fake.sessions.set(id, { ...session, revokedAt: new Date() });
          }
        },
      },
      { error: txError('P2028') },
    );
    await expect(refresh(client, { refreshToken: fake.token, ...META })).rejects.toBeInstanceOf(
      SessionRefreshUnavailableError,
    );
  });

  it('un error ajeno a la transacción se propaga sin reinterpretarse', async () => {
    const fake = await loginFresh();
    const client = fake.prisma as unknown as PrismaClient;
    fake.transactionFailures.push({ error: new Error('fallo sintético') });
    await expect(refresh(client, { refreshToken: fake.token, ...META })).rejects.toThrow(
      'fallo sintético',
    );
  });
});

describe('logout', () => {
  it('revoca la sesión correspondiente al refresh token', async () => {
    const user = activeUser();
    const fake = createFakePrisma([user]);
    const result = await login(fake.prisma as unknown as PrismaClient, {
      userId: user.id,
      pin: KNOWN_PIN,
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
  it('devuelve solo campos públicos, nunca pinHash ni username', async () => {
    const user = activeUser();
    const { prisma } = createFakePrisma([user]);
    const publicUser = await getPublicUserById(prisma as unknown as PrismaClient, user.id);
    expect(publicUser).not.toBeNull();
    expect(publicUser).not.toHaveProperty('pinHash');
    expect(publicUser).not.toHaveProperty('username');
    expect(publicUser?.employee?.displayName).toBe('Empleada Activa');
  });

  it('devuelve null si no existe', async () => {
    const { prisma } = createFakePrisma([]);
    const user = await getPublicUserById(prisma as unknown as PrismaClient, crypto.randomUUID());
    expect(user).toBeNull();
  });
});

describe('persona dada de baja en Configuración (Etapa 5X, paridad con el prototipo)', () => {
  const inactiveEmployee = {
    id: 'e-baja',
    displayName: 'De baja',
    colorHex: '#333333',
    active: false,
  };

  it('no aparece en el selector de identidad', async () => {
    const user = activeUser({ employee: inactiveEmployee } as Partial<FakeUserRecord>);
    const { prisma } = createFakePrisma([user]);
    expect(await getLoginOptions(prisma as unknown as PrismaClient)).toHaveLength(0);
  });

  it('no puede ingresar aunque el PIN sea correcto (error genérico, sin sesión)', async () => {
    const user = activeUser({ employee: inactiveEmployee } as Partial<FakeUserRecord>);
    const { prisma, sessions } = createFakePrisma([user]);
    await expect(
      login(prisma as unknown as PrismaClient, { userId: user.id, pin: KNOWN_PIN, ...META }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(sessions.size).toBe(0);
  });

  it('los datos públicos nunca exponen el estado interno del empleado', async () => {
    const user = activeUser({
      employee: { id: 'e1', displayName: 'Activa', colorHex: '#4a7c59', active: true },
    } as Partial<FakeUserRecord>);
    const { prisma } = createFakePrisma([user]);
    const result = await login(prisma as unknown as PrismaClient, {
      userId: user.id,
      pin: KNOWN_PIN,
      ...META,
    });
    expect(result.user.employee).toEqual({ id: 'e1', displayName: 'Activa', colorHex: '#4a7c59' });
  });
});
