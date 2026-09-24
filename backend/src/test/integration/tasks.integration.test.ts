import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import { addDays, computePeriodKey, formatLocalDate, toLocalDate } from '../../lib/businessTime';

/**
 * Módulo Tareas contra Neon real (`demo`), por HTTP real (app Express
 * completa, `requireAuth` real con sesiones y JWT reales de usuarios
 * SINTÉTICOS). Reglas de datos:
 *  - todo lo creado lleva el prefijo `[test-4a-<RUN_ID>]` / `test-4a-<RUN_ID>`;
 *  - nunca se completa, reasigna ni edita ninguna tarea preexistente
 *    (solo aparecen en respuestas de lectura);
 *  - `afterAll` borra ejecuciones, auditorías, tareas, sesiones, usuarios y
 *    empleados sintéticos, y verifica que los conteos globales y las tareas
 *    reales vuelven exactamente a su estado inicial.
 */

const RUN = `test-4a-${Date.now()}`;
const TAG = `[${RUN}]`;
const TZ = config.businessTimeZone;

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
let empInactive: string;
const syntheticUserIds: string[] = [];
const syntheticEmployeeIds: string[] = [];

let baseline: {
  tasks: number;
  executions: number;
  audits: number;
  users: number;
  sessions: number;
  employees: number;
};
let realTasksBefore: unknown;

