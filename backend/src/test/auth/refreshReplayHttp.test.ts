import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '../../generated/prisma/client';

/**
 * Etapa 5R — el reenvío idempotente de extremo a extremo por HTTP: cookie
 * `HttpOnly` real, `Origin` validado y el intento en el body. Prisma es el
 * fake en memoria (sin Neon).
 */
vi.mock('../../lib/prisma', async () => {
  const { createFakePrisma } = await import('./fakePrisma.js');
  const fake = createFakePrisma([]);
  return { prisma: fake.prisma, disconnectPrisma: vi.fn(), fake };
});

import * as prismaModule from '../../lib/prisma';
import { hashPin } from '../../auth/pin';
import { login } from '../../auth/authService';
import { createApp } from '../../app';
import type { createFakePrisma } from './fakePrisma';

const fake = (prismaModule as unknown as { fake: ReturnType<typeof createFakePrisma> }).fake;
const ORIGIN = 'http://localhost:5173';
const META = { ipAddress: '127.0.0.1', userAgent: 'vitest' };
let userId: string;

beforeAll(async () => {
  userId = crypto.randomUUID();
  fake.users.set(userId, {
    id: userId,
    username: 'usuario.sintetico.http',
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    pinHash: await hashPin('4821'),
    failedLoginAttempts: 0,
    lockedUntil: null,
    employee: { id: 'employee-http', displayName: 'Persona Sintética', colorHex: '#4a7c59' },
    createdAt: new Date(),
  });
});

async function freshToken(): Promise<string> {
  const result = await login(fake.prisma as unknown as PrismaClient, {
    userId,
    pin: '4821',
    ...META,
  });
  return result.refreshToken;
}

function cookieValue(response: request.Response): string | undefined {
  const raw = response.headers['set-cookie'] as unknown as string[] | undefined;
  return raw
    ?.find((c) => c.startsWith('lc_refresh_token='))
    ?.split(';')[0]
    ?.split('=')[1];
}

const refreshWith = (token: string, body?: unknown) =>
  request(createApp())
    .post('/api/v1/auth/refresh')
    .set('Origin', ORIGIN)
    .set('Cookie', `lc_refresh_token=${token}`)
    .send(body as object);

describe('POST /auth/refresh con intento (HTTP)', () => {
  it('respuesta perdida y recarga: el mismo intento devuelve la misma cookie sucesora', async () => {
    const token = await freshToken();
    const attemptId = 'intento-sintetico-0000000001';
    const first = await refreshWith(token, { attemptId });
    expect(first.status).toBe(200);
    const successor = cookieValue(first);
    expect(successor).toBeDefined();

    // El navegador nunca guardó `first`: vuelve a mandar la cookie vieja.
    const again = await refreshWith(token, { attemptId });
    expect(again.status).toBe(200);
    expect(cookieValue(again)).toBe(successor);
    expect(again.body).toEqual({ accessToken: expect.any(String), expiresIn: expect.any(Number) });
  });

  it('sin body sigue funcionando como antes (rotación sin reenvío posible)', async () => {
    const token = await freshToken();
    const response = await refreshWith(token);
    expect(response.status).toBe(200);
    expect(cookieValue(response)).not.toBe(token);
  });

  it.each([
    ['intento mal formado', { attemptId: 'corto' }],
    ['campo de más', { attemptId: 'intento-sintetico-0000000002', extra: true }],
  ])('%s → 400, sin rotar', async (_, body) => {
    const token = await freshToken();
    const response = await refreshWith(token, body);
    expect(response.status).toBe(400);
    const retry = await refreshWith(token);
    expect(retry.status).toBe(200);
  });

  it('logout con el intento en duda revoca la sucesora y borra la cookie', async () => {
    const token = await freshToken();
    const attemptId = 'intento-sintetico-0000000003';
    const lost = await refreshWith(token, { attemptId });
    const successorHashActive = () =>
      [...fake.sessions.values()].filter((s) => s.revokedAt === null).length;
    const before = successorHashActive();

    const response = await request(createApp())
      .post('/api/v1/auth/logout')
      .set('Origin', ORIGIN)
      .set('Cookie', `lc_refresh_token=${token}`)
      .send({ attemptId });
    expect(response.status).toBe(204);
    expect(successorHashActive()).toBe(before - 1);

    const replay = await refreshWith(token, { attemptId });
    expect(replay.status).toBe(401);
    expect(cookieValue(lost)).toBeDefined();
  });
});
