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
import { getPerformance } from '../../performance/performanceService';
import { getWeeklyHistory, registerLateCompletion } from '../../tasks/tasksService';
import {
  assertNoSyntheticWritesOnRealData,
  assertRealTaskStateUnchanged,
  captureRealTaskState,
  type RealTaskState,
} from './realTaskDataGuard';

/**
 * «Marcar como realizada» (carga olvidada) contra Neon real (`demo`), por
 * HTTP real (app Express completa, `requireAuth` real con sesiones y JWT de
 * usuarios SINTÉTICOS) y, para el historial en otra semana, con el servicio y
 * un "ahora" controlado en 2001 (ningún dato real cae en esas fechas).
 *
 * Datos: todo lo creado lleva `[test-late-<RUN>]` / `test-late-<RUN>`. La
 * planificación pasada se crea directamente (las obligaciones de ayer
 * necesitan una planificación que empezó antes). Nunca se completa, reasigna
 * ni edita una tarea real; `afterAll` borra solo lo sintético por id y
 * verifica con `realTaskDataGuard` que las tareas, ejecuciones e intervalos
 * reales quedan idénticos.
 */
const RUN = `test-late-${Date.now()}`;
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
let empA = '';
let empB = '';
const syntheticUserIds: string[] = [];
const syntheticEmployeeIds: string[] = [];
const taskIds: string[] = [];
let realState: RealTaskState;

const today = toLocalDate(new Date(), TZ);
const daysAgo = (n: number) => addDays(today, -n);
const keyOf = (n: number) => formatLocalDate(daysAgo(n));
const at = (date: LocalDate, hours = 0) =>
  new Date(startOfLocalDay(date, TZ).getTime() + hours * 3_600_000);
const thisMonday = startOfWeek(today);
const lastMonday = addDays(thisMonday, -7);
const lastWednesday = addDays(lastMonday, 2);

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

type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
/** Tarea sintética con su planificación pasada (versiones `[desde, hasta)`). */
async function createTask(
  name: string,
  plans: { employeeId: string; frequency: Frequency; from: Date; to?: Date }[],
) {
  const last = plans.at(-1)!;
  const task = await prisma.task.create({
    data: {
      description: `${TAG} ${name}`,
      employeeId: last.employeeId,
      frequency: last.frequency,
      active: last.to === undefined,
    },
    select: { id: true },
  });
  taskIds.push(task.id);
  for (const plan of plans) {
    await prisma.taskPlanningInterval.create({
      data: {
        taskId: task.id,
        employeeId: plan.employeeId,
        frequency: plan.frequency,
        validFrom: plan.from,
        validTo: plan.to ?? null,
      },
    });
  }
  return task.id;
}

const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });
const late = (actor: Actor, taskId: string, body: Record<string, unknown>) =>
  request(app).post(`/api/v1/tasks/${taskId}/late-completion`).set(as(actor)).send(body);
const detail = (actor: Actor, employeeId: string) =>
  request(app)
    .get(
      `/api/v1/performance/employees/${employeeId}?from=${keyOf(6)}&to=${formatLocalDate(today)}`,
    )
    .set(as(actor));

function expectCleanError(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/prisma|P20\d\d|stack|constraint|SELECT|INSERT/i);
  expect(Object.keys((body as { error: object }).error).sort()).toEqual(['code', 'message']);
}

beforeAll(async () => {
  expect(process.env.DATABASE_TARGET).toBe('demo');
  realState = await captureRealTaskState();
  app = createApp();
  empA = await createEmployee('A');
  empB = await createEmployee('B');
  admin = await createActor('ADMIN', 'admin');
  employeeA = await createActor('EMPLOYEE', 'emp-a', empA);
  employeeB = await createActor('EMPLOYEE', 'emp-b', empB);
}, 60_000);

afterAll(async () => {
  const executionIds = (
    await prisma.taskExecution.findMany({
      where: { taskId: { in: taskIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  await assertNoSyntheticWritesOnRealData(realState, syntheticUserIds, [
    ...taskIds,
    ...executionIds,
  ]);
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: syntheticUserIds } },
        { entityId: { in: [...taskIds, ...executionIds] } },
      ],
    },
  });
  await prisma.taskExecution.deleteMany({ where: { id: { in: executionIds } } });
  await prisma.taskPlanningInterval.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: syntheticUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: syntheticUserIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: syntheticEmployeeIds } } });
  await assertRealTaskStateUnchanged(realState, syntheticUserIds, RUN);
}, 60_000);

