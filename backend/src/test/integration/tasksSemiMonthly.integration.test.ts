import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import { computePeriodKey } from '../../lib/businessTime';
import { ForbiddenError, TaskAlreadyCompletedError } from '../../errors/AppError';
import {
  completeTask,
  createTask as createTaskService,
  getWeeklyHistory,
  listTasks,
  revertTaskCompletion,
  type TaskActor,
} from '../../tasks/tasksService';
import { getPerformance } from '../../performance/performanceService';
import { getDashboard } from '../../dashboard/dashboardService';

/**
 * Tareas QUINCENALES contra Neon real (`demo`): HTTP real para permisos,
 * concurrencia, reversión y cambios de frecuencia/asignación con la hora
 * real, y el servicio con un "ahora" controlado para los límites de quincena
 * (día 15 → 16, fin de mes, cambio de año, febrero) y para Desempeño/Inicio.
 * Datos SINTÉTICOS con el prefijo `[test-quincenal-<RUN_ID>]`; `afterAll`
 * borra solo lo creado (por IDs y prefijo propios) y verifica que los
 * conteos globales y las tareas reales vuelven exactamente a su estado
 * inicial. Ninguna tarea real se completa, edita ni reasigna.
 */

const RUN = `test-quincenal-${Date.now()}`;
const TAG = `[${RUN}]`;
const TZ = config.businessTimeZone;
const META = { ipAddress: null, userAgent: 'integration-test' };
const QUINCENA_KEY = /^\d{4}-\d{2}-Q[12]$/;

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
let empC: string;
let empD: string;
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

async function snapshotRealTasks() {
  return prisma.task.findMany({
    where: { NOT: { description: { startsWith: '[test-quincenal-' } } },
    select: {
      id: true,
      description: true,
      employeeId: true,
      frequency: true,
      active: true,
      updatedAt: true,
    },
    orderBy: { id: 'asc' },
  });
}

