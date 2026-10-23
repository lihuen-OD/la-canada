import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import { addDays, computePeriodKey, formatLocalDate, toLocalDate } from '../../lib/businessTime';
import { ForbiddenError, TaskAlreadyCompletedError } from '../../errors/AppError';
import {
  completeTask,
  createTask as createTaskService,
  getWeeklyHistory,
  listTasks,
  revertTaskCompletion,
  updateTask as updateTaskService,
  type TaskActor,
} from '../../tasks/tasksService';
import { getPerformance } from '../../performance/performanceService';
import { getDashboard } from '../../dashboard/dashboardService';

/**
 * «Fecha para realizar» de las «Una vez» y frecuencias BIMESTRAL y ANUAL
 * contra Neon real (`demo`): HTTP real para permisos, validación,
 * concurrencia, reprogramación y reversión con la hora real, y el servicio
 * con un "ahora" controlado para los límites (medianoche de Buenos Aires,
 * bimestres, diciembre/enero, año bisiesto) y para Desempeño/Inicio. Datos
 * SINTÉTICOS con el prefijo `[test-programadas-<RUN_ID>]`; `afterAll` borra
 * solo lo creado (por IDs y prefijo propios) y verifica que los conteos
 * globales y las tareas reales vuelven exactamente a su estado inicial.
 * Ninguna tarea real se completa, edita, reprograma ni reasigna.
 */

const RUN = `test-programadas-${Date.now()}`;
const TAG = `[${RUN}]`;
const TZ = config.businessTimeZone;
const META = { ipAddress: null, userAgent: 'integration-test' };

interface Actor {
  userId: string;
  token: string;
}

let app: Express;
let admin: Actor;
let employeeA: Actor;
let employeeB: Actor;
let empA: string;
let empB: string;
const syntheticUserIds: string[] = [];
const syntheticEmployeeIds: string[] = [];

let baseline: {
  tasks: number;
  executions: number;
  intervals: number;
  audits: number;
  users: number;
  sessions: number;
  employees: number;
};
let realTasksBefore: unknown;
let realExecutionsBefore: unknown;
let realIntervalsBefore: unknown;

const notSynthetic = { NOT: { description: { startsWith: '[test-' } } };

async function snapshotRealTasks() {
  return prisma.task.findMany({
    where: notSynthetic,
    select: {
      id: true,
      description: true,
      employeeId: true,
      frequency: true,
      active: true,
      scheduledDate: true,
      updatedAt: true,
    },
    orderBy: { id: 'asc' },
  });
}

async function snapshotRealExecutions() {
  return prisma.taskExecution.findMany({
    where: { task: notSynthetic },
    select: { id: true, periodKey: true, completed: true, revertedAt: true, updatedAt: true },
    orderBy: { id: 'asc' },
  });
}

async function snapshotRealIntervals() {
  return prisma.taskPlanningInterval.findMany({
    where: { task: notSynthetic },
    select: {
      id: true,
      employeeId: true,
      frequency: true,
      scheduledDate: true,
      validFrom: true,
      validTo: true,
    },
    orderBy: { id: 'asc' },
  });
}

async function createEmployee(suffix: string): Promise<string> {
  const employee = await prisma.employee.create({
    data: {
      code: `${RUN}-${suffix}`,
      displayName: `Sintético ${suffix} ${RUN}`,
      role: 'Test',
      colorHex: '#4a7c59',
    },
    select: { id: true },
  });
  syntheticEmployeeIds.push(employee.id);
  return employee.id;
}

async function createActor(
  role: 'ADMIN' | 'EMPLOYEE',
  suffix: string,
  employeeId?: string,
): Promise<Actor> {
  const user = await prisma.user.create({
    // pinHash sintético no verificable: la sesión se crea directamente.
    data: {
      username: `${RUN}-${suffix}`,
      role,
      status: 'ACTIVE',
      pinHash: 'synthetic-not-a-real-hash',
      employeeId,
    },
    select: { id: true },
  });
  syntheticUserIds.push(user.id);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashRefreshToken(generateRefreshToken()),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
    select: { id: true },
  });
  const token = await signAccessToken(
    { userId: user.id, sessionId: session.id, role },
    accessTokenSecret,
    3600,
  );
  return { userId: user.id, token };
}