describe('ejemplo obligatorio: diaria de ayer cargada hoy', () => {
  it('queda completada solo la de ayer; la de hoy sigue con su propio estado; fecha real ≠ registro', async () => {
    const taskId = await createTask('Aspirar planta baja', [
      { employeeId: empA, frequency: 'DAILY', from: at(daysAgo(10)) },
    ]);

    // Antes: ayer y hoy pendientes, las dos con la acción y la fecha fijada por la fila.
    const before = await detail(employeeA, empA);
    expect(before.status).toBe(200);
    const rowsOf = (body: { occurrences: { taskId: string; periodKey: string }[] }) =>
      new Map(
        body.occurrences
          .filter((row) => row.taskId === taskId)
          .map((row) => [row.periodKey, row as Record<string, unknown>]),
      );
    expect(rowsOf(before.body).get(keyOf(1))).toMatchObject({
      status: 'pending',
      lateCompletion: { earliest: keyOf(1), latest: keyOf(1) },
    });
    const assignedBefore = before.body.employees[0].assigned as number;
    const personalBefore = before.body.employees[0].completedPersonally as number;

    // Registrar ayer sin tocar hoy.
    const response = await late(employeeA, taskId, {
      periodKey: keyOf(1),
      performedOn: keyOf(1),
    });
    expect(response.status).toBe(201);
    expect(response.body.completion).toMatchObject({
      periodKey: keyOf(1),
      performedOn: keyOf(1),
      assignedEmployeeId: empA,
      completedByEmployeeId: empA,
      status: 'personal',
    });

    const rows = await prisma.taskExecution.findMany({ where: { taskId } });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      periodKey: keyOf(1),
      completed: true,
      revertedAt: null,
      assignedEmployeeId: empA,
      completedByEmployeeId: empA,
      recordedByUserId: employeeA.userId,
      performedOn: new Date(`${keyOf(1)}T00:00:00.000Z`),
    });
    // El registro es de hoy (momento real), no del día en que se realizó.
    expect(formatLocalDate(toLocalDate(row!.completedAt!, TZ))).toBe(formatLocalDate(today));
    expect(
      await prisma.auditLog.count({ where: { action: 'task.completed_late', entityId: row!.id } }),
    ).toBe(1);

    // Desempeño: ayer realizada (con fecha real y registro); hoy sigue pendiente; mismo denominador.
    const after = await detail(employeeA, empA);
    const afterRows = rowsOf(after.body);
    expect(afterRows.get(keyOf(1))).toMatchObject({
      status: 'personal',
      lateRegistration: { performedOn: keyOf(1), canRevert: true },
    });
    expect(afterRows.get(formatLocalDate(today))).toMatchObject({ status: 'pending' });
    expect(after.body.employees[0].assigned).toBe(assignedBefore);
    expect(after.body.employees[0].completedPersonally).toBe(personalBefore + 1);

    // Tareas: la de hoy sigue pendiente en el listado (la ejecución de ayer no es la vigente).
    const list = await request(app).get('/api/v1/tasks').set(as(employeeA));
    expect(
      (list.body.tasks as { id: string; currentExecution: unknown }[]).find((t) => t.id === taskId),
    ).toMatchObject({ currentExecution: null, canComplete: true });

    // El flujo normal de hoy sigue igual: completa hoy (sin fecha cargada).
    expect(
      (await request(app).post(`/api/v1/tasks/${taskId}/complete`).set(as(employeeA)).send({}))
        .status,
    ).toBe(201);
    const today_ = await prisma.taskExecution.findFirst({
      where: { taskId, periodKey: formatLocalDate(today) },
    });
    expect(today_).toMatchObject({ performedOn: null, assignedEmployeeId: empA });

    // Historial de la semana de ayer: el slot de ayer con la ejecución y su fecha real.
    const history = await request(app)
      .get(`/api/v1/tasks/history?week=${keyOf(1)}`)
      .set(as(employeeA));
    const historyRow = (
      history.body.recurring as {
        task: { id: string; frequency: string };
        slots: { periodKey: string; execution: { performedOn: string | null } | null }[];
      }[]
    ).find((r) => r.task.id === taskId);
    expect(historyRow?.task.frequency).toBe('DAILY');
    expect(historyRow?.slots.find((s) => s.periodKey === keyOf(1))?.execution).toMatchObject({
      performedOn: keyOf(1),
    });
  });

  it('con la de hoy ya completada, igual se registra la de un día anterior', async () => {
    const taskId = await createTask('hoy completada', [
      { employeeId: empA, frequency: 'DAILY', from: at(daysAgo(10)) },
    ]);
    expect(
      (await request(app).post(`/api/v1/tasks/${taskId}/complete`).set(as(employeeA)).send({}))
        .status,
    ).toBe(201);
    const response = await late(employeeA, taskId, { periodKey: keyOf(3), performedOn: keyOf(3) });
    expect(response.status).toBe(201);
    expect(
      (
        await prisma.taskExecution.findMany({ where: { taskId }, orderBy: { periodKey: 'asc' } })
      ).map((row) => row.periodKey),
    ).toEqual([keyOf(3), formatLocalDate(today)]);
  });
});

