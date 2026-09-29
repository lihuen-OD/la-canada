import { beforeAll, describe, expect, it } from 'vitest';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { hashPin } from '../../auth/pin';
import { REFRESH_REPLAY_WINDOW_SECONDS, login, logout, refresh } from '../../auth/authService';
import { refreshRotationKey } from '../../auth/config';
import {
  deriveSuccessorRefreshToken,
  generateRefreshAttemptId,
  hashRefreshToken,
} from '../../auth/tokens';
import { InvalidSessionError, SessionRefreshUnavailableError } from '../../errors/AppError';
import { createFakePrisma, type FakeUserRecord } from './fakePrisma';

/**
 * Etapa 5R — refresh con respuesta perdida. La sucesora se deriva del token
 * presentado y del intento del cliente: el mismo intento la reproduce
 * (reenvío idempotente); cualquier otro sigue siendo reuso.
 */
const KNOWN_PIN = '4821';
const META = { ipAddress: '127.0.0.1', userAgent: 'vitest' };
let knownPinHash: string;

beforeAll(async () => {
  knownPinHash = await hashPin(KNOWN_PIN);
});

function activeUser(): FakeUserRecord {
  return {
    id: crypto.randomUUID(),
    username: 'usuario.sintetico',
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    pinHash: knownPinHash,
    failedLoginAttempts: 0,
    lockedUntil: null,
    employee: { id: 'employee-1', displayName: 'Persona Sintética', colorHex: '#4a7c59' },
    createdAt: new Date(),
  };
}

async function setup() {
  const user = activeUser();
  const fake = createFakePrisma([user]);
  const client = fake.prisma as unknown as PrismaClient;
  const first = await login(client, { userId: user.id, pin: KNOWN_PIN, ...META });
  const active = () => [...fake.sessions.values()].filter((s) => s.revokedAt === null);
  const audits = (action: string) => fake.auditLogs.filter((log) => log.action === action);
  return { ...fake, user, client, token: first.refreshToken, active, audits };
}

const txError = (code: 'P2028' | 'P2034') =>
  new Prisma.PrismaClientKnownRequestError('Transaction API error', {
    code,
    clientVersion: 'fake',
  });

type UpdateManyArgs = { where: Record<string, unknown>; data: unknown };
type UpdateMany = (args: UpdateManyArgs) => Promise<{ count: number }>;

