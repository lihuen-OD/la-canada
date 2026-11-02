import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import {
  addDays,
  formatLocalDate,
  startOfLocalDay,
  startOfWeek,
  toLocalDate,
  type LocalDate,
} from '../../lib/businessTime';
import {
  assertNoSyntheticWritesOnRealData,
  assertRealTaskStateUnchanged,
  captureRealTaskState,
  type RealTaskState,
} from './realTaskDataGuard';

/**
 * «Deshacer» desde Tareas → Desempeño → Detalle contra `demo` por HTTP real:
 * el detalle informa la ejecución y si se puede revertir con la MISMA regla
 * que `POST /tasks/:id/revert` (que sigue siendo la autoridad), y deshacer
 * deja el listado de Tareas como siempre. Fixtures `[test-undo-<RUN>]` de
 * empleados sintéticos; limpieza por id y `realTaskDataGuard`.
 */
const RUN = `test-undo-${Date.now()}`;
const TAG = `[${RUN}]`;
const TZ = config.businessTimeZone;
const today = toLocalDate(new Date(), TZ);
const daysAgo = (n: number) => addDays(today, -n);
const keyOf = (n: number) => formatLocalDate(daysAgo(n));
const at = (date: LocalDate, hours = 0) =>
  new Date(startOfLocalDay(date, TZ).getTime() + hours * 3_600_000);

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
const taskIds: string[] = [];
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

type Frequency = 'DAILY' | 'WEEKLY' | 'URGENT' | 'ONE_TIME';
async function task(name: string, frequency: Frequency, from: Date, to?: Date) {
  const row = await prisma.task.create({
    data: { description: `${TAG} ${name}`, employeeId: empA, frequency, active: to === undefined },
    select: { id: true },
  });
  taskIds.push(row.id);
  await prisma.taskPlanningInterval.create({
    data: { taskId: row.id, employeeId: empA, frequency, validFrom: from, validTo: to ?? null },
  });
  return row.id;
}

/** Ejecución normal pasada (como si se hubiera completado ese día desde Tareas). */
function pastExecution(taskId: string, periodKey: string, completedAt: Date) {
  return prisma.taskExecution.create({
    data: {
      taskId,
      periodKey,
      completed: true,
      completedAt,
      assignedEmployeeId: empA,
      completedByEmployeeId: empA,
      recordedByUserId: employeeA.userId,
    },
  });
}

const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });
const complete = (actor: Actor, taskId: string) =>
  request(app).post(`/api/v1/tasks/${taskId}/complete`).set(as(actor)).send({});
const revert = (actor: Actor, taskId: string, executionId: string, reason?: string) =>
  request(app)
    .post(`/api/v1/tasks/${taskId}/revert`)
    .set(as(actor))
    .send(reason ? { executionId, reason } : { executionId });
const listed = async (actor: Actor) =>
  (await request(app).get('/api/v1/tasks').set(as(actor))).body.tasks as {
    id: string;
    active: boolean;
    canComplete: boolean;
    currentExecution: { id: string } | null;
  }[];

interface DetailRow {
  taskId: string;
  periodKey: string;
  status: string;
  execution?: { id: string; canRevert: boolean };
}
async function detail(actor: Actor) {
  const response = await request(app)
    .get(
      `/api/v1/performance/employees/${empA}?from=${keyOf(6)}&to=${formatLocalDate(today)}&limit=50`,
    )
    .set(as(actor));
  expect(response.status).toBe(200);
  const rows = response.body.occurrences as DetailRow[];
  return {
    body: response.body,
    row: (taskId: string, periodKey: string) =>
      rows.find((item) => item.taskId === taskId && item.periodKey === periodKey),
  };
}

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