const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });
const adminActor = (): TaskActor => ({ userId: admin.userId, role: 'ADMIN', employeeId: null });
const employeeActor = (actor: Actor, employeeId: string): TaskActor => ({
  userId: actor.userId,
  role: 'EMPLOYEE',
  employeeId,
});

/** Fecha de negocio de hoy desplazada `days` días (`YYYY-MM-DD`). */
const businessDay = (days = 0) => formatLocalDate(addDays(toLocalDate(new Date(), TZ), days));
/** Instante `HH:MM` de Buenos Aires (UTC−3) del día local `YYYY-MM-DD`. */
const ar = (day: string, time = '12:00') => new Date(`${day}T${time}:00.000-03:00`);

type TaskBody = {
  id: string;
  frequency: string;
  periodKey: string;
  scheduledDate: string | null;
  scheduleStatus: string | null;
  currentExecution: { id: string; periodKey: string } | null;
  canComplete: boolean;
};

async function createTask(
  description: string,
  employeeId: string,
  frequency: string,
  scheduledDate?: string | null,
) {
  const response = await request(app)
    .post('/api/v1/tasks')
    .set(as(admin))
    .send({
      description: `${TAG} ${description}`,
      employeeId,
      frequency,
      ...(scheduledDate !== undefined ? { scheduledDate } : {}),
    });
  expect(response.status).toBe(201);
  return response.body.task as TaskBody;
}

function patch(actor: Actor, taskId: string, body: Record<string, unknown>) {
  return request(app).patch(`/api/v1/tasks/${taskId}`).set(as(actor)).send(body);
}

function complete(actor: Actor, taskId: string, body: Record<string, unknown> = {}) {
  return request(app).post(`/api/v1/tasks/${taskId}/complete`).set(as(actor)).send(body);
}