describe('duplicados y concurrencia', () => {
  it('8 solicitudes simultáneas (doble clic, varias pestañas): 1 ejecución y 1 auditoría, 7 × 409 claros', async () => {
    const taskId = await createTask('concurrente', [
      { employeeId: empA, frequency: 'DAILY', from: at(daysAgo(10)) },
    ]);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        late(employeeA, taskId, { periodKey: keyOf(2), performedOn: keyOf(2) }),
      ),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(7);
    for (const response of responses.filter((r) => r.status === 409)) {
      expect(response.body.error.code).toBe('TASK_OBLIGATION_ALREADY_COMPLETED');
      expectCleanError(response.body);
    }
    const rows = await prisma.taskExecution.findMany({ where: { taskId } });
    expect(rows).toHaveLength(1);
    expect(
      await prisma.auditLog.count({ where: { entityId: { in: rows.map((row) => row.id) } } }),
    ).toBe(1);
  });

  it('otra persona la completó mientras estaba abierta la pantalla: 409 y no se reemplaza', async () => {
    const taskId = await createTask('cubierta mientras tanto', [
      { employeeId: empA, frequency: 'DAILY', from: at(daysAgo(10)) },
    ]);
    const coverage = await late(admin, taskId, {
      periodKey: keyOf(3),
      performedOn: keyOf(3),
      employeeId: empB,
    });
    expect(coverage.status).toBe(201);
    expect(coverage.body.completion.status).toBe('covered');
    const conflict = await late(employeeA, taskId, { periodKey: keyOf(3), performedOn: keyOf(3) });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('TASK_OBLIGATION_ALREADY_COMPLETED');
    const [row] = await prisma.taskExecution.findMany({ where: { taskId } });
    expect(row).toMatchObject({
      completedByEmployeeId: empB,
      assignedEmployeeId: empA,
      recordedByUserId: admin.userId,
    });
  });
});