async function snapshotRealExecutions() {
  return prisma.taskExecution.findMany({
    where: { NOT: { task: { description: { startsWith: '[test-quincenal-' } } } },
    select: { id: true, periodKey: true, completed: true, revertedAt: true, updatedAt: true },
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

async function createTask(description: string, employeeId: string, frequency: string) {
  const response = await request(app)
    .post('/api/v1/tasks')
    .set(as(admin))
    .send({ description: `${TAG} ${description}`, employeeId, frequency });
  expect(response.status).toBe(201);
  return response.body.task as { id: string; periodKey: string; frequency: string };
}

function complete(actor: Actor, taskId: string, body: Record<string, unknown> = {}) {
  return request(app).post(`/api/v1/tasks/${taskId}/complete`).set(as(actor)).send(body);
}

function revert(actor: Actor, taskId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/v1/tasks/${taskId}/revert`).set(as(actor)).send(body);
}

/** Instante `HH:MM` (hora de Buenos Aires, UTC−3) del día local `YYYY-MM-DD`. */
const ar = (day: string, time = '12:00') => new Date(`${day}T${time}:00.000-03:00`);

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

  app = createApp();
  empA = await createEmployee('A');
  empB = await createEmployee('B');
  empC = await createEmployee('C');
  empD = await createEmployee('D');
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
}, 60_000);

describe('quincenales — alta, filtros y permisos (HTTP)', () => {
  it('ADMIN crea una quincenal: período vigente por quincena, planificación y auditoría', async () => {
    const task = await createTask('crear', empA, 'SEMI_MONTHLY');
    expect(task.frequency).toBe('SEMI_MONTHLY');
    expect(task.periodKey).toMatch(QUINCENA_KEY);
    expect(task.periodKey).toBe(computePeriodKey('SEMI_MONTHLY', new Date(), TZ));

    const intervals = await prisma.taskPlanningInterval.findMany({ where: { taskId: task.id } });
    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toMatchObject({ frequency: 'SEMI_MONTHLY', validTo: null });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: task.id, action: 'task.created' },
    });
    expect(audit.newState).toMatchObject({ frequency: 'SEMI_MONTHLY', active: true });
  });

  it('EMPLOYEE no crea ni cambia una tarea a quincenal', async () => {
    const task = await createTask('permiso', empA, 'WEEKLY');
    const create = await request(app)
      .post('/api/v1/tasks')
      .set(as(employeeA))
      .send({ description: `${TAG} intento`, employeeId: empA, frequency: 'SEMI_MONTHLY' });
    const edit = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set(as(employeeA))
      .send({ frequency: 'SEMI_MONTHLY' });
    expect(create.status).toBe(403);
    expect(edit.status).toBe(403);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).frequency).toBe(
      'WEEKLY',
    );
  });

  it('filtra por SEMI_MONTHLY y ordena semanal → quincenal → mensual', async () => {
    await createTask('orden mensual', empB, 'MONTHLY');
    await createTask('orden quincenal', empB, 'SEMI_MONTHLY');
    await createTask('orden semanal', empB, 'WEEKLY');

    const filtered = await request(app)
      .get('/api/v1/tasks?frequency=SEMI_MONTHLY')
      .set(as(employeeA));
    expect(filtered.status).toBe(200);
    expect(filtered.body.tasks.length).toBeGreaterThan(0);
    expect(
      filtered.body.tasks.every((t: { frequency: string }) => t.frequency === 'SEMI_MONTHLY'),
    ).toBe(true);

    const byEmployee = await request(app)
      .get(`/api/v1/tasks?employeeId=${empB}`)
      .set(as(employeeA));
    expect(byEmployee.body.tasks.map((t: { frequency: string }) => t.frequency)).toEqual([
      'WEEKLY',
      'SEMI_MONTHLY',
      'MONTHLY',
    ]);

    const invalid = await request(app).get('/api/v1/tasks?frequency=BIWEEKLY').set(as(employeeA));
    expect(invalid.status).toBe(400);
  });
});

describe('quincenales — completar y revertir (HTTP)', () => {
  it('doble clic y 8 solicitudes concurrentes: una sola ejecución y una sola auditoría', async () => {
    const task = await createTask('concurrente', empA, 'SEMI_MONTHLY');
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => complete(employeeA, task.id)),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(7);
    for (const response of responses.filter((r) => r.status === 409))
      expect(response.body.error.code).toBe('TASK_ALREADY_COMPLETED');

    const executions = await prisma.taskExecution.findMany({ where: { taskId: task.id } });
    expect(executions).toHaveLength(1);
    expect(executions[0]!.periodKey).toBe(task.periodKey);
    expect(
      await prisma.auditLog.count({
        where: { action: 'task.completed', entityId: executions[0]!.id },
      }),
    ).toBe(1);
  });

  it('revertir según las reglas actuales: propia y vigente sí; ajena o de otra quincena no; ADMIN con motivo', async () => {
    const task = await createTask('reversión', empA, 'SEMI_MONTHLY');
    const done = await complete(employeeA, task.id);
    const executionId = done.body.task.currentExecution.id;
    expect(done.body.task.currentExecution.canRevert).toBe(true);

    expect((await revert(employeeB, task.id, { executionId })).status).toBe(403);
    const own = await revert(employeeA, task.id, { executionId });
    expect(own.status).toBe(200);
    expect(own.body.task.currentExecution).toBeNull();
    expect(own.body.task.canComplete).toBe(true);
    expect((await complete(employeeA, task.id)).status).toBe(201);
    expect(await prisma.taskExecution.count({ where: { taskId: task.id } })).toBe(2);

    // Una quincena ya cerrada (16 días atrás siempre cae en otra quincena).
    const pastKey = computePeriodKey(
      'SEMI_MONTHLY',
      new Date(Date.now() - 16 * 24 * 60 * 60 * 1000),
      TZ,
    );
    expect(pastKey).not.toBe(task.periodKey);
    const past = await prisma.taskExecution.create({
      data: {
        taskId: task.id,
        periodKey: pastKey,
        completed: true,
        completedAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000),
        assignedEmployeeId: empA,
        completedByEmployeeId: empA,
        recordedByUserId: employeeA.userId,
      },
    });
    expect((await revert(employeeA, task.id, { executionId: past.id })).status).toBe(403);
    expect((await revert(admin, task.id, { executionId: past.id })).status).toBe(400);
    const corrected = await revert(admin, task.id, {
      executionId: past.id,
      reason: 'Corrección de quincena anterior',
    });
    expect(corrected.status).toBe(200);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: past.id, action: 'task.completion_reverted' },
    });
    expect(audit.newState).toMatchObject({ periodKey: pastKey, administrativeCorrection: true });
  });
});

describe('quincenales — cambio de frecuencia y de asignación (HTTP)', () => {
  it('MONTHLY → SEMI_MONTHLY: la ejecución mensual no se reinterpreta como quincenal', async () => {
    const task = await createTask('de mensual a quincenal', empA, 'MONTHLY');
    const monthly = await complete(employeeA, task.id);
    expect(monthly.status).toBe(201);
    const monthlyExecution = monthly.body.task.currentExecution;
    expect(monthlyExecution.periodKey).toBe(computePeriodKey('MONTHLY', new Date(), TZ));

    const changed = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set(as(admin))
      .send({ frequency: 'SEMI_MONTHLY' });
    expect(changed.status).toBe(200);
    expect(changed.body.task).toMatchObject({
      frequency: 'SEMI_MONTHLY',
      periodKey: computePeriodKey('SEMI_MONTHLY', new Date(), TZ),
      currentExecution: null,
      canComplete: true,
    });

    // La quincena se completa con su propia fila: sin choque con la mensual.
    const semiMonthly = await complete(employeeA, task.id);
    expect(semiMonthly.status).toBe(201);
    const rows = await prisma.taskExecution.findMany({
      where: { taskId: task.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((row) => [row.periodKey, row.completed, row.revertedAt])).toEqual([
      [monthlyExecution.periodKey, true, null],
      [semiMonthly.body.task.currentExecution.periodKey, true, null],
    ]);

    const intervals = await prisma.taskPlanningInterval.findMany({
      where: { taskId: task.id },
      orderBy: { validFrom: 'asc' },
    });
    expect(intervals.map((row) => [row.frequency, row.validTo === null])).toEqual([
      ['MONTHLY', false],
      ['SEMI_MONTHLY', true],
    ]);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: task.id, action: 'task.updated' },
    });
    expect(audit).toMatchObject({
      previousState: { frequency: 'MONTHLY' },
      newState: { frequency: 'SEMI_MONTHLY' },
    });
  });

  it('reasignar una quincenal no cambia el snapshot de la ejecución ni el historial de intervalos', async () => {
    const task = await createTask('reasignable', empB, 'SEMI_MONTHLY');
    expect((await complete(employeeA, task.id)).status).toBe(201);
    const reassigned = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set(as(admin))
      .send({ employeeId: empA });
    expect(reassigned.status).toBe(200);
    expect(reassigned.body.task.assignee.id).toBe(empA);
    expect(reassigned.body.task.currentExecution).toMatchObject({
      assignedEmployee: { id: empB },
      completedByEmployee: { id: empA },
    });
    const intervals = await prisma.taskPlanningInterval.findMany({
      where: { taskId: task.id },
      orderBy: { validFrom: 'asc' },
    });
    expect(intervals.map((row) => [row.employeeId, row.frequency, row.validTo === null])).toEqual([
      [empB, 'SEMI_MONTHLY', false],
      [empA, 'SEMI_MONTHLY', true],
    ]);
  });

  it('historial semanal: la quincenal va a "Finalizaciones de la semana", fuera del denominador diario/semanal', async () => {
    const task = await createTask('historial', empC, 'SEMI_MONTHLY');
    expect((await complete(admin, task.id, { employeeId: empC })).status).toBe(201);
    const history = await request(app)
      .get(`/api/v1/tasks/history?employeeId=${empC}`)
      .set(as(employeeA));
    expect(history.status).toBe(200);
    expect(history.body.recurring).toEqual([]);
    expect(history.body.summary).toEqual({ expected: 0, completed: 0 });
    expect(history.body.others.map((row: { task: { id: string } }) => row.task.id)).toEqual([
      task.id,
    ]);
  });
});

describe('quincenales — límites de período con "ahora" controlado (servicio)', () => {
  it('día 10 cumple la 1.ª quincena; el 15 sigue cumplida; el 16 vuelve a estar pendiente', async () => {
    const { task } = await createTaskService(
      adminActor(),
      { description: `${TAG} límites`, employeeId: empD, frequency: 'SEMI_MONTHLY' },
      META,
      ar('2026-10-01', '09:00'),
    );
    const status = async (now: Date) =>
      (await listTasks(adminActor(), { status: 'active', employeeId: empD }, now)).tasks.find(
        (row) => row.id === task.id,
      )!;

    await completeTask(adminActor(), task.id, empD, META, ar('2026-10-10'));
    expect((await status(ar('2026-10-15', '23:59'))).currentExecution?.periodKey).toBe(
      '2026-10-Q1',
    );
    await expect(
      completeTask(adminActor(), task.id, empD, META, ar('2026-10-15', '23:59')),
    ).rejects.toBeInstanceOf(TaskAlreadyCompletedError);

    const sixteenth = await status(ar('2026-10-16', '00:00'));
    expect(sixteenth).toMatchObject({
      periodKey: '2026-10-Q2',
      currentExecution: null,
      canComplete: true,
    });

    await completeTask(adminActor(), task.id, empD, META, ar('2026-10-20'));
    expect((await status(ar('2026-10-31', '23:59'))).currentExecution?.periodKey).toBe(
      '2026-10-Q2',
    );
    expect(await status(ar('2026-11-01', '00:00'))).toMatchObject({
      periodKey: '2026-11-Q1',
      currentExecution: null,
    });

    // Cambio de año y febrero normal/bisiesto: cada quincena es su propia clave.
    await completeTask(adminActor(), task.id, empD, META, ar('2026-12-31', '23:30'));
    expect(await status(ar('2027-01-01', '00:00'))).toMatchObject({
      periodKey: '2027-01-Q1',
      currentExecution: null,
    });
    await completeTask(adminActor(), task.id, empD, META, ar('2027-02-28', '23:30'));
    expect((await status(ar('2027-03-01', '00:00'))).periodKey).toBe('2027-03-Q1');
    await completeTask(adminActor(), task.id, empD, META, ar('2028-02-29', '23:30'));
    expect((await status(ar('2028-02-29', '23:59'))).currentExecution?.periodKey).toBe(
      '2028-02-Q2',
    );

    const keys = await prisma.taskExecution.findMany({
      where: { taskId: task.id },
      orderBy: { completedAt: 'asc' },
      select: { periodKey: true },
    });
    expect(keys.map((row) => row.periodKey)).toEqual([
      '2026-10-Q1',
      '2026-10-Q2',
      '2026-12-Q2',
      '2027-02-Q2',
      '2028-02-Q2',
    ]);
  }, 90_000);

  it('un EMPLOYEE deshace la propia hasta las 23:59 del 15; desde las 00:00 del 16 ya no', async () => {
    const { task } = await createTaskService(
      adminActor(),
      { description: `${TAG} reversión en el límite`, employeeId: empA, frequency: 'SEMI_MONTHLY' },
      META,
      ar('2026-10-01', '09:00'),
    );
    const actor = employeeActor(employeeA, empA);
    const first = await completeTask(actor, task.id, undefined, META, ar('2026-10-15', '22:00'));
    const firstId = first.task.currentExecution!.id;
    await revertTaskCompletion(
      actor,
      task.id,
      { executionId: firstId },
      META,
      ar('2026-10-15', '23:59'),
    );

    const second = await completeTask(actor, task.id, undefined, META, ar('2026-10-15', '23:59'));
    await expect(
      revertTaskCompletion(
        actor,
        task.id,
        { executionId: second.task.currentExecution!.id },
        META,
        ar('2026-10-16', '00:00'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  }, 60_000);
});

describe('quincenales — Desempeño e Inicio (servicio)', () => {
  it('creada a mitad de quincena: esa quincena cuenta; una obligación por quincena del rango', async () => {
    const employee = await createEmployee('E');
    const { task } = await createTaskService(
      adminActor(),
      { description: `${TAG} desempeño`, employeeId: employee, frequency: 'SEMI_MONTHLY' },
      META,
      ar('2026-09-10', '10:00'),
    );
    await completeTask(adminActor(), task.id, employee, META, ar('2026-09-12'));
    await completeTask(adminActor(), task.id, employee, META, ar('2026-10-05'));
    const now = ar('2026-10-21', '15:00');

    // 30 días (22/09–21/10): quincenas que empiezan el 01/10 y el 16/10.
    const month = await getPerformance(
      adminActor(),
      { from: '2026-09-22', to: '2026-10-21' },
      employee,
      now,
    );
    expect(month.occurrences!.map((row) => [row.periodKey, row.status])).toEqual([
      ['2026-10-Q1', 'personal'],
      ['2026-10-Q2', 'pending'],
    ]);
    expect(month.employees[0]).toMatchObject({
      assigned: 2,
      completedPersonally: 1,
      percentage: 50,
    });

    // 30 días de septiembre: creada el 10/09 (a mitad de la 1.ª quincena), esa quincena cuenta
    // — misma política que una mensual creada a mitad de mes.
    const september = await getPerformance(
      adminActor(),
      { from: '2026-09-01', to: '2026-09-30' },
      employee,
      now,
    );
    expect(september.occurrences!.map((row) => [row.periodKey, row.status])).toEqual([
      ['2026-09-Q1', 'personal'],
      ['2026-09-Q2', 'pending'],
    ]);

    // 14 días (08/09–21/09): solo la quincena que empieza el 16/09; la del 01/09 empieza antes.
    const twoWeeks = await getPerformance(
      adminActor(),
      { from: '2026-09-08', to: '2026-09-21' },
      employee,
      now,
    );
    expect(twoWeeks.occurrences!.map((row) => row.periodKey)).toEqual(['2026-09-Q2']);

    // Inicio = misma función y rango de 7 días (15/10–21/10): solo la quincena del 16.
    const dashboard = await getDashboard(employeeActor(admin, employee), now);
    expect(dashboard.performance?.employees).toEqual([
      expect.objectContaining({ assigned: 1, completedPersonally: 0, pending: 1 }),
    ]);
    const list = await listTasks(adminActor(), { status: 'active' }, now);
    expect(dashboard.kpis.tasksTotal).toBe(list.tasks.length);
    expect(dashboard.kpis.tasksCompleted).toBe(
      list.tasks.filter((row) => row.currentExecution !== null).length,
    );
    expect(list.tasks.find((row) => row.id === task.id)).toMatchObject({
      periodKey: '2026-10-Q2',
      currentExecution: null,
    });

    // El historial de esa semana la muestra como finalización, sin slots esperados.
    const history = await getWeeklyHistory(
      adminActor(),
      { week: '2026-10-05', employeeId: employee },
      now,
    );
    expect(history.summary).toEqual({ expected: 0, completed: 0 });
    expect(history.others.map((row) => row.execution.periodKey)).toEqual(['2026-10-Q1']);
  }, 90_000);
});