async function snapshotRealTasks() {
  return prisma.task.findMany({
    where: { NOT: { description: { startsWith: '[test-4a-' } } },
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

async function createEmployee(suffix: string, active = true): Promise<string> {
  const employee = await prisma.employee.create({
    data: {
      code: `${RUN}-${suffix}`,
      displayName: `Sintético ${suffix} ${RUN}`,
      role: 'Test',
      colorHex: '#4a7c59',
      active,
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
    // pinHash sintético no verificable: estos usuarios nunca hacen login por PIN
    // (la sesión se crea directamente), solo necesitan cumplir el CHECK de ACTIVE.
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

async function createTask(description: string, employeeId: string, frequency: string) {
  const response = await request(app)
    .post('/api/v1/tasks')
    .set(as(admin))
    .send({ description: `${TAG} ${description}`, employeeId, frequency });
  expect(response.status).toBe(201);
  return response.body.task as { id: string; periodKey: string };
}

function complete(actor: Actor, taskId: string, body: Record<string, unknown> = {}) {
  return request(app).post(`/api/v1/tasks/${taskId}/complete`).set(as(actor)).send(body);
}

function expectCleanError(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/prisma|P20\d\d|stack|constraint|SELECT|INSERT/i);
  expect(Object.keys((body as { error: object }).error).sort()).toEqual(['code', 'message']);
}

beforeAll(async () => {
  baseline = {
    tasks: await prisma.task.count(),
    executions: await prisma.taskExecution.count(),
    audits: await prisma.auditLog.count(),
    users: await prisma.user.count(),
    sessions: await prisma.session.count(),
    employees: await prisma.employee.count(),
  };
  realTasksBefore = await snapshotRealTasks();

  app = createApp();
  empA = await createEmployee('A');
  empB = await createEmployee('B');
  empInactive = await createEmployee('inactivo', false);
  admin = await createActor('ADMIN', 'admin');
  employeeA = await createActor('EMPLOYEE', 'emp-a', empA);
  employeeB = await createActor('EMPLOYEE', 'emp-b', empB);
});

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
  expect(await prisma.auditLog.count()).toBe(baseline.audits);
  expect(await prisma.user.count()).toBe(baseline.users);
  expect(await prisma.session.count()).toBe(baseline.sessions);
  expect(await prisma.employee.count()).toBe(baseline.employees);
  expect(await snapshotRealTasks()).toEqual(realTasksBefore);
  expect(
    await prisma.task.count({ where: { NOT: { description: { startsWith: '[test-4a-' } } } }),
  ).toBe((realTasksBefore as unknown[]).length);
});

describe('tareas — visibilidad y filtros', () => {
  it('EMPLOYEE lista las tareas activas preexistentes, sin modificarlas', async () => {
    const response = await request(app).get('/api/v1/tasks').set(as(employeeA));
    expect(response.status).toBe(200);
    expect(response.body.tasks.length).toBeGreaterThanOrEqual((realTasksBefore as unknown[]).length);
    expect(response.body.tasks.every((task: { active: boolean }) => task.active)).toBe(true);
    expect(response.body.period.timeZone).toBe(TZ);
  });

  it('EMPLOYEE no puede listar desactivadas; ADMIN sí', async () => {
    const task = await createTask('para desactivar', empA, 'DAILY');
    await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(as(admin))
      .send({ active: false });

    const denied = await request(app).get('/api/v1/tasks?status=inactive').set(as(employeeA));
    expect(denied.status).toBe(403);
    expectCleanError(denied.body);

    const allowed = await request(app).get('/api/v1/tasks?status=inactive').set(as(admin));
    expect(allowed.status).toBe(200);
    expect(allowed.body.tasks.map((t: { id: string }) => t.id)).toContain(task.id);
    expect(allowed.body.tasks.every((t: { active: boolean }) => !t.active)).toBe(true);
  });

  it('filtra por responsable y por frecuencia', async () => {
    await createTask('semanal de B', empB, 'WEEKLY');
    const byEmployee = await request(app)
      .get(`/api/v1/tasks?employeeId=${empB}`)
      .set(as(employeeA));
    expect(byEmployee.body.tasks.length).toBeGreaterThan(0);
    expect(
      byEmployee.body.tasks.every((t: { assignee: { id: string } }) => t.assignee.id === empB),
    ).toBe(true);

    const byFrequency = await request(app).get('/api/v1/tasks?frequency=WEEKLY').set(as(employeeA));
    expect(
      byFrequency.body.tasks.every((t: { frequency: string }) => t.frequency === 'WEEKLY'),
    ).toBe(true);
  });

  it('GET /tasks/employees devuelve solo empleados activos', async () => {
    const response = await request(app).get('/api/v1/tasks/employees').set(as(employeeA));
    const ids = response.body.employees.map((employee: { id: string }) => employee.id);
    expect(ids).toEqual(expect.arrayContaining([empA, empB]));
    expect(ids).not.toContain(empInactive);
  });
});

describe('tareas — administración', () => {
  it('solo ADMIN crea, edita y activa/desactiva', async () => {
    const task = await createTask('permisos', empA, 'DAILY');
    const create = await request(app)
      .post('/api/v1/tasks')
      .set(as(employeeA))
      .send({ description: `${TAG} intento`, employeeId: empA, frequency: 'DAILY' });
    const edit = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set(as(employeeA))
      .send({ frequency: 'WEEKLY' });
    const status = await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(as(employeeA))
      .send({ active: false });
    for (const response of [create, edit, status]) {
      expect(response.status).toBe(403);
      expectCleanError(response.body);
    }
  });

  it('rechaza descripción inválida, responsable inexistente o inactivo, y duplicados', async () => {
    const invalid = await request(app)
      .post('/api/v1/tasks')
      .set(as(admin))
      .send({ description: '<b>x</b>', employeeId: empA, frequency: 'DAILY' });
    expect(invalid.status).toBe(400);

    const missing = await request(app)
      .post('/api/v1/tasks')
      .set(as(admin))
      .send({
        description: `${TAG} fantasma`,
        employeeId: crypto.randomUUID(),
        frequency: 'DAILY',
      });
    expect(missing.status).toBe(400);

    const inactive = await request(app)
      .post('/api/v1/tasks')
      .set(as(admin))
      .send({ description: `${TAG} inactivo`, employeeId: empInactive, frequency: 'DAILY' });
    expect(inactive.status).toBe(400);

    await createTask('duplicada', empA, 'DAILY');
    const duplicate = await request(app)
      .post('/api/v1/tasks')
      .set(as(admin))
      .send({ description: `${TAG}   duplicada `, employeeId: empA, frequency: 'WEEKLY' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('TASK_DUPLICATE');
    for (const response of [invalid, missing, inactive, duplicate]) expectCleanError(response.body);
  });

  it('crear/editar/desactivar/reactivar quedan auditados con cambios relevantes', async () => {
    const task = await createTask('auditada', empA, 'DAILY');
    await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set(as(admin))
      .send({ frequency: 'MONTHLY' });
    await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(as(admin))
      .send({ active: false });
    await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(as(admin))
      .send({ active: true });

    const audits = await prisma.auditLog.findMany({
      where: { entityId: task.id },
      orderBy: { createdAt: 'asc' },
      select: { action: true, actorUserId: true, previousState: true, newState: true },
    });
    expect(audits.map((audit) => audit.action)).toEqual([
      'task.created',
      'task.updated',
      'task.deactivated',
      'task.activated',
    ]);
    expect(audits.every((audit) => audit.actorUserId === admin.userId)).toBe(true);
    expect(audits[1]).toMatchObject({
      previousState: { frequency: 'DAILY' },
      newState: { frequency: 'MONTHLY' },
    });
  });
});

describe('tareas — completar', () => {
  it('EMPLOYEE completa con su propia identidad; el snapshot copia al responsable vigente', async () => {
    const task = await createTask('asignada a B', empB, 'DAILY');
    const response = await complete(employeeA, task.id);
    expect(response.status).toBe(201);
    expect(response.body.task.currentExecution).toMatchObject({
      assignedEmployee: { id: empB },
      completedByEmployee: { id: empA },
      periodKey: computePeriodKey('DAILY', new Date(), TZ),
    });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'task.completed', entityId: response.body.task.currentExecution.id },
    });
    expect(audit?.actorUserId).toBe(employeeA.userId);
    expect(audit?.newState).toMatchObject({
      assignedEmployeeId: empB,
      completedByEmployeeId: empA,
      actorRole: 'EMPLOYEE',
      registeredOnBehalf: false,
    });
    expect(JSON.stringify(audit)).not.toMatch(/Bearer|token|pin/i);
  });

  it('EMPLOYEE no puede falsificar al ejecutor', async () => {
    const task = await createTask('falsificación', empA, 'DAILY');
    const otherEmployee = await complete(employeeA, task.id, { employeeId: empB });
    expect(otherEmployee.status).toBe(403);
    const extraField = await complete(employeeA, task.id, { completedByEmployeeId: empB });
    expect(extraField.status).toBe(400);
    expect(await prisma.taskExecution.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('ADMIN sin empleado debe indicar un ejecutor activo; la auditoría distingue actor y ejecutor', async () => {
    const task = await createTask('completada por admin', empA, 'WEEKLY');
    expect((await complete(admin, task.id)).status).toBe(400);
    expect((await complete(admin, task.id, { employeeId: empInactive })).status).toBe(400);

    const ok = await complete(admin, task.id, { employeeId: empB });
    expect(ok.status).toBe(201);
    const execution = await prisma.taskExecution.findFirstOrThrow({ where: { taskId: task.id } });
    expect(execution).toMatchObject({
      assignedEmployeeId: empA,
      completedByEmployeeId: empB,
      recordedByUserId: admin.userId,
      periodKey: computePeriodKey('WEEKLY', new Date(), TZ),
    });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: execution.id } });
    expect(audit.actorUserId).toBe(admin.userId);
    expect(audit.newState).toMatchObject({ actorRole: 'ADMIN', registeredOnBehalf: true });
  });

  it('una sola ejecución por período: el segundo intento responde 409 controlado', async () => {
    const task = await createTask('una vez por día', empA, 'DAILY');
    expect((await complete(employeeA, task.id)).status).toBe(201);
    const second = await complete(employeeB, task.id);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('TASK_ALREADY_COMPLETED');
    expectCleanError(second.body);
  });

  it('dos o más finalizaciones concurrentes nunca duplican la ejecución ni la auditoría', async () => {
    const task = await createTask('concurrente', empA, 'DAILY');
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => complete(employeeA, task.id)),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(7);
    for (const response of responses.filter((r) => r.status === 409))
      expectCleanError(response.body);

    expect(await prisma.taskExecution.count({ where: { taskId: task.id } })).toBe(1);
    const executionIds = (await prisma.taskExecution.findMany({ where: { taskId: task.id } })).map(
      (e) => e.id,
    );
    expect(
      await prisma.auditLog.count({
        where: { action: 'task.completed', entityId: { in: executionIds } },
      }),
    ).toBe(1);
  });

  it('una tarea desactivada no puede completarse', async () => {
    const task = await createTask('desactivada', empA, 'DAILY');
    await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(as(admin))
      .send({ active: false });
    const response = await complete(employeeA, task.id);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('TASK_INACTIVE');
  });

  it('reasignar la tarea no cambia el snapshot de ejecuciones anteriores', async () => {
    const task = await createTask('reasignable', empB, 'DAILY');
    await complete(employeeA, task.id);
    await request(app).patch(`/api/v1/tasks/${task.id}`).set(as(admin)).send({ employeeId: empA });

    const execution = await prisma.taskExecution.findFirstOrThrow({ where: { taskId: task.id } });
    expect(execution.assignedEmployeeId).toBe(empB);
    const listed = await request(app).get(`/api/v1/tasks?employeeId=${empA}`).set(as(employeeA));
    const row = listed.body.tasks.find((t: { id: string }) => t.id === task.id);
    expect(row.assignee.id).toBe(empA);
    expect(row.currentExecution.assignedEmployee.id).toBe(empB);
  });

  it('URGENT y ONE_TIME usan su clave estable; la única completada sale del operativo', async () => {
    const urgent = await createTask('urgente', empA, 'URGENT');
    const oneTime = await createTask('única', empA, 'ONE_TIME');
    const urgentDone = await complete(employeeA, urgent.id);
    const oneTimeDone = await complete(employeeA, oneTime.id);
    expect(urgentDone.body.task.currentExecution.periodKey).toBe('URGENT');
    expect(oneTimeDone.body.task.currentExecution.periodKey).toBe('ONE_TIME');

    const operational = await request(app).get('/api/v1/tasks').set(as(employeeA));
    const ids = operational.body.tasks.map((t: { id: string }) => t.id);
    expect(ids).toContain(urgent.id);
    expect(ids).not.toContain(oneTime.id);

    const adminAll = await request(app).get('/api/v1/tasks?status=all').set(as(admin));
    expect(adminAll.body.tasks.map((t: { id: string }) => t.id)).toContain(oneTime.id);
  });
});

describe('tareas — reversión', () => {
  it('conserva trazabilidad y permite volver a completar', async () => {
    const task = await createTask('revertible', empA, 'DAILY');
    const done = await complete(employeeA, task.id);
    const executionId = done.body.task.currentExecution.id;
    expect(done.body.task.currentExecution.canRevert).toBe(true);

    const reverted = await request(app)
      .post(`/api/v1/tasks/${task.id}/revert`)
      .set(as(employeeA))
      .send({ executionId });
    expect(reverted.status).toBe(200);
    expect(reverted.body.task.currentExecution).toBeNull();

    const row = await prisma.taskExecution.findUniqueOrThrow({ where: { id: executionId } });
    expect(row).toMatchObject({
      completed: false,
      revertedByUserId: employeeA.userId,
      completedByEmployeeId: empA,
    });
    expect(row.revertedAt).not.toBeNull();
    expect(row.completedAt).not.toBeNull();

    const again = await complete(employeeA, task.id);
    expect(again.status).toBe(201);
    expect(await prisma.taskExecution.count({ where: { taskId: task.id } })).toBe(2);

    const revertAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'task.completion_reverted', entityId: executionId },
    });
    expect(revertAudit.actorUserId).toBe(employeeA.userId);

    const twice = await request(app)
      .post(`/api/v1/tasks/${task.id}/revert`)
      .set(as(employeeA))
      .send({ executionId });
    expect(twice.status).toBe(409);
  });

  it('un EMPLOYEE no revierte una finalización ajena ni de un período pasado; ADMIN corrige con motivo', async () => {
    const task = await createTask('ajena', empA, 'DAILY');
    const done = await complete(employeeA, task.id);
    const executionId = done.body.task.currentExecution.id;

    const other = await request(app)
      .post(`/api/v1/tasks/${task.id}/revert`)
      .set(as(employeeB))
      .send({ executionId });
    expect(other.status).toBe(403);

    const yesterday = formatLocalDate(addDays(toLocalDate(new Date(), TZ), -1));
    const past = await prisma.taskExecution.create({
      data: {
        taskId: task.id,
        periodKey: yesterday,
        completed: true,
        completedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        assignedEmployeeId: empA,
        completedByEmployeeId: empA,
        recordedByUserId: employeeA.userId,
      },
    });
    const ownPast = await request(app)
      .post(`/api/v1/tasks/${task.id}/revert`)
      .set(as(employeeA))
      .send({ executionId: past.id });
    expect(ownPast.status).toBe(403);

    const noReason = await request(app)
      .post(`/api/v1/tasks/${task.id}/revert`)
      .set(as(admin))
      .send({ executionId: past.id });
    expect(noReason.status).toBe(400);

    const corrected = await request(app)
      .post(`/api/v1/tasks/${task.id}/revert`)
      .set(as(admin))
      .send({ executionId: past.id, reason: 'Registrada por error en otro día' });
    expect(corrected.status).toBe(200);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: past.id, action: 'task.completion_reverted' },
    });
    expect(audit.newState).toMatchObject({
      administrativeCorrection: true,
      reason: 'Registrada por error en otro día',
    });
  });

  it('la base rechaza una fila incoherente (CHECK de reversión), sin dejar residuos', async () => {
    const task = await createTask('check', empA, 'DAILY');
    await expect(
      prisma.taskExecution.create({
        data: {
          taskId: task.id,
          periodKey: 'CHECK-TEST',
          completed: false,
          completedAt: new Date(),
          assignedEmployeeId: empA,
          completedByEmployeeId: empA,
        },
      }),
    ).rejects.toThrow();
    expect(await prisma.taskExecution.count({ where: { taskId: task.id } })).toBe(0);
  });
});