describe('permisos', () => {
  it('EMPLOYEE: ni por otra persona ni una obligación ajena; ADMIN elige explícitamente', async () => {
    const taskId = await createTask('permisos', [
      { employeeId: empA, frequency: 'DAILY', from: at(daysAgo(10)) },
    ]);
    const body = { periodKey: keyOf(2), performedOn: keyOf(2) };
    const foreign = await late(employeeB, taskId, body);
    expect(foreign.status).toBe(403);
    expectCleanError(foreign.body);
    expect((await late(employeeA, taskId, { ...body, employeeId: empB })).status).toBe(403);
    const noChoice = await late(admin, taskId, body);
    expect(noChoice.status).toBe(400);
    expect(noChoice.body.error.message).toBe('Indicá quién realizó la tarea.');
    expect(await prisma.taskExecution.count({ where: { taskId } })).toBe(0);
    // Un campo que el servidor reconstruye nunca se acepta.
    for (const extra of [
      { assignedEmployeeId: empB },
      { frequency: 'WEEKLY' },
      { status: 'pending' },
      { completedAt: new Date().toISOString() },
    ]) {
      expect((await late(employeeA, taskId, { ...body, ...extra })).status).toBe(400);
    }
    // Sin sesión: 401.
    expect(
      (await request(app).post(`/api/v1/tasks/${taskId}/late-completion`).send(body)).status,
    ).toBe(401);
  });

  it('cobertura: no suma al porcentaje de quien la tenía asignada ni de quien cubrió', async () => {
    const taskId = await createTask('cobertura', [
      { employeeId: empA, frequency: 'DAILY', from: at(daysAgo(10)) },
    ]);
    const rangeQuery = `from=${keyOf(6)}&to=${formatLocalDate(today)}`;
    const summary = async () =>
      (await request(app).get(`/api/v1/performance/summary?${rangeQuery}`).set(as(admin))).body
        .employees as {
        employee: { id: string };
        assigned: number;
        completedPersonally: number;
        coverageReceived: number;
        coverageGiven: number;
        percentage: number | null;
      }[];
    const pick = (rows: Awaited<ReturnType<typeof summary>>, id: string) =>
      rows.find((row) => row.employee.id === id)!;
    const before = await summary();
    expect(
      (await late(admin, taskId, { periodKey: keyOf(4), performedOn: keyOf(4), employeeId: empB }))
        .status,
    ).toBe(201);
    const after = await summary();
    expect(pick(after, empA)).toMatchObject({
      assigned: pick(before, empA).assigned,
      completedPersonally: pick(before, empA).completedPersonally,
      coverageReceived: pick(before, empA).coverageReceived + 1,
    });
    expect(pick(after, empB)).toMatchObject({
      coverageGiven: pick(before, empB).coverageGiven + 1,
      percentage: pick(before, empB).percentage,
    });
  });
});

describe('reversión de la carga histórica', () => {
  it('EMPLOYEE deshace la suya el mismo día; ADMIN corrige con motivo; nada se borra', async () => {
    const taskId = await createTask('reversión', [
      { employeeId: empA, frequency: 'DAILY', from: at(daysAgo(10)) },
    ]);
    expect(
      (await late(employeeA, taskId, { periodKey: keyOf(2), performedOn: keyOf(2) })).status,
    ).toBe(201);
    expect(
      (await late(admin, taskId, { periodKey: keyOf(3), performedOn: keyOf(3), employeeId: empB }))
        .status,
    ).toBe(201);
    const byKey = async (key: string) =>
      (await prisma.taskExecution.findFirst({
        where: { taskId, periodKey: key, revertedAt: null },
      }))!;
    const revert = (actor: Actor, executionId: string, reason?: string) =>
      request(app)
        .post(`/api/v1/tasks/${taskId}/revert`)
        .set(as(actor))
        .send(reason ? { executionId, reason } : { executionId });

    const own = await byKey(keyOf(2));
    expect((await revert(employeeA, own.id)).status).toBe(200);
    // La que registró un ADMIN a nombre de B: B no la deshace (no la cargó él).
    const covered = await byKey(keyOf(3));
    expect((await revert(employeeB, covered.id)).status).toBe(403);
    expect((await revert(admin, covered.id)).status).toBe(400);
    expect((await revert(admin, covered.id, 'Cargada por error')).status).toBe(200);

    // Las revertidas quedan como historia y el período se puede volver a registrar.
    expect(
      (await late(employeeA, taskId, { periodKey: keyOf(3), performedOn: keyOf(3) })).status,
    ).toBe(201);
    const all = await prisma.taskExecution.findMany({ where: { taskId } });
    expect(all).toHaveLength(3);
    expect(all.filter((row) => row.revertedAt !== null)).toHaveLength(2);
    expect(
      await prisma.auditLog.count({
        where: { action: 'task.completion_reverted', entityId: { in: [own.id, covered.id] } },
      }),
    ).toBe(2);
  });

  it('una ejecución antigua del flujo normal sigue sin poder deshacerse por el EMPLOYEE', async () => {
    const taskId = await createTask('antigua normal', [
      { employeeId: empA, frequency: 'DAILY', from: at(daysAgo(10)) },
    ]);
    const old = await prisma.taskExecution.create({
      data: {
        taskId,
        periodKey: keyOf(5),
        completed: true,
        completedAt: at(daysAgo(5), 15),
        assignedEmployeeId: empA,
        completedByEmployeeId: empA,
        recordedByUserId: employeeA.userId,
      },
    });
    const response = await request(app)
      .post(`/api/v1/tasks/${taskId}/revert`)
      .set(as(employeeA))
      .send({ executionId: old.id });
    expect(response.status).toBe(403);
  });
});