describe('refresh con intento del cliente (Etapa 5R)', () => {
  it('la sucesora es determinística por (token, intento) y distinta para otro intento', () => {
    const a = generateRefreshAttemptId();
    const b = generateRefreshAttemptId();
    expect(deriveSuccessorRefreshToken(refreshRotationKey, 'tok', a)).toBe(
      deriveSuccessorRefreshToken(refreshRotationKey, 'tok', a),
    );
    expect(deriveSuccessorRefreshToken(refreshRotationKey, 'tok', a)).not.toBe(
      deriveSuccessorRefreshToken(refreshRotationKey, 'tok', b),
    );
    expect(deriveSuccessorRefreshToken(refreshRotationKey, 'tok', a)).toMatch(/^[\w-]{43}$/);
  });

  it('respuesta perdida ANTES de rotar: el reenvío rota normalmente, una sola sesión viva', async () => {
    const { client, token, active } = await setup();
    const attemptId = generateRefreshAttemptId();
    // El primer envío nunca llegó al servidor: solo existe el reenvío.
    const result = await refresh(client, { refreshToken: token, attemptId, ...META });
    expect(result.refreshToken).toBe(
      deriveSuccessorRefreshToken(refreshRotationKey, token, attemptId),
    );
    expect(active()).toHaveLength(1);
  });

  it('respuesta perdida DESPUÉS de rotar: el mismo intento recupera la MISMA sucesora, sin revocar nada más', async () => {
    const { client, token, active, audits } = await setup();
    const attemptId = generateRefreshAttemptId();
    const lost = await refresh(client, { refreshToken: token, attemptId, ...META });

    // Recarga posterior: el navegador todavía tiene la cookie vieja y el intento persistido.
    const replayed = await refresh(client, { refreshToken: token, attemptId, ...META });
    expect(replayed.refreshToken).toBe(lost.refreshToken);
    expect(replayed.accessToken).toEqual(expect.any(String));
    expect(active()).toHaveLength(1);
    expect(active()[0]?.refreshTokenHash).toBe(hashRefreshToken(lost.refreshToken));
    expect(audits('auth.refresh.replayed')).toHaveLength(1);
    expect(audits('auth.refresh.reuse_detected')).toHaveLength(0);

    // La sucesora recuperada sigue funcionando para la próxima rotación normal.
    await expect(
      refresh(client, {
        refreshToken: replayed.refreshToken,
        attemptId: generateRefreshAttemptId(),
        ...META,
      }),
    ).resolves.toMatchObject({ refreshToken: expect.any(String) });
  });

  it('una sucesora ya usada no se reproduce: reenviar el intento viejo es reuso y revoca todo', async () => {
    const { client, token, active, audits } = await setup();
    const attemptId = generateRefreshAttemptId();
    const second = await refresh(client, { refreshToken: token, attemptId, ...META });
    await refresh(client, {
      refreshToken: second.refreshToken,
      attemptId: generateRefreshAttemptId(),
      ...META,
    });

    await expect(
      refresh(client, { refreshToken: token, attemptId, ...META }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
    expect(active()).toHaveLength(0);
    expect(audits('auth.refresh.reuse_detected')).toHaveLength(1);
  });

  it.each([
    ['sin intento', undefined],
    ['con otro intento', 'otro-intento-del-atacante-123'],
  ])(
    'reuso malicioso %s de un token rotado: detección de robo y revocación total',
    async (_, attacker) => {
      const { client, token, active, audits } = await setup();
      await refresh(client, {
        refreshToken: token,
        attemptId: generateRefreshAttemptId(),
        ...META,
      });

      await expect(
        refresh(client, { refreshToken: token, attemptId: attacker, ...META }),
      ).rejects.toBeInstanceOf(InvalidSessionError);
      expect(active()).toHaveLength(0);
      expect(audits('auth.refresh.reuse_detected')).toHaveLength(1);
    },
  );

  it('quien reproduce el intento obtiene la misma sucesora: el primero que rota deja al otro en reuso', async () => {
    const { client, token, active, audits } = await setup();
    const attemptId = generateRefreshAttemptId();
    const legit = await refresh(client, { refreshToken: token, attemptId, ...META });
    const copy = await refresh(client, { refreshToken: token, attemptId, ...META });
    expect(copy.refreshToken).toBe(legit.refreshToken);

    await refresh(client, {
      refreshToken: legit.refreshToken,
      attemptId: generateRefreshAttemptId(),
      ...META,
    });
    await expect(
      refresh(client, {
        refreshToken: copy.refreshToken,
        attemptId: generateRefreshAttemptId(),
        ...META,
      }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
    expect(active()).toHaveLength(0);
    expect(audits('auth.refresh.reuse_detected')).toHaveLength(1);
  });

  it('recarga con el pedido todavía en vuelo (mismo intento, concurrente): el perdedor recibe la misma sucesora', async () => {
    const { client, prisma, token, active, audits } = await setup();
    const attemptId = generateRefreshAttemptId();
    const originalUpdateMany = prisma.session.updateMany as UpdateMany;
    let winner: Promise<{ refreshToken: string }> | null = null;
    // El primer pedido gana la fila justo antes de que el segundo la reclame.
    prisma.session.updateMany = async (args: UpdateManyArgs) => {
      if (!winner && args.where.expiresAt) {
        winner = refresh(client, { refreshToken: token, attemptId, ...META });
        await winner;
      }
      return originalUpdateMany(args);
    };

    const loser = await refresh(client, { refreshToken: token, attemptId, ...META });
    const won = await winner!;
    expect(loser.refreshToken).toBe(won.refreshToken);
    expect(active()).toHaveLength(1);
    expect(audits('auth.refresh.concurrent_rotation_detected')).toHaveLength(0);
  });

  it('dos intentos distintos concurrentes con el mismo token siguen siendo una carrera sospechosa', async () => {
    const { client, prisma, token, active, audits } = await setup();
    const originalUpdateMany = prisma.session.updateMany as UpdateMany;
    let raced = false;
    prisma.session.updateMany = async (args: UpdateManyArgs) => {
      if (!raced && args.where.expiresAt) {
        raced = true;
        await refresh(client, {
          refreshToken: token,
          attemptId: generateRefreshAttemptId(),
          ...META,
        });
      }
      return originalUpdateMany(args);
    };

    await expect(
      refresh(client, { refreshToken: token, attemptId: generateRefreshAttemptId(), ...META }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
    expect(active()).toHaveLength(0);
    expect(audits('auth.refresh.concurrent_rotation_detected')).toHaveLength(1);
  });

  it('fuera de la ventana de reenvío: la sucesora huérfana se revoca y responde 401, sin tocar otros dispositivos', async () => {
    const { client, user, token, sessions, active, audits } = await setup();
    const otherDevice = await login(client, { userId: user.id, pin: KNOWN_PIN, ...META });
    const attemptId = generateRefreshAttemptId();
    const lost = await refresh(client, { refreshToken: token, attemptId, ...META });
    const successorHash = hashRefreshToken(lost.refreshToken);
    for (const [id, session] of sessions) {
      if (session.refreshTokenHash === successorHash) {
        sessions.set(id, {
          ...session,
          createdAt: new Date(Date.now() - (REFRESH_REPLAY_WINDOW_SECONDS + 60) * 1000),
        });
      }
    }

    await expect(
      refresh(client, { refreshToken: token, attemptId, ...META }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
    expect(active().map((s) => s.refreshTokenHash)).toEqual([
      hashRefreshToken(otherDevice.refreshToken),
    ]);
    expect(audits('auth.refresh.replay_expired')).toHaveLength(1);
    expect(audits('auth.refresh.reuse_detected')).toHaveLength(0);
  });

  it('cookie vencida: 401 sin revocar las sesiones de otros dispositivos', async () => {
    const { client, user, token, sessions, active, audits } = await setup();
    await login(client, { userId: user.id, pin: KNOWN_PIN, ...META });
    const tokenHash = hashRefreshToken(token);
    for (const [id, session] of sessions) {
      if (session.refreshTokenHash === tokenHash) {
        sessions.set(id, { ...session, expiresAt: new Date(Date.now() - 1000) });
      }
    }
    await expect(
      refresh(client, { refreshToken: token, attemptId: generateRefreshAttemptId(), ...META }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
    // Nada se revocó: ni la vencida (se ignora) ni la del otro dispositivo.
    expect(active()).toHaveLength(2);
    expect(audits('auth.refresh.reuse_detected')).toHaveLength(0);
  });

  it('sesiones legítimas simultáneas (dos dispositivos): el reenvío de uno no afecta al otro', async () => {
    const { client, user, token, active } = await setup();
    const phone = await login(client, { userId: user.id, pin: KNOWN_PIN, ...META });
    const attemptId = generateRefreshAttemptId();
    await refresh(client, { refreshToken: token, attemptId, ...META });
    await refresh(client, { refreshToken: token, attemptId, ...META });
    await refresh(client, {
      refreshToken: phone.refreshToken,
      attemptId: generateRefreshAttemptId(),
      ...META,
    });
    expect(active()).toHaveLength(2);
  });

  it('logout con el intento en duda revoca también la sucesora huérfana, sin detección de reuso', async () => {
    const { client, token, active, audits } = await setup();
    const attemptId = generateRefreshAttemptId();
    await refresh(client, { refreshToken: token, attemptId, ...META });
    expect(active()).toHaveLength(1);

    await logout(client, { refreshToken: token, attemptId, ...META });
    expect(active()).toHaveLength(0);
    expect(audits('auth.logout')).toHaveLength(1);
    expect(audits('auth.refresh.reuse_detected')).toHaveLength(0);
  });

  it('logout con un token rotado y sin intento: no revoca nada ni dispara reuso (idempotente)', async () => {
    const { client, token, active, audits } = await setup();
    await refresh(client, { refreshToken: token, attemptId: generateRefreshAttemptId(), ...META });
    await logout(client, { refreshToken: token, ...META });
    expect(active()).toHaveLength(1);
    expect(audits('auth.refresh.reuse_detected')).toHaveLength(0);
  });

  it('503 AUTH_REFRESH_UNAVAILABLE y reintento con el mismo intento: rota una vez y luego reproduce', async () => {
    const { client, transactionFailures, token, active } = await setup();
    const attemptId = generateRefreshAttemptId();
    transactionFailures.push({ error: txError('P2028') });
    await expect(
      refresh(client, { refreshToken: token, attemptId, ...META }),
    ).rejects.toBeInstanceOf(SessionRefreshUnavailableError);
    expect(active()).toHaveLength(1);

    const rotated = await refresh(client, { refreshToken: token, attemptId, ...META });
    const again = await refresh(client, { refreshToken: token, attemptId, ...META });
    expect(again.refreshToken).toBe(rotated.refreshToken);
    expect(active()).toHaveLength(1);
  });

  it('transacción interrumpida cuando el mismo intento ya había rotado: reenvío, no revocación', async () => {
    const { client, transactionFailures, token, active, audits } = await setup();
    const attemptId = generateRefreshAttemptId();
    const won = await refresh(client, { refreshToken: token, attemptId, ...META });
    transactionFailures.push({ error: txError('P2034') });

    const replayed = await refresh(client, { refreshToken: token, attemptId, ...META });
    expect(replayed.refreshToken).toBe(won.refreshToken);
    expect(active()).toHaveLength(1);
    expect(audits('auth.refresh.concurrent_rotation_detected')).toHaveLength(0);
  });

  it('un usuario suspendido no recupera la sucesora aunque el intento coincida', async () => {
    const { client, users, user, token } = await setup();
    const attemptId = generateRefreshAttemptId();
    await refresh(client, { refreshToken: token, attemptId, ...META });
    users.set(user.id, { ...users.get(user.id)!, status: 'SUSPENDED' });
    await expect(
      refresh(client, { refreshToken: token, attemptId, ...META }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });
});