function revert(actor: Actor, taskId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/v1/tasks/${taskId}/revert`).set(as(actor)).send(body);
}

async function intervalsOf(taskId: string) {
  const rows = await prisma.taskPlanningInterval.findMany({
    where: { taskId },
    orderBy: { validFrom: 'asc' },
  });
  return rows.map((row) => ({
    employeeId: row.employeeId,
    frequency: row.frequency,
    scheduledDate: row.scheduledDate?.toISOString().slice(0, 10) ?? null,
    open: row.validTo === null,
  }));
}

beforeAll(async () => {
  expect(process.env.DATABASE_TARGET).toBe('demo');
  baseline = {
    tasks: await prisma.task.count(),
    executions: await prisma.taskExecution.count(),
    intervals: await prisma.taskPlanningInterval.count(),
    audits: await prisma.auditLog.count(),
    users: await prisma.user.count(),
    sessions: await prisma.session.count(),
    employees: await prisma.employee.count(),
  };
  realTasksBefore = await snapshotRealTasks();
  realExecutionsBefore = await snapshotRealExecutions();
  realIntervalsBefore = await snapshotRealIntervals();

  app = createApp();
  empA = await createEmployee('A');
  empB = await createEmployee('B');
  admin = await createActor('ADMIN', 'admin');
  employeeA = await createActor('EMPLOYEE', 'emp-a', empA);
  employeeB = await createActor('EMPLOYEE', 'emp-b', empB);
}, 60_000);

afterAll(async () => {
  const testTasks = await prisma.task.findMany({
    where: { description: { startsWith: TAG } },
    select: { id: true },
  });
  const taskIds = testTasks.map((task) => task.id);
  const executions = await prisma.taskExecution.findMany({
    where: { taskId: { in: taskIds } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: syntheticUserIds } },
        { entityId: { in: [...taskIds, ...executions.map((execution) => execution.id)] } },
      ],
    },
  });
  await prisma.taskExecution.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.taskPlanningInterval.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: syntheticUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: syntheticUserIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: syntheticEmployeeIds } } });

  expect(await prisma.task.count()).toBe(baseline.tasks);
  expect(await prisma.taskExecution.count()).toBe(baseline.executions);
  expect(await prisma.taskPlanningInterval.count()).toBe(baseline.intervals);
  expect(await prisma.auditLog.count()).toBe(baseline.audits);
  expect(await prisma.user.count()).toBe(baseline.users);
  expect(await prisma.session.count()).toBe(baseline.sessions);
  expect(await prisma.employee.count()).toBe(baseline.employees);
  expect(await snapshotRealTasks()).toEqual(realTasksBefore);
  expect(await snapshotRealExecutions()).toEqual(realExecutionsBefore);
  expect(await snapshotRealIntervals()).toEqual(realIntervalsBefore);
}, 60_000);

describe('regresión: tareas reales existentes', () => {
  it('siguen sin fecha y sin estado programado; ninguna planificación real tiene fecha', async () => {
    const response = await request(app).get('/api/v1/tasks?status=all').set(as(admin));
    expect(response.status).toBe(200);
    const real = (response.body.tasks as (TaskBody & { description: string })[]).filter(
      (task) => !task.description.startsWith('[test-'),
    );
    expect(real.length).toBeGreaterThan(0);
    for (const task of real) {
      expect(task.scheduledDate).toBeNull();
      expect(task.scheduleStatus).toBeNull();
    }
    expect(
      await prisma.taskPlanningInterval.count({
        where: { task: notSynthetic, scheduledDate: { not: null } },
      }),
    ).toBe(0);
  });
});

// Cada prueba HTTP encadena varios requests contra Neon remoto: 60 s por prueba.
describe('«Una vez» con fecha — alta, validación y permisos (HTTP)', { timeout: 60_000 }, () => {
  it('ADMIN crea con fecha futura, de hoy, pasada y sin fecha; estado del backend', async () => {
    const future = await createTask('futura', empA, 'ONE_TIME', businessDay(10));
    expect(future).toMatchObject({
      periodKey: 'ONE_TIME',
      scheduledDate: businessDay(10),
      scheduleStatus: 'SCHEDULED',
      canComplete: true,
    });
    expect((await createTask('hoy', empA, 'ONE_TIME', businessDay(0))).scheduleStatus).toBe(
      'DUE_TODAY',
    );
    expect((await createTask('pasada', empA, 'ONE_TIME', businessDay(-3))).scheduleStatus).toBe(
      'OVERDUE',
    );
    const undated = await createTask('sin fecha', empA, 'ONE_TIME');
    expect(undated).toMatchObject({ scheduledDate: null, scheduleStatus: null });
    expect((await createTask('null', empA, 'ONE_TIME', null)).scheduledDate).toBeNull();

    expect(await intervalsOf(future.id)).toEqual([
      { employeeId: empA, frequency: 'ONE_TIME', scheduledDate: businessDay(10), open: true },
    ]);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: future.id, action: 'task.created' },
    });
    expect(audit.newState).toMatchObject({ frequency: 'ONE_TIME', scheduledDate: businessDay(10) });
    const undatedAudit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: undated.id, action: 'task.created' },
    });
    expect(undatedAudit.newState).not.toHaveProperty('scheduledDate');
  });

  it.each([
    ['inexistente', '2026-02-30', 'no existe'],
    ['con formato local', '26/10/2026', 'formato'],
    ['fuera de rango', '1999-12-31', 'entre 2000 y 2100'],
  ])('rechaza una fecha %s sin crear nada', async (_label, scheduledDate, message) => {
    const before = await prisma.task.count();
    const response = await request(app)
      .post('/api/v1/tasks')
      .set(as(admin))
      .send({
        description: `${TAG} inválida`,
        employeeId: empA,
        frequency: 'ONE_TIME',
        scheduledDate,
      });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(new RegExp(message));
    expect(await prisma.task.count()).toBe(before);
  });

  it.each(['DAILY', 'WEEKLY', 'SEMI_MONTHLY', 'MONTHLY', 'BIMONTHLY', 'ANNUAL', 'URGENT'])(
    'rechaza una fecha enviada para %s',
    async (frequency) => {
      const response = await request(app)
        .post('/api/v1/tasks')
        .set(as(admin))
        .send({
          description: `${TAG} ${frequency} con fecha`,
          employeeId: empA,
          frequency,
          scheduledDate: businessDay(1),
        });
      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe(
        'La fecha para realizar solo se puede indicar en tareas «Una vez».',
      );
    },
  );

  it('EMPLOYEE no crea ni reprograma (403) y nada cambia', async () => {
    const task = await createTask('permiso fecha', empA, 'ONE_TIME', businessDay(5));
    const created = await request(app)
      .post('/api/v1/tasks')
      .set(as(employeeA))
      .send({
        description: `${TAG} intento`,
        employeeId: empA,
        frequency: 'ONE_TIME',
        scheduledDate: businessDay(1),
      });
    expect(created.status).toBe(403);
    expect((await patch(employeeA, task.id, { scheduledDate: businessDay(1) })).status).toBe(403);
    expect((await patch(employeeA, task.id, { scheduledDate: null })).status).toBe(403);
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).scheduledDate
        ?.toISOString()
        .slice(0, 10),
    ).toBe(businessDay(5));
  });
});

describe(
  '«Una vez» con fecha — completar, revertir y reprogramar (HTTP)',
  { timeout: 60_000 },
  () => {
    it('completar ANTES de la fecha: sale del listado operativo; revertir la devuelve como programada', async () => {
      const task = await createTask('anticipada', empA, 'ONE_TIME', businessDay(7));
      const done = await complete(employeeA, task.id);
      expect(done.status).toBe(201);
      expect(done.body.task).toMatchObject({ scheduleStatus: null, scheduledDate: businessDay(7) });
      expect(done.body.task.currentExecution.periodKey).toBe('ONE_TIME');

      const operational = await request(app).get('/api/v1/tasks').set(as(employeeA));
      expect(operational.body.tasks.map((row: TaskBody) => row.id)).not.toContain(task.id);
      const all = await request(app).get('/api/v1/tasks?status=all').set(as(admin));
      expect(all.body.tasks.find((row: TaskBody) => row.id === task.id)).toMatchObject({
        scheduleStatus: null,
        currentExecution: { periodKey: 'ONE_TIME' },
      });

      // Permisos de siempre: otra persona no deshace lo que no completó.
      expect(
        (await revert(employeeB, task.id, { executionId: done.body.task.currentExecution.id }))
          .status,
      ).toBe(403);
      const undo = await revert(employeeA, task.id, {
        executionId: done.body.task.currentExecution.id,
      });
      expect(undo.status).toBe(200);
      expect(undo.body.task).toMatchObject({
        currentExecution: null,
        scheduleStatus: 'SCHEDULED',
        canComplete: true,
      });
      const back = await request(app).get('/api/v1/tasks').set(as(employeeA));
      expect(back.body.tasks.map((row: TaskBody) => row.id)).toContain(task.id);
    });

    it('doble clic y 8 solicitudes concurrentes: una sola ejecución y una sola auditoría', async () => {
      const task = await createTask('concurrente', empA, 'ONE_TIME', businessDay(-1));
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => complete(employeeA, task.id)),
      );
      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(7);
      const executions = await prisma.taskExecution.findMany({ where: { taskId: task.id } });
      expect(executions.map((row) => row.periodKey)).toEqual(['ONE_TIME']);
      expect(
        await prisma.auditLog.count({
          where: { action: 'task.completed', entityId: executions[0]!.id },
        }),
      ).toBe(1);
    });

    it('reprogramar: nueva versión de planificación, auditoría anterior/nueva, misma obligación', async () => {
      const task = await createTask('reprogramable', empA, 'ONE_TIME', businessDay(-2));
      const moved = await patch(admin, task.id, { scheduledDate: businessDay(4) });
      expect(moved.status).toBe(200);
      expect(moved.body.task).toMatchObject({
        scheduledDate: businessDay(4),
        scheduleStatus: 'SCHEDULED',
        periodKey: 'ONE_TIME',
      });
      expect(await intervalsOf(task.id)).toEqual([
        { employeeId: empA, frequency: 'ONE_TIME', scheduledDate: businessDay(-2), open: false },
        { employeeId: empA, frequency: 'ONE_TIME', scheduledDate: businessDay(4), open: true },
      ]);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: task.id, action: 'task.updated' },
      });
      expect(audit).toMatchObject({
        previousState: { scheduledDate: businessDay(-2) },
        newState: { scheduledDate: businessDay(4) },
      });
      expect(await prisma.taskExecution.count({ where: { taskId: task.id } })).toBe(0);
    });

    it('reprogramar una ya completada no permite completarla otra vez', async () => {
      const task = await createTask('completada y reprogramada', empA, 'ONE_TIME', businessDay(1));
      expect((await complete(employeeA, task.id)).status).toBe(201);
      const moved = await patch(admin, task.id, { scheduledDate: businessDay(20) });
      expect(moved.status).toBe(200);
      expect(moved.body.task).toMatchObject({
        scheduleStatus: null,
        currentExecution: { periodKey: 'ONE_TIME' },
      });
      const again = await complete(admin, task.id, { employeeId: empA });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('TASK_ALREADY_COMPLETED');
      expect(await prisma.taskExecution.count({ where: { taskId: task.id } })).toBe(1);
    });

    it('omitida no cambia, null quita, otra frecuencia rechaza; pasar a recurrente limpia y conserva el antecedente', async () => {
      const task = await createTask('campo omitido o null', empA, 'ONE_TIME', businessDay(3));
      const renamed = await patch(admin, task.id, { description: `${TAG} renombrada` });
      expect(renamed.body.task.scheduledDate).toBe(businessDay(3));
      const cleared = await patch(admin, task.id, { scheduledDate: null });
      expect(cleared.body.task).toMatchObject({ scheduledDate: null, scheduleStatus: null });
      expect((await patch(admin, task.id, { scheduledDate: businessDay(6) })).status).toBe(200);

      // Fecha + frecuencia incompatible: 400 y nada cambia.
      const rejected = await patch(admin, task.id, {
        frequency: 'DAILY',
        scheduledDate: businessDay(6),
      });
      expect(rejected.status).toBe(400);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).frequency).toBe(
        'ONE_TIME',
      );

      const toBimonthly = await patch(admin, task.id, { frequency: 'BIMONTHLY' });
      expect(toBimonthly.status).toBe(200);
      expect(toBimonthly.body.task).toMatchObject({
        frequency: 'BIMONTHLY',
        scheduledDate: null,
        periodKey: computePeriodKey('BIMONTHLY', new Date(), TZ),
      });
      const intervals = await intervalsOf(task.id);
      expect(intervals.at(-2)).toEqual({
        employeeId: empA,
        frequency: 'ONE_TIME',
        scheduledDate: businessDay(6),
        open: false,
      });
      expect(intervals.at(-1)).toEqual({
        employeeId: empA,
        frequency: 'BIMONTHLY',
        scheduledDate: null,
        open: true,
      });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: {
          entityId: task.id,
          action: 'task.updated',
          newState: { path: ['frequency'], equals: 'BIMONTHLY' },
        },
      });
      expect(audit).toMatchObject({
        previousState: { frequency: 'ONE_TIME', scheduledDate: businessDay(6) },
        newState: { frequency: 'BIMONTHLY', scheduledDate: null },
      });
      // Y la fecha ya no se puede poner en una bimestral.
      expect((await patch(admin, task.id, { scheduledDate: businessDay(6) })).status).toBe(400);
    });

    it('desactivar y reactivar conserva la fecha en la versión nueva', async () => {
      const task = await createTask('reactivada', empB, 'ONE_TIME', businessDay(9));
      const off = await request(app)
        .patch(`/api/v1/tasks/${task.id}/status`)
        .set(as(admin))
        .send({ active: false });
      expect(off.status).toBe(200);
      const on = await request(app)
        .patch(`/api/v1/tasks/${task.id}/status`)
        .set(as(admin))
        .send({ active: true });
      expect(on.body.task).toMatchObject({
        scheduledDate: businessDay(9),
        scheduleStatus: 'SCHEDULED',
      });
      expect(await intervalsOf(task.id)).toEqual([
        { employeeId: empB, frequency: 'ONE_TIME', scheduledDate: businessDay(9), open: false },
        { employeeId: empB, frequency: 'ONE_TIME', scheduledDate: businessDay(9), open: true },
      ]);
    });
  },
);

describe(
  'BIMONTHLY y ANNUAL — alta, filtros, concurrencia e historial (HTTP)',
  { timeout: 60_000 },
  () => {
    it('crea, filtra y ordena: mensual → bimestral → anual; «Una vez» con fecha antes que sin fecha', async () => {
      await createTask('orden anual', empB, 'ANNUAL');
      await createTask('orden bimestral', empB, 'BIMONTHLY');
      await createTask('orden mensual', empB, 'MONTHLY');
      await createTask('orden única sin fecha', empB, 'ONE_TIME');
      await createTask('orden única con fecha', empB, 'ONE_TIME', businessDay(2));

      for (const frequency of ['BIMONTHLY', 'ANNUAL']) {
        const filtered = await request(app)
          .get(`/api/v1/tasks?frequency=${frequency}`)
          .set(as(employeeA));
        expect(filtered.status).toBe(200);
        expect(filtered.body.tasks.length).toBeGreaterThan(0);
        expect(filtered.body.tasks.every((row: TaskBody) => row.frequency === frequency)).toBe(
          true,
        );
      }
      const byEmployee = await request(app)
        .get(`/api/v1/tasks?employeeId=${empB}`)
        .set(as(employeeA));
      const rows = (byEmployee.body.tasks as (TaskBody & { description: string })[]).filter((row) =>
        row.description.includes(' orden '),
      );
      expect(rows.map((row) => [row.frequency, row.scheduledDate !== null])).toEqual([
        ['ONE_TIME', true],
        ['ONE_TIME', false],
        ['MONTHLY', false],
        ['BIMONTHLY', false],
        ['ANNUAL', false],
      ]);
      expect(rows.find((row) => row.frequency === 'BIMONTHLY')!.periodKey).toBe(
        computePeriodKey('BIMONTHLY', new Date(), TZ),
      );
      expect(rows.find((row) => row.frequency === 'ANNUAL')!.periodKey).toMatch(/^\d{4}-A$/);
    });

    it.each(['BIMONTHLY', 'ANNUAL'])(
      '%s: 8 solicitudes concurrentes → una sola ejecución del período',
      async (frequency) => {
        const task = await createTask(`concurrente ${frequency}`, empA, frequency);
        const responses = await Promise.all(
          Array.from({ length: 8 }, () => complete(employeeA, task.id)),
        );
        expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
        expect(responses.filter((response) => response.status === 409)).toHaveLength(7);
        const executions = await prisma.taskExecution.findMany({ where: { taskId: task.id } });
        expect(executions.map((row) => row.periodKey)).toEqual([
          computePeriodKey(frequency as Parameters<typeof computePeriodKey>[0], new Date(), TZ),
        ]);
      },
    );

    it('historial semanal: van a «Finalizaciones de la semana», fuera del denominador', async () => {
      const employee = await createEmployee('H');
      const bimonthly = await createTask('historial bimestral', employee, 'BIMONTHLY');
      const annual = await createTask('historial anual', employee, 'ANNUAL');
      const dated = await createTask('historial única', employee, 'ONE_TIME', businessDay(15));
      for (const task of [bimonthly, annual, dated])
        expect((await complete(admin, task.id, { employeeId: employee })).status).toBe(201);
      const history = await request(app)
        .get(`/api/v1/tasks/history?employeeId=${employee}`)
        .set(as(employeeA));
      expect(history.status).toBe(200);
      expect(history.body.recurring).toEqual([]);
      expect(history.body.summary).toEqual({ expected: 0, completed: 0 });
      expect(
        history.body.others.map((row: { task: { id: string } }) => row.task.id).sort(),
      ).toEqual([bimonthly.id, annual.id, dated.id].sort());
      expect(
        history.body.others.find((row: { task: { id: string } }) => row.task.id === dated.id).task
          .scheduledDate,
      ).toBe(businessDay(15));
    });
  },
);

describe('límites con "ahora" controlado (servicio)', () => {
  it('«Una vez»: programada → para hoy → vencida en la medianoche de Buenos Aires, no de UTC', async () => {
    const { task } = await createTaskService(
      adminActor(),
      {
        description: `${TAG} medianoche`,
        employeeId: empB,
        frequency: 'ONE_TIME',
        scheduledDate: '2026-10-26',
      },
      META,
      ar('2026-10-01', '09:00'),
    );
    const status = async (now: Date) =>
      (await listTasks(adminActor(), { status: 'active', employeeId: empB }, now)).tasks.find(
        (row) => row.id === task.id,
      )!.scheduleStatus;
    expect(await status(ar('2026-10-25', '23:59'))).toBe('SCHEDULED');
    // 02:30 UTC del 26 = 23:30 del 25 en Buenos Aires: todavía programada.
    expect(await status(new Date('2026-10-26T02:30:00.000Z'))).toBe('SCHEDULED');
    expect(await status(ar('2026-10-26', '00:00'))).toBe('DUE_TODAY');
    expect(await status(ar('2026-10-26', '23:59'))).toBe('DUE_TODAY');
    expect(await status(ar('2026-10-27', '00:00'))).toBe('OVERDUE');
  }, 60_000);

  it('bimestral: límites sep–oct/nov–dic, diciembre/enero y año bisiesto; reversión dentro del bimestre', async () => {
    const { task } = await createTaskService(
      adminActor(),
      { description: `${TAG} bimestral límites`, employeeId: empA, frequency: 'BIMONTHLY' },
      META,
      ar('2026-09-10', '09:00'),
    );
    const status = async (now: Date) =>
      (await listTasks(adminActor(), { status: 'active', employeeId: empA }, now)).tasks.find(
        (row) => row.id === task.id,
      )!;
    expect(await status(ar('2026-09-10', '10:00'))).toMatchObject({
      periodKey: '2026-B5',
      currentExecution: null,
    });
    await completeTask(adminActor(), task.id, empA, META, ar('2026-10-31', '23:30'));
    await expect(
      completeTask(adminActor(), task.id, empA, META, ar('2026-09-15')),
    ).rejects.toBeInstanceOf(TaskAlreadyCompletedError);
    expect(await status(ar('2026-11-01', '00:00'))).toMatchObject({
      periodKey: '2026-B6',
      currentExecution: null,
      canComplete: true,
    });

    const actor = employeeActor(employeeA, empA);
    const nov = await completeTask(actor, task.id, undefined, META, ar('2026-12-31', '23:00'));
    await expect(
      revertTaskCompletion(
        actor,
        task.id,
        { executionId: nov.task.currentExecution!.id },
        META,
        ar('2027-01-01', '00:00'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await status(ar('2027-01-01', '00:00'))).toMatchObject({
      periodKey: '2027-B1',
      currentExecution: null,
    });

    await completeTask(adminActor(), task.id, empA, META, ar('2028-02-29', '23:30'));
    expect((await status(ar('2028-02-29', '23:59'))).currentExecution?.periodKey).toBe('2028-B1');
    expect(await status(ar('2028-03-01', '00:00'))).toMatchObject({
      periodKey: '2028-B2',
      currentExecution: null,
    });

    const keys = await prisma.taskExecution.findMany({
      where: { taskId: task.id },
      orderBy: { completedAt: 'asc' },
      select: { periodKey: true },
    });
    expect(keys.map((row) => row.periodKey)).toEqual(['2026-B5', '2026-B6', '2028-B1']);
  }, 90_000);

  it('anual: 31/12 23:59 sigue en el año; 01/01 00:00 vuelve a estar pendiente', async () => {
    const { task } = await createTaskService(
      adminActor(),
      { description: `${TAG} anual límites`, employeeId: empA, frequency: 'ANNUAL' },
      META,
      ar('2026-03-01', '09:00'),
    );
    await completeTask(adminActor(), task.id, empA, META, ar('2026-12-31', '23:30'));
    const row = async (now: Date) =>
      (await listTasks(adminActor(), { status: 'active', employeeId: empA }, now)).tasks.find(
        (item) => item.id === task.id,
      )!;
    expect((await row(ar('2026-12-31', '23:59'))).currentExecution?.periodKey).toBe('2026-A');
    expect(await row(ar('2027-01-01', '00:00'))).toMatchObject({
      periodKey: '2027-A',
      currentExecution: null,
    });
  }, 60_000);

  it('cambio de frecuencia: la ejecución bimestral no cumple la mensual ni la anual (claves distintas)', async () => {
    const { task } = await createTaskService(
      adminActor(),
      { description: `${TAG} bimestral cambia`, employeeId: empA, frequency: 'BIMONTHLY' },
      META,
      ar('2026-09-01', '09:00'),
    );
    await completeTask(adminActor(), task.id, empA, META, ar('2026-09-05'));
    const toMonthly = await updateTaskService(
      adminActor(),
      task.id,
      { frequency: 'MONTHLY' },
      META,
      ar('2026-09-06'),
    );
    expect(toMonthly.task).toMatchObject({
      periodKey: '2026-09-01',
      currentExecution: null,
      canComplete: true,
    });
    const toAnnual = await updateTaskService(
      adminActor(),
      task.id,
      { frequency: 'ANNUAL' },
      META,
      ar('2026-09-07'),
    );
    expect(toAnnual.task).toMatchObject({ periodKey: '2026-A', currentExecution: null });
    const back = await updateTaskService(
      adminActor(),
      task.id,
      { frequency: 'BIMONTHLY' },
      META,
      ar('2026-09-08'),
    );
    expect(back.task.currentExecution?.periodKey).toBe('2026-B5');
  }, 60_000);
});

describe('Desempeño e Inicio con "ahora" controlado (servicio)', () => {
  it('futura 0, hoy y vencida pendientes, anticipada propia, cubierta, reprogramada una sola vez', async () => {
    const own = await createEmployee('E');
    const other = await createEmployee('F');
    const make = async (label: string, scheduledDate: string | null, at: Date) =>
      (
        await createTaskService(
          adminActor(),
          {
            description: `${TAG} desempeño ${label}`,
            employeeId: own,
            frequency: 'ONE_TIME',
            scheduledDate,
          },
          META,
          at,
        )
      ).task;
    await make('futura', '2026-10-30', ar('2026-10-10'));
    await make('hoy', '2026-10-22', ar('2026-10-10'));
    await make('vencida', '2026-10-12', ar('2026-10-05'));
    const early = await make('anticipada', '2026-10-30', ar('2026-10-10'));
    const moved = await make('reprogramada', '2026-10-14', ar('2026-10-01'));
    const covered = await make('cubierta', '2026-10-18', ar('2026-10-10'));
    await completeTask(adminActor(), early.id, own, META, ar('2026-10-20'));
    await completeTask(adminActor(), covered.id, other, META, ar('2026-10-19'));

    // Antes de reprogramar: 13–19/10 visto el 19.
    const pastRange = { from: '2026-10-13', to: '2026-10-19' };
    const before = await getPerformance(adminActor(), pastRange, own, ar('2026-10-19', '15:00'));
    await updateTaskService(
      adminActor(),
      moved.id,
      { scheduledDate: '2026-11-05', employeeId: other },
      META,
      ar('2026-10-20'),
    );
    const after = await getPerformance(adminActor(), pastRange, own, ar('2026-10-29', '15:00'));
    const pick = (rows: typeof before.occurrences) =>
      rows!
        .filter((row) => row.taskId === moved.id)
        .map((row) => [row.assignedEmployeeId, row.status, row.scheduledDate]);
    expect(pick(before.occurrences)).toEqual([[own, 'pending', '2026-10-14']]);
    expect(pick(after.occurrences)).toEqual(pick(before.occurrences));

    // 16–22/10 visto el jueves 22 a las 15:00 (rango de Inicio).
    const now = ar('2026-10-22', '15:00');
    const week = await getPerformance(
      adminActor(),
      { from: '2026-10-16', to: '2026-10-22' },
      own,
      now,
    );
    const expected = {
      assigned: 5,
      completedPersonally: 1,
      percentage: 20,
      pending: 3,
      coverageReceived: 1,
      coverageGiven: 0,
    };
    expect(week.employees[0]).toMatchObject(expected);
    expect(week.occurrences!.filter((row) => row.taskId === moved.id)).toHaveLength(1);
    const home = await getDashboard(employeeActor(admin, own), now);
    expect(home.performance?.employees).toEqual([expect.objectContaining(expected)]);
    const list = await listTasks(adminActor(), { status: 'active' }, now);
    expect(home.kpis.tasksTotal).toBe(
      list.tasks.filter((row) => row.scheduleStatus !== 'SCHEDULED').length,
    );
    expect(home.kpis.tasksTotal).toBeLessThan(list.tasks.length);

    // Coke (F) recibe la reprogramada recién cuando vence (05/11): 23–29/10 no la cuenta.
    const later = await getPerformance(
      adminActor(),
      { from: '2026-10-23', to: '2026-10-29' },
      other,
      ar('2026-10-29', '15:00'),
    );
    expect(later.occurrences!.filter((row) => row.taskId === moved.id)).toEqual([]);

    // Historial: la anticipada aparece en la semana en que se completó.
    const history = await getWeeklyHistory(
      adminActor(),
      { week: '2026-10-19', employeeId: own },
      now,
    );
    expect(history.others.map((row) => row.task.id)).toContain(early.id);
    expect(history.summary).toEqual({ expected: 0, completed: 0 });
  }, 120_000);
});