describe('fechas y existencia de la obligación', () => {
  it('futura, fuera del período o anterior a la planificación → 400; sin obligación → 409', async () => {
    const daily = await createTask('fechas diaria', [
      { employeeId: empA, frequency: 'DAILY', from: at(daysAgo(10)) },
    ]);
    const future = await late(employeeA, daily, {
      periodKey: formatLocalDate(today),
      performedOn: formatLocalDate(addDays(today, 1)),
    });
    expect(future.status).toBe(400);
    expect(
      (await late(employeeA, daily, { periodKey: keyOf(2), performedOn: keyOf(3) })).status,
    ).toBe(400);
    const before = await late(employeeA, daily, { periodKey: keyOf(12), performedOn: keyOf(12) });
    expect(before.status).toBe(409);
    expect(before.body.error.code).toBe('TASK_OBLIGATION_UNAVAILABLE');
    expect(
      (await late(employeeA, daily, { periodKey: 'URGENT', performedOn: keyOf(2) })).status,
    ).toBe(400);

    // Semanal planificada desde el miércoles pasado: esa semana, desde el miércoles.
    const weekly = await createTask('fechas semanal', [
      { employeeId: empA, frequency: 'WEEKLY', from: at(lastWednesday, 10) },
    ]);
    const tooEarly = await late(employeeA, weekly, {
      periodKey: formatLocalDate(lastMonday),
      performedOn: formatLocalDate(lastMonday),
    });
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body.error.message).toContain('todavía no estaba planificada');
    expect(
      (
        await late(employeeA, weekly, {
          periodKey: formatLocalDate(lastMonday),
          performedOn: formatLocalDate(lastWednesday),
        })
      ).status,
    ).toBe(201);
    expect(await prisma.taskExecution.count({ where: { taskId: { in: [daily, weekly] } } })).toBe(
      1,
    );
  });

  it('la base rechaza una fecha real posterior al registro (CHECK, defensa en profundidad)', async () => {
    const taskId = await createTask('check', [
      { employeeId: empA, frequency: 'DAILY', from: at(daysAgo(10)) },
    ]);
    await expect(
      prisma.taskExecution.create({
        data: {
          taskId,
          periodKey: keyOf(2),
          completed: true,
          completedAt: at(daysAgo(2), 12),
          performedOn: new Date(`${formatLocalDate(addDays(today, 3))}T00:00:00.000Z`),
          assignedEmployeeId: empA,
          completedByEmployeeId: empA,
          recordedByUserId: employeeA.userId,
        },
      }),
    ).rejects.toThrow();
  });
});

describe('responsable y frecuencia históricos', () => {
  it('reasignada ayer al mediodía: anteayer es de A, ayer de B (no del responsable actual)', async () => {
    const taskId = await createTask('reasignada', [
      { employeeId: empA, frequency: 'DAILY', from: at(daysAgo(10)), to: at(daysAgo(1), 12) },
      { employeeId: empB, frequency: 'DAILY', from: at(daysAgo(1), 12) },
    ]);
    const ofA = await late(employeeA, taskId, { periodKey: keyOf(2), performedOn: keyOf(2) });
    expect(ofA.status).toBe(201);
    expect(ofA.body.completion.assignedEmployeeId).toBe(empA);
    expect(
      (await late(employeeA, taskId, { periodKey: keyOf(1), performedOn: keyOf(1) })).status,
    ).toBe(403);
    const ofB = await late(employeeB, taskId, { periodKey: keyOf(1), performedOn: keyOf(1) });
    expect(ofB.status).toBe(201);
    expect(ofB.body.completion.assignedEmployeeId).toBe(empB);
  });

  it('desactivada después: la de cuando estaba planificada se registra; completar hoy sigue bloqueado', async () => {
    const taskId = await createTask('desactivada después', [
      { employeeId: empA, frequency: 'DAILY', from: at(daysAgo(10)), to: at(daysAgo(1), 8) },
    ]);
    expect(
      (await late(employeeA, taskId, { periodKey: keyOf(2), performedOn: keyOf(2) })).status,
    ).toBe(201);
    const normal = await request(app)
      .post(`/api/v1/tasks/${taskId}/complete`)
      .set(as(employeeA))
      .send({});
    expect(normal.status).toBe(409);
    expect(normal.body.error.code).toBe('TASK_INACTIVE');
  });

  it('semanal la semana pasada y diaria desde este lunes: la carga conserva la clave semanal y el historial no la lee como diaria', async () => {
    const taskId = await createTask('semanal a diaria', [
      { employeeId: empA, frequency: 'WEEKLY', from: at(daysAgo(25)), to: at(thisMonday) },
      { employeeId: empA, frequency: 'DAILY', from: at(thisMonday) },
    ]);
    const response = await late(employeeA, taskId, {
      periodKey: formatLocalDate(lastMonday),
      performedOn: formatLocalDate(lastWednesday),
    });
    expect(response.status).toBe(201);
    expect(response.body.completion.frequency).toBe('WEEKLY');

    const history = await request(app)
      .get(`/api/v1/tasks/history?week=${formatLocalDate(lastMonday)}`)
      .set(as(employeeA));
    const rows = (
      history.body.recurring as {
        task: { id: string; frequency: string };
        slots: { periodKey: string; execution: unknown }[];
      }[]
    ).filter((row) => row.task.id === taskId);
    // Una sola fila, SEMANAL, con la ejecución; ningún slot diario del lunes pasado.
    expect(rows.map((row) => row.task.frequency)).toEqual(['WEEKLY']);
    expect(rows[0]!.slots).toHaveLength(1);
    expect(rows[0]!.slots[0]).toMatchObject({ periodKey: formatLocalDate(lastMonday) });
    expect(rows[0]!.slots[0]!.execution).not.toBeNull();
  });
});

