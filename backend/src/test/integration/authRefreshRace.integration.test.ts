import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { REFRESH_TOKEN_COOKIE_NAME } from '../../config/cookies';
import { refresh } from '../../auth/authService';
import { generateRefreshToken, hashRefreshToken } from '../../auth/tokens';
import { InvalidSessionError } from '../../errors/AppError';

/**
 * Etapa 5P — carrera del refresh concurrente contra Neon real (`demo`).
 * Reproduce, en varias rondas, dos o tres `refresh` simultáneos con el MISMO
 * refresh token — a nivel servicio y por HTTP real — y exige:
 *  - exactamente una rotación exitosa por ronda;
 *  - todos los perdedores reciben `InvalidSessionError` (HTTP 401 genérico),
 *    nunca un error crudo de Prisma/Postgres ni un 500;
 *  - la revocación conservadora queda CONFIRMADA: al terminar la ronda no
 *    queda ninguna sesión activa utilizable del usuario, y hay auditoría.
 * Solo usa un usuario sintético `test-5p-<RUN>` (sin PIN real: las sesiones
 * se crean directamente) y borra todo lo que crea.
 */

const RUN = `test-5p-${Date.now()}`;
const META = { ipAddress: '127.0.0.1', userAgent: 'vitest-integration' };
let app: Express;
let userId = '';
let baseline: { users: number; sessions: number; audits: number };

async function freshSession(): Promise<string> {
  const token = generateRefreshToken();
  await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashRefreshToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return token;
}

const activeSessions = () => prisma.session.count({ where: { userId, revokedAt: null } });

function describeFailure(reason: unknown): string {
  if (reason instanceof InvalidSessionError) return 'InvalidSessionError';
  const error = reason as { name?: string; code?: string; message?: string };
  return `${error.name ?? 'Error'}:${error.code ?? '-'}:${(error.message ?? '').split('\n')[0]}`;
}

beforeAll(async () => {
  baseline = {
    users: await prisma.user.count(),
    sessions: await prisma.session.count(),
    audits: await prisma.auditLog.count(),
  };
  app = createApp();
  const user = await prisma.user.create({
    data: {
      username: RUN,
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      // Sintético y no verificable: este usuario nunca hace login por PIN.
      pinHash: 'synthetic-not-a-real-hash',
    },
    select: { id: true },
  });
  userId = user.id;
}, 60_000);

afterAll(async () => {
  if (userId) {
    const sessionIds = (
      await prisma.session.findMany({ where: { userId }, select: { id: true } })
    ).map((session) => session.id);
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorUserId: userId }, { entityId: { in: [userId, ...sessionIds] } }] },
    });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  }
  expect(await prisma.user.count()).toBe(baseline.users);
  expect(await prisma.session.count()).toBe(baseline.sessions);
  expect(await prisma.auditLog.count()).toBe(baseline.audits);
  expect(await prisma.user.count({ where: { username: { startsWith: 'test-5p-' } } })).toBe(0);
}, 60_000);

describe('refresh concurrente — nunca 500, una sola rotación, revocación confirmada', () => {
  it.each([2, 2, 2, 3, 3, 4])(
    'servicio: %i refresh simultáneos con el mismo token',
    async (parallel) => {
      const token = await freshSession();
      const results = await Promise.allSettled(
        Array.from({ length: parallel }, () => refresh(prisma, { refreshToken: token, ...META })),
      );
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => describeFailure(result.reason));
      // Evidencia de diagnóstico: forma exacta de cada perdedor.
      // eslint-disable-next-line no-console -- solo nombres/códigos de error, sin datos
      console.info(`[5p] servicio x${parallel}: ${JSON.stringify(failures)}`);
      expect(failures.every((failure) => failure === 'InvalidSessionError')).toBe(true);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(failures).toHaveLength(parallel - 1);
      // Revocación conservadora confirmada: ni la vieja ni la recién creada siguen activas.
      expect(await activeSessions()).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: {
            actorUserId: userId,
            action: {
              in: ['auth.refresh.concurrent_rotation_detected', 'auth.refresh.reuse_detected'],
            },
          },
        }),
      ).toBeGreaterThan(0);
    },
    60_000,
  );

  it.each([2, 3])(
    'HTTP: %i POST /auth/refresh simultáneos → un 200 y el resto 401 genérico, nunca 500',
    async (parallel) => {
      const token = await freshSession();
      const responses = await Promise.all(
        Array.from({ length: parallel }, () =>
          request(app)
            .post('/api/v1/auth/refresh')
            .set('Origin', config.frontendUrl)
            .set('Cookie', `${REFRESH_TOKEN_COOKIE_NAME}=${token}`),
        ),
      );
      const statuses = responses.map((response) => response.status);
      // eslint-disable-next-line no-console -- solo códigos HTTP
      console.info(`[5p] HTTP x${parallel}: ${JSON.stringify(statuses)}`);
      expect(statuses).not.toContain(500);
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      for (const response of responses.filter((r) => r.status !== 200)) {
        expect(response.status).toBe(401);
        expect(response.body).toEqual({
          error: { message: 'Sesión inválida o expirada.', code: 'AUTH_SESSION_INVALID' },
        });
      }
      expect(await activeSessions()).toBe(0);
    },
    60_000,
  );
});
