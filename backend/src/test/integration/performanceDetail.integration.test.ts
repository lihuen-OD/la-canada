import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import { addDays, formatLocalDate, startOfLocalDay, toLocalDate } from '../../lib/businessTime';
import { getPerformance } from '../../performance/performanceService';
import {
  assertNoSyntheticWritesOnRealData,
  assertRealTaskStateUnchanged,
  captureRealTaskState,
  type RealTaskState,
} from './realTaskDataGuard';

/**
 * Tareas → Desempeño → Detalle con filtros y «Ver más», contra `demo` por
 * HTTP real (sesiones y JWT de usuarios SINTÉTICOS). Solo lectura sobre
 * fixtures `[test-detail-<RUN>]` asignados a empleados sintéticos (ninguna
 * tarea real aparece en su detalle); limpieza por id y `realTaskDataGuard`.
 */
const RUN = `test-detail-${Date.now()}`;
const TAG = `[${RUN}]`;
const TZ = config.businessTimeZone;
const today = toLocalDate(new Date(), TZ);
const RANGE = `from=${formatLocalDate(addDays(today, -29))}&to=${formatLocalDate(today)}`;

interface Actor {
  userId: string;
  token: string;
}
let app: Express;
let admin: Actor;
let employeeA: Actor;
let employeeB: Actor;
let empA = '';
let empB = '';
const userIds: string[] = [];
const employeeIds: string[] = [];
const taskIds: string[] = [];
let realState: RealTaskState;

type QueryFn = (...args: unknown[]) => unknown;
const originalQuery = pg.Client.prototype.query as unknown as QueryFn;
let statements = 0;
let counting = false;