describe('historial en otra semana y zona horaria (servicio, "ahora" controlado en 2001)', () => {
  // Martes 30/10/2001 al mediodía de Buenos Aires: ningún dato real cae en 2001.
  const NOW = new Date('2001-10-30T15:00:00Z');
  const META = { ipAddress: null, userAgent: null };
  const actorA = () => ({ userId: employeeA.userId, role: 'EMPLOYEE' as const, employeeId: empA });

  it('una mensual cargada el 30/10 para el 03/10 aparece en la semana del 03/10, no en la del registro', async () => {
    const taskId = await createTask('mensual 2001', [
      { employeeId: empA, frequency: 'MONTHLY', from: new Date('2001-01-01T15:00:00Z') },
    ]);
    const result = await registerLateCompletion(
      actorA(),
      taskId,
      { periodKey: '2001-10-01', performedOn: '2001-10-03' },
      META,
      NOW,
    );
    expect(result.completion).toMatchObject({ frequency: 'MONTHLY', performedOn: '2001-10-03' });

    const lineOf = async (week: string) =>
      (await getWeeklyHistory(actorA(), { week }, NOW)).others.find((o) => o.task.id === taskId);
    expect(await lineOf('2001-10-01')).toMatchObject({
      task: { frequency: 'MONTHLY' },
      execution: { performedOn: '2001-10-03', completedAt: NOW.toISOString() },
    });
    expect(await lineOf('2001-10-29')).toBeUndefined();

    // Desempeño del rango de 30 días: la mensual de octubre, realizada.
    const performance = await getPerformance(
      actorA(),
      { from: '2001-10-01', to: '2001-10-30' },
      undefined,
      NOW,
    );
    expect(
      performance.occurrences!.find((o) => o.taskId === taskId && o.periodKey === '2001-10-01'),
    ).toMatchObject({ status: 'personal', lateRegistration: { performedOn: '2001-10-03' } });
  });

  it('a las 23:30 de Buenos Aires (02:30 UTC del 31) todavía es el 30: hoy vale, el 31 es futuro', async () => {
    const taskId = await createTask('medianoche 2001', [
      { employeeId: empA, frequency: 'DAILY', from: new Date('2001-10-01T15:00:00Z') },
    ]);
    const lateNight = new Date('2001-10-31T02:30:00Z');
    await expect(
      registerLateCompletion(
        actorA(),
        taskId,
        { periodKey: '2001-10-30', performedOn: '2001-10-31' },
        META,
        lateNight,
      ),
    ).rejects.toThrow('no puede ser futura');
    const result = await registerLateCompletion(
      actorA(),
      taskId,
      { periodKey: '2001-10-30', performedOn: '2001-10-30' },
      META,
      lateNight,
    );
    expect(result.completion.periodKey).toBe('2001-10-30');
  });
});