describe('deshacer desde el detalle: lo que autoriza el backend', () => {
  it('diaria: hoy se deshace (EMPLOYEE); ayer solo el ADMIN con motivo, sin tocar la de hoy', async () => {
    const daily = await task('diaria', 'DAILY', at(daysAgo(10)));
    const yesterday = await pastExecution(daily, keyOf(1), at(daysAgo(1), 15));
    expect((await complete(employeeA, daily)).status).toBe(201);
    const todayRow = (await prisma.taskExecution.findFirst({
      where: { taskId: daily, periodKey: formatLocalDate(today) },
    }))!;

    // El detalle informa la ejecución y la regla real de reversión.
    const before = await detail(employeeA);
    expect(before.row(daily, formatLocalDate(today))?.execution).toEqual({
      id: todayRow.id,
      canRevert: true,
    });
    expect(before.row(daily, keyOf(1))?.execution).toEqual({ id: yesterday.id, canRevert: false });
    expect((await detail(admin)).row(daily, keyOf(1))?.execution?.canRevert).toBe(true);
    const personalBefore = before.body.employees[0].completedPersonally as number;
    const assignedBefore = before.body.employees[0].assigned as number;

    // Fuera de permiso: el backend lo rechaza aunque alguien mande el pedido.
    const forbidden = await revert(employeeA, daily, yesterday.id);
    expect(forbidden.status).toBe(403);
    expect((await revert(admin, daily, yesterday.id)).status).toBe(400);
    expect((await revert(admin, daily, yesterday.id, 'Cargada por error')).status).toBe(200);

    // Ayer vuelve a «Sin completar»; la de hoy sigue igual (misma fila, vigente).
    const after = await detail(employeeA);
    expect(after.row(daily, keyOf(1))).toMatchObject({ status: 'pending' });
    expect(after.row(daily, keyOf(1))).not.toHaveProperty('execution');
    expect(after.row(daily, formatLocalDate(today))?.execution?.id).toBe(todayRow.id);
    expect(await prisma.taskExecution.findUnique({ where: { id: todayRow.id } })).toMatchObject({
      revertedAt: null,
    });
    expect(after.body.employees[0]).toMatchObject({
      assigned: assignedBefore,
      completedPersonally: personalBefore - 1,
    });
    // Tareas: la única fila de la diaria sigue con la ejecución de hoy.
    const rows = (await listed(employeeA)).filter((row) => row.id === daily);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.currentExecution?.id).toBe(todayRow.id);
    // Reversión lógica y auditada (corrección administrativa).
    expect(await prisma.taskExecution.findUnique({ where: { id: yesterday.id } })).toMatchObject({
      completed: false,
      revertReason: 'Cargada por error',
    });
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'task.completion_reverted', entityId: yesterday.id },
    });
    expect(audit?.newState).toMatchObject({ administrativeCorrection: true });

    // Hoy: el EMPLOYEE la deshace y la recurrente vuelve a pendiente en su única fila.
    expect((await revert(employeeA, daily, todayRow.id)).status).toBe(200);
    const again = (await listed(employeeA)).filter((row) => row.id === daily);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ currentExecution: null, canComplete: true });
  });

  it('«Una vez» completada reaparece pendiente en Tareas; urgente vuelve a pendiente', async () => {
    const once = await task('una vez', 'ONE_TIME', at(daysAgo(3)));
    const urgent = await task('urgente', 'URGENT', at(daysAgo(3)));
    for (const id of [once, urgent]) expect((await complete(employeeA, id)).status).toBe(201);
    expect((await listed(employeeA)).some((row) => row.id === once)).toBe(false);

    const rows = await detail(employeeA);
    for (const [id, key] of [
      [once, 'ONE_TIME'],
      [urgent, 'URGENT'],
    ] as const) {
      const execution = rows.row(id, key)?.execution;
      expect(execution?.canRevert).toBe(true);
      expect((await revert(employeeA, id, execution!.id)).status).toBe(200);
    }
    const list = await listed(employeeA);
    expect(list.find((row) => row.id === once)).toMatchObject({
      currentExecution: null,
      canComplete: true,
    });
    expect(list.find((row) => row.id === urgent)).toMatchObject({
      currentExecution: null,
      canComplete: true,
    });
  });

  it('semanal: deshacer la semana vigente la deja pendiente; sin filas históricas ni duplicadas en Tareas', async () => {
    const weekly = await task('semanal', 'WEEKLY', at(daysAgo(25)));
    const lastMonday = addDays(startOfWeek(today), -7);
    await pastExecution(weekly, formatLocalDate(lastMonday), at(lastMonday, 15));
    expect((await complete(employeeA, weekly)).status).toBe(201);
    const current = (await listed(employeeA)).find((row) => row.id === weekly)!;
    expect((await revert(employeeA, weekly, current.currentExecution!.id)).status).toBe(200);
    const list = await listed(employeeA);
    expect(list.filter((row) => row.id === weekly)).toHaveLength(1);
    expect(list.find((row) => row.id === weekly)).toMatchObject({ currentExecution: null });
    // Ninguna tarea aparece dos veces en el listado.
    expect(new Set(list.map((row) => row.id)).size).toBe(list.length);
  });

  it('deshacer en una tarea desactivada no la reactiva ni abre planificación', async () => {
    const inactive = await task('desactivada', 'DAILY', at(daysAgo(10)), at(daysAgo(1), 8));
    const old = await pastExecution(inactive, keyOf(2), at(daysAgo(2), 15));
    const intervals = await prisma.taskPlanningInterval.count({ where: { taskId: inactive } });
    expect((await revert(admin, inactive, old.id, 'Corrección de prueba')).status).toBe(200);
    expect(await prisma.task.findUnique({ where: { id: inactive } })).toMatchObject({
      active: false,
    });
    expect(await prisma.taskPlanningInterval.count({ where: { taskId: inactive } })).toBe(
      intervals,
    );
    expect((await listed(employeeA)).some((row) => row.id === inactive)).toBe(false);
  });

  it('carga olvidada: el EMPLOYEE la deshace el mismo día desde el detalle', async () => {
    const daily = await task('olvidada', 'DAILY', at(daysAgo(10)));
    const registered = await request(app)
      .post(`/api/v1/tasks/${daily}/late-completion`)
      .set(as(employeeA))
      .send({ periodKey: keyOf(3), performedOn: keyOf(3) });
    expect(registered.status).toBe(201);
    const execution = (await detail(employeeA)).row(daily, keyOf(3))?.execution;
    expect(execution?.canRevert).toBe(true);
    expect((await revert(employeeA, daily, execution!.id)).status).toBe(200);
    expect((await detail(employeeA)).row(daily, keyOf(3))).toMatchObject({ status: 'pending' });
  });

  it('dos reversiones simultáneas (o una pantalla vieja): una aplica, la otra 409 controlado; nada se borra', async () => {
    const daily = await task('concurrente', 'DAILY', at(daysAgo(10)));
    expect((await complete(employeeA, daily)).status).toBe(201);
    const row = (await prisma.taskExecution.findFirst({ where: { taskId: daily } }))!;
    const responses = await Promise.all([
      revert(employeeA, daily, row.id),
      revert(admin, daily, row.id, 'Corrección simultánea'),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const conflict = responses.find((response) => response.status === 409)!;
    expect(conflict.body.error.code).toBe('TASK_EXECUTION_NOT_ACTIVE');
    expect(JSON.stringify(conflict.body)).not.toMatch(/prisma|P20\d\d|stack/i);
    expect(await prisma.taskExecution.count({ where: { taskId: daily } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'task.completion_reverted', entityId: row.id },
      }),
    ).toBe(1);
  });
});