async function actorFor(role: 'ADMIN' | 'EMPLOYEE', suffix: string, employeeId?: string) {
  const user = await prisma.user.create({
    data: {
      username: `${RUN}-${suffix}`,
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
  return {
    userId: user.id,
    token: await signAccessToken(
      { userId: user.id, sessionId: session.id, role },
      accessTokenSecret,
      3600,
    ),
  };
}

async function task(name: string, employeeId: string, frequency: 'DAILY' | 'WEEKLY') {
  const row = await prisma.task.create({
    data: { description: `${TAG} ${name}`, employeeId, frequency },
    select: { id: true },
  });
  taskIds.push(row.id);
  await prisma.taskPlanningInterval.create({
    data: {
      taskId: row.id,
      employeeId,
      frequency,
      validFrom: startOfLocalDay(addDays(today, -40), TZ),
    },
  });
  return row.id;
}

const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });
const detailOf = (actor: Actor, employeeId: string, query = '') =>
  request(app).get(`/api/v1/performance/employees/${employeeId}?${RANGE}${query}`).set(as(actor));

beforeAll(async () => {
  expect(process.env.DATABASE_TARGET).toBe('demo');
  realState = await captureRealTaskState();
  app = createApp();
  for (const suffix of ['A', 'B']) {
    const employee = await prisma.employee.create({
      data: {
        code: `${RUN}-${suffix}`,
        displayName: `Sintético ${suffix} ${RUN}`,
        role: 'Test',
        colorHex: '#4a7c59',
      },
      select: { id: true },
    });
    employeeIds.push(employee.id);
  }
  [empA, empB] = employeeIds as [string, string];
  admin = await actorFor('ADMIN', 'admin');
  employeeA = await actorFor('EMPLOYEE', 'emp-a', empA);
  employeeB = await actorFor('EMPLOYEE', 'emp-b', empB);
  // A: dos diarias (30 + 30 en el rango) y una semanal; ayer hizo una diaria y B la otra.
  const first = await task('diaria uno', empA, 'DAILY');
  const second = await task('diaria dos', empA, 'DAILY');
  await task('semanal', empA, 'WEEKLY');
  for (const [taskId, by] of [
    [first, empA],
    [second, empB],
  ] as const) {
    await prisma.taskExecution.create({
      data: {
        taskId,
        periodKey: formatLocalDate(addDays(today, -1)),
        completed: true,
        completedAt: new Date(startOfLocalDay(addDays(today, -1), TZ).getTime() + 15 * 3_600_000),
        assignedEmployeeId: empA,
        completedByEmployeeId: by,
        recordedByUserId: admin.userId,
      },
    });
  }
  (pg.Client.prototype as unknown as { query: QueryFn }).query = function (
    this: unknown,
    ...args: unknown[]
  ) {
    if (counting) statements += 1;
    return originalQuery.apply(this, args);
  };
}, 60_000);

afterAll(async () => {
  (pg.Client.prototype as unknown as { query: QueryFn }).query = originalQuery;
  const executionIds = (
    await prisma.taskExecution.findMany({
      where: { taskId: { in: taskIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  await assertNoSyntheticWritesOnRealData(realState, userIds, [...taskIds, ...executionIds]);
  await prisma.taskExecution.deleteMany({ where: { id: { in: executionIds } } });
  await prisma.taskPlanningInterval.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  await assertRealTaskStateUnchanged(realState, userIds, RUN);
}, 60_000);

describe('detalle de Desempeño con filtros y «Ver más» (HTTP real)', () => {
  it('páginas de 20 con cursor: todas las obligaciones una sola vez, hoy primero, métricas del rango completo', async () => {
    const legacy = await detailOf(employeeA, empA);
    expect(legacy.status).toBe(200);
    expect(legacy.body).not.toHaveProperty('occurrencesPage');
    const total = (legacy.body.occurrences as unknown[]).length;
    expect(total).toBeGreaterThan(40);

    const seen: string[] = [];
    let cursor = '';
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await detailOf(employeeA, empA, `&limit=20${cursor ? `&cursor=${cursor}` : ''}`);
      expect(page.status).toBe(200);
      expect(page.body.occurrencesPage.total).toBe(total);
      expect(page.body.employees).toEqual(legacy.body.employees);
      expect(page.body.team).toEqual(legacy.body.team);
      seen.push(
        ...(page.body.occurrences as { taskId: string; periodKey: string }[]).map(
          (row) => `${row.taskId}|${row.periodKey}`,
        ),
      );
      cursor = page.body.occurrencesPage.nextCursor ?? '';
      if (!cursor) break;
    }
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(seen.slice(0, 2).every((key) => key.endsWith(`|${formatLocalDate(today)}`))).toBe(true);
  });

  it('filtros combinados validados por el backend', async () => {
    const yesterday = formatLocalDate(addDays(today, -1));
    const done = await detailOf(employeeA, empA, `&limit=20&date=${yesterday}&status=personal`);
    expect(done.body.occurrences).toHaveLength(1);
    const covered = await detailOf(employeeA, empA, `&limit=20&status=covered`);
    expect(covered.body.occurrencesPage.total).toBe(1);
    const given = await detailOf(employeeB, empB, `&limit=20&status=coverageGiven`);
    expect(given.body.occurrencesPage.total).toBe(1);
    const weekly = await detailOf(employeeA, empA, `&limit=20&frequency=WEEKLY&date=${yesterday}`);
    expect(weekly.body.occurrences).toHaveLength(1);
    expect(weekly.body.occurrences[0].period.start <= yesterday).toBe(true);
    expect(weekly.body.occurrences[0].period.end >= yesterday).toBe(true);

    const outside = await detailOf(
      employeeA,
      empA,
      `&limit=20&date=${formatLocalDate(addDays(today, -40))}`,
    );
    expect(outside.status).toBe(400);
    expect((await detailOf(employeeA, empA, `&status=todas`)).status).toBe(400);
    expect((await detailOf(employeeA, empA, `&limit=100`)).status).toBe(400);
    expect(
      (await request(app).get(`/api/v1/performance/summary?${RANGE}&status=pending`).set(as(admin)))
        .status,
    ).toBe(400);
  });

  it('permisos: EMPLOYEE solo su detalle; ADMIN el de cualquiera', async () => {
    expect((await detailOf(employeeB, empA, '&limit=20')).status).toBe(403);
    const byAdmin = await detailOf(admin, empA, '&limit=20');
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.occurrences).toHaveLength(20);
  });

  it('el modo detalle usa las mismas sentencias que el detalle de siempre (sin consultas por obligación)', async () => {
    const actor = { userId: employeeA.userId, role: 'EMPLOYEE' as const, employeeId: empA };
    const range = { from: formatLocalDate(addDays(today, -29)), to: formatLocalDate(today) };
    const count = async (run: () => Promise<unknown>) => {
      statements = 0;
      counting = true;
      await run();
      counting = false;
      return statements;
    };
    const legacy = await count(() => getPerformance(actor, range));
    const paged = await count(() =>
      getPerformance(actor, range, undefined, new Date(), { limit: 20, status: 'pending' }),
    );
    expect(paged).toBe(legacy);
  });
});