describe('tareas — historial semanal', () => {
  it('incluye tareas hoy desactivadas y muestra asignado vs. completado por', async () => {
    const task = await createTask('historial', empB, 'DAILY');
    await complete(employeeA, task.id);
    await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(as(admin))
      .send({ active: false });

    const response = await request(app).get('/api/v1/tasks/history').set(as(employeeA));
    expect(response.status).toBe(200);
    expect(response.body.week.isCurrent).toBe(true);
    const row = response.body.recurring.find(
      (r: { task: { id: string } }) => r.task.id === task.id,
    );
    expect(row.task.active).toBe(false);
    const slot = row.slots.find((s: { execution: unknown }) => s.execution);
    expect(slot.execution).toMatchObject({
      assignedEmployee: { id: empB },
      completedByEmployee: { id: empA },
    });
  });

  it('normaliza cualquier día al lunes, rechaza fechas inválidas y semanas futuras', async () => {
    const today = toLocalDate(new Date(), TZ);
    const response = await request(app)
      .get(`/api/v1/tasks/history?week=${formatLocalDate(today)}`)
      .set(as(employeeA));
    expect(response.body.week.start).toBe(computePeriodKey('WEEKLY', new Date(), TZ));
    expect(response.body.week.days).toHaveLength(7);

    const invalid = await request(app)
      .get('/api/v1/tasks/history?week=2026-02-30')
      .set(as(employeeA));
    expect(invalid.status).toBe(400);
    const future = await request(app)
      .get(`/api/v1/tasks/history?week=${formatLocalDate(addDays(today, 14))}`)
      .set(as(employeeA));
    expect(future.status).toBe(400);
  });

  it('una tarea única completada aparece en el historial de la semana', async () => {
    const task = await createTask('única historial', empA, 'ONE_TIME');
    await complete(employeeA, task.id);
    const response = await request(app)
      .get(`/api/v1/tasks/history?employeeId=${empA}`)
      .set(as(employeeA));
    expect(response.body.others.map((o: { task: { id: string } }) => o.task.id)).toContain(task.id);
  });

  it('realizadas/esperadas se calcula sobre slots esperados reales (nunca 0% fijo)', async () => {
    const task = await createTask('conteo', empA, 'WEEKLY');
    await complete(employeeA, task.id);
    const response = await request(app)
      .get(`/api/v1/tasks/history?employeeId=${empA}`)
      .set(as(employeeA));
    const row = response.body.recurring.find(
      (r: { task: { id: string } }) => r.task.id === task.id,
    );
    expect(row.slots).toHaveLength(1);
    expect(row.slots[0].expected).toBe(true);
    expect(response.body.summary.completed).toBeGreaterThan(0);
    expect(response.body.summary.expected).toBeGreaterThanOrEqual(response.body.summary.completed);
  });
});
