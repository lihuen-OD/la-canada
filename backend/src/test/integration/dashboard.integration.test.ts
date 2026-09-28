import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import pg from 'pg';
import { createApp } from '../../app';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { prisma } from '../../lib/prisma';

const RUN = `test-dashboard-${Date.now()}`;
const userIds: string[] = [];
const employeeIds: string[] = [];
let app: Express;
let adminToken = '';
let employeeToken = '';
type QueryFn = (...args: unknown[]) => unknown;
const originalQuery = pg.Client.prototype.query as unknown as QueryFn;
let counting = false;
const statements: string[] = [];

async function createActor(role: 'ADMIN' | 'EMPLOYEE', employeeId?: string) {
  const user = await prisma.user.create({
    data: {
      username: `${RUN}-${role.toLowerCase()}`,
      role,
      status: 'ACTIVE',
      pinHash: 'synthetic-not-a-real-hash',
      employeeId,
    },
    select: { id: true },
  });
  userIds.push(user.id);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashRefreshToken(generateRefreshToken()),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
    select: { id: true },
  });
  return signAccessToken({ userId: user.id, sessionId: session.id, role }, accessTokenSecret, 3600);
}

beforeAll(async () => {
  app = createApp();
  const employee = await prisma.employee.create({
    data: {
      code: `${RUN}-employee`,
      displayName: `Sintético ${RUN}`,
      role: 'Otro',
      colorHex: '#4a7c59',
    },
    select: { id: true },
  });
  employeeIds.push(employee.id);
  adminToken = await createActor('ADMIN');
  employeeToken = await createActor('EMPLOYEE', employee.id);
  (pg.Client.prototype as unknown as { query: QueryFn }).query = function (
    this: unknown,
    ...args: unknown[]
  ) {
    if (counting) {
      const text =
        typeof args[0] === 'string' ? args[0] : ((args[0] as { text?: string })?.text ?? '');
      statements.push(text.trim().split(/\s+/)[0]?.toUpperCase() ?? '?');
    }
    return originalQuery.apply(this, args);
  };
}, 60_000);

afterAll(async () => {
  (pg.Client.prototype as unknown as { query: QueryFn }).query = originalQuery;
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  expect(await prisma.user.count({ where: { username: { startsWith: 'test-dashboard-' } } })).toBe(
    0,
  );
  expect(await prisma.employee.count({ where: { code: { startsWith: 'test-dashboard-' } } })).toBe(
    0,
  );
}, 60_000);

describe('GET /api/v1/dashboard contra demo', () => {
  it.each([
    ['ADMIN', () => adminToken],
    ['EMPLOYEE', () => employeeToken],
  ] as const)('%s recibe solo el DTO explícito y no historiales', async (_role, token) => {
    const response = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(
      [
        'generatedAt',
        'kpis',
        'latestNews',
        'stockAlerts',
        'performance',
        'timeZone',
        'today',
        'upcomingEvents',
        'urgentTasks',
      ].sort(),
    );
    expect(response.body).not.toHaveProperty('users');
    expect(response.body).not.toHaveProperty('history');
  });

  it('mantiene una cantidad fija y acotada de sentencias SQL', async () => {
    statements.length = 0;
    counting = true;
    const response = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    counting = false;
    expect(response.status).toBe(200);
    // Prisma/adapter-pg emite una sentencia por nivel de relación y omite la
    // relación cuando el padre viene vacío: auth 1 + tareas 3–5 + stock 1 +
    // huevos 1 + eventos 1 + novedades 1–2 + cumpleaños 5–7 (Etapa 5F: +1,
    // perfil personal) + desempeño canónico 5 (personas, planificación +
    // tarea, ejecuciones, urgentes) = 18–23. El techo es fijo: nada depende
    // de cuántas filas haya (sin N+1).
    expect(statements.length).toBeGreaterThanOrEqual(18);
    expect(statements.length).toBeLessThanOrEqual(23);
  });
});
