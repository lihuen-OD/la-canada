import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import { addDays, formatLocalDate, toLocalDate } from '../../lib/businessTime';
import { listTasks } from '../../tasks/tasksService';
import {
  assertNoSyntheticWritesOnRealData,
  assertRealTaskStateUnchanged,
  captureRealTaskState,
  type RealTaskState,
} from './realTaskDataGuard';

/**
 * Listado operativo de Tareas: una urgente completada se oculta, como una
 * «Una vez» completada; se conserva en historial y Desempeño y vuelve al
 * deshacer. Contra `demo` por HTTP real con fixtures `[test-urgent-<RUN>]`
 * (creadas por la API con un ADMIN sintético); limpieza por id y
 * `realTaskDataGuard`.
 */
const RUN = `test-urgent-${Date.now()}`;
const TAG = `[${RUN}]`;
const today = toLocalDate(new Date(), config.businessTimeZone);

interface Actor {
  userId: string;
  token: string;
}
let app: Express;
let admin: Actor;
let employeeA: Actor;
let empA = '';
const userIds: string[] = [];
const employeeIds: string[] = [];
let realState: RealTaskState;

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

const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });
async function createTask(name: string, frequency: string) {
  const response = await request(app)
    .post('/api/v1/tasks')
    .set(as(admin))
    .send({ description: `${TAG} ${name}`, employeeId: empA, frequency });
  expect(response.status).toBe(201);
  return response.body.task.id as string;
}
const complete = (taskId: string) =>
  request(app).post(`/api/v1/tasks/${taskId}/complete`).set(as(employeeA)).send({});
const ids = async (actor: Actor, query = '') =>
  (
    (await request(app).get(`/api/v1/tasks${query}`).set(as(actor))).body.tasks as {
      id: string;
    }[]
  ).map((task) => task.id);
const find = async (actor: Actor, id: string, query = '') =>
  (
    (await request(app).get(`/api/v1/tasks${query}`).set(as(actor))).body.tasks as {
      id: string;
      active: boolean;
      canComplete: boolean;
      currentExecution: { id: string } | null;
    }[]
  ).filter((task) => task.id === id);

beforeAll(async () => {
  expect(process.env.DATABASE_TARGET).toBe('demo');
  realState = await captureRealTaskState();
  app = createApp();
  const employee = await prisma.employee.create({
    data: {
      code: `${RUN}-A`,
      displayName: `Sintético A ${RUN}`,
      role: 'Test',
      colorHex: '#4a7c59',
    },
    select: { id: true },
  });
  employeeIds.push(employee.id);
  empA = employee.id;
  admin = await actorFor('ADMIN', 'admin');
  employeeA = await actorFor('EMPLOYEE', 'emp-a', empA);
}, 60_000);

afterAll(async () => {
  const taskIds = (
    await prisma.task.findMany({
      where: { description: { startsWith: TAG } },
      select: { id: true },
    })
  ).map((row) => row.id);
  const executionIds = (
    await prisma.taskExecution.findMany({
      where: { taskId: { in: taskIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  await assertNoSyntheticWritesOnRealData(realState, userIds, [...taskIds, ...executionIds]);
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ actorUserId: { in: userIds } }, { entityId: { in: [...taskIds, ...executionIds] } }],
    },
  });
  await prisma.taskExecution.deleteMany({ where: { id: { in: executionIds } } });
  await prisma.taskPlanningInterval.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  await assertRealTaskStateUnchanged(realState, userIds, RUN);
}, 60_000);

describe('urgentes completadas fuera del listado operativo', () => {
  it('pendiente visible; completada oculta en «Todas» y «Urgentes»; se conserva en historial, Desempeño, Inicio y la vista de ADMIN; deshacer la devuelve una sola vez', async () => {
    const urgent = await createTask('urgente', 'URGENT');
    expect(await ids(employeeA)).toContain(urgent);
    expect(await ids(employeeA, '?frequency=URGENT')).toContain(urgent);

    expect((await complete(urgent)).status).toBe(201);
    expect(await ids(employeeA)).not.toContain(urgent);
    expect(await ids(employeeA, '?frequency=URGENT')).not.toContain(urgent);
    // Gestión: el ADMIN la sigue viendo (y administrando) con `status=all`.
    const managed = await find(admin, urgent, '?status=all');
    expect(managed).toHaveLength(1);
    expect(managed[0]!.currentExecution).not.toBeNull();
    // Inicio conserva su KPI: el servicio, con la opción de Inicio, la sigue contando.
    const actor = { userId: employeeA.userId, role: 'EMPLOYEE' as const, employeeId: empA };
    const forHome = await listTasks(actor, { status: 'active' }, new Date(), {
      keepCompletedUrgent: true,
    });
    expect(forHome.tasks.find((task) => task.id === urgent)?.currentExecution).not.toBeNull();

    // Historial y Desempeño conservan la finalización.
    const history = await request(app).get('/api/v1/tasks/history').set(as(employeeA));
    const line = (
      history.body.others as { task: { id: string }; execution: { id: string } }[]
    ).find((row) => row.task.id === urgent);
    expect(line).toBeDefined();
    const detail = await request(app)
      .get(
        `/api/v1/performance/employees/${empA}?from=${formatLocalDate(addDays(today, -6))}&to=${formatLocalDate(today)}&limit=50&frequency=URGENT`,
      )
      .set(as(employeeA));
    expect(detail.body.occurrences).toEqual([
      expect.objectContaining({
        taskId: urgent,
        status: 'personal',
        execution: { id: line!.execution.id, canRevert: true },
      }),
    ]);

    // Deshacer (autorizado) → vuelve pendiente, una sola fila, sin borrar nada.
    const reverted = await request(app)
      .post(`/api/v1/tasks/${urgent}/revert`)
      .set(as(employeeA))
      .send({ executionId: line!.execution.id });
    expect(reverted.status).toBe(200);
    const again = await find(employeeA, urgent);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ currentExecution: null, canComplete: true });
    expect(await prisma.taskExecution.count({ where: { taskId: urgent } })).toBe(1);
  });

  it('una urgente desactivada no reaparece como activa al deshacer', async () => {
    const urgent = await createTask('urgente desactivada', 'URGENT');
    expect((await complete(urgent)).status).toBe(201);
    const execution = (await prisma.taskExecution.findFirst({ where: { taskId: urgent } }))!;
    expect(
      (
        await request(app)
          .patch(`/api/v1/tasks/${urgent}/status`)
          .set(as(admin))
          .send({ active: false })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/v1/tasks/${urgent}/revert`)
          .set(as(admin))
          .send({ executionId: execution.id, reason: 'Prueba sintética' })
      ).status,
    ).toBe(200);
    expect(await ids(employeeA)).not.toContain(urgent);
    expect((await find(admin, urgent, '?status=all'))[0]).toMatchObject({
      active: false,
      currentExecution: null,
    });
  });

  it('recurrentes completadas siguen visibles; «Una vez» igual que antes', async () => {
    const daily = await createTask('diaria', 'DAILY');
    const weekly = await createTask('semanal', 'WEEKLY');
    const once = await createTask('una vez', 'ONE_TIME');
    for (const id of [daily, weekly, once]) expect((await complete(id)).status).toBe(201);
    expect((await find(employeeA, daily))[0]?.currentExecution).not.toBeNull();
    expect((await find(employeeA, weekly))[0]?.currentExecution).not.toBeNull();
    expect(await ids(employeeA)).not.toContain(once);
    const all = await ids(employeeA);
    expect(new Set(all).size).toBe(all.length);
  });
});
