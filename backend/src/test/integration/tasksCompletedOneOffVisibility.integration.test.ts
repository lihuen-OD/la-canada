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
} from '../../lib/businessTime';
import { completeTask, listTasks, type TaskActor } from '../../tasks/tasksService';
import {
  assertNoSyntheticWritesOnRealData,
  assertRealTaskStateUnchanged,
  captureRealTaskState,
  type RealTaskState,
} from './realTaskDataGuard';

/**
 * Listado operativo de Tareas: una «Una vez» o una urgente completada se ve
 * tachada durante la semana de negocio (lunes a domingo, Buenos Aires) de su
 * finalización vigente y sale el lunes siguiente; las recurrentes conservan
 * sus períodos; Inicio conserva su fórmula. Contra `demo`, por HTTP real para
 * «ahora» y por el servicio con un «ahora» controlado para otras semanas (las
 * finalizaciones de semanas anteriores se registran con `completeTask`, como
 * las registraría la app, nunca editando filas). Fixtures `[test-oneoff-<RUN>]`
 * creados por la API con un ADMIN sintético; limpieza por id y
 * `realTaskDataGuard`.
 */
const RUN = `test-oneoff-${Date.now()}`;
const TAG = `[${RUN}]`;
const TZ = config.businessTimeZone;
const META = { ipAddress: null, userAgent: 'vitest' };

const today = toLocalDate(new Date(), TZ);
const monday = startOfWeek(today);
/** Primer instante del lunes de la semana `weeks` (0 = la actual) en la zona de negocio. */
const mondayStart = (weeks: number) => startOfLocalDay(addDays(monday, 7 * weeks), TZ);
const NEXT_MONDAY = mondayStart(1);
/** Domingo 23:59:59.999 de esta semana, en la zona de negocio. */
const SUNDAY_END = new Date(NEXT_MONDAY.getTime() - 1);
/** Mediodía del miércoles de la semana anterior. */
const LAST_WEEK = new Date(mondayStart(-1).getTime() + 2.5 * 86_400_000);
const day = (offset: number) => formatLocalDate(addDays(today, offset));

interface Actor {
  userId: string;
  token: string;
}
let app: Express;
let admin: Actor;
let employeeA: Actor;
let empA = '';
let serviceA: TaskActor;
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
async function createTask(name: string, frequency: string, scheduledDate?: string) {
  const response = await request(app)
    .post('/api/v1/tasks')
    .set(as(admin))
    .send({
      description: `${TAG} ${name}`,
      employeeId: empA,
      frequency,
      ...(scheduledDate ? { scheduledDate } : {}),
    });
  expect(response.status).toBe(201);
  return response.body.task.id as string;
}
const complete = (taskId: string) =>
  request(app).post(`/api/v1/tasks/${taskId}/complete`).set(as(employeeA)).send({});

interface ListedTask {
  id: string;
  active: boolean;
  canComplete: boolean;
  scheduledDate: string | null;
  scheduleStatus: string | null;
  currentExecution: { id: string; completedAt: string } | null;
}
/** Listado operativo por HTTP («ahora» real), filtrado a las tareas sintéticas. */
const listed = async (actor: Actor, query = '') =>
  (
    (await request(app).get(`/api/v1/tasks${query}`).set(as(actor))).body.tasks as (ListedTask & {
      description: string;
    })[]
  ).filter((task) => task.description.startsWith(TAG));
const ids = async (actor: Actor, query = '') => (await listed(actor, query)).map((task) => task.id);
/** Listado operativo del servicio con un «ahora» controlado. */
const idsAt = async (now: Date, filters: Parameters<typeof listTasks>[1] = { status: 'active' }) =>
  (await listTasks(serviceA, filters, now)).tasks.map((task) => task.id);

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
  serviceA = { userId: employeeA.userId, role: 'EMPLOYEE', employeeId: empA };
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

// Muchas requests secuenciales contra Neon (latencia real de red).
describe(
  '«Una vez» y urgentes completadas: visibles hasta el fin de la semana',
  { timeout: 120_000 },
  () => {
    it('completadas hoy: visibles y tachadas en «Todas», su frecuencia y su persona; nunca pendientes', async () => {
      const once = await createTask('una vez hoy', 'ONE_TIME');
      const urgent = await createTask('urgente hoy', 'URGENT');
      for (const id of [once, urgent]) expect((await complete(id)).status).toBe(201);

      for (const query of ['', '?frequency=ONE_TIME', '?frequency=URGENT', `?employeeId=${empA}`]) {
        const rows = await listed(employeeA, query);
        for (const row of rows.filter((task) => task.id === once || task.id === urgent)) {
          expect(row.currentExecution).not.toBeNull();
          expect(row.canComplete).toBe(false);
        }
      }
      expect(await ids(employeeA)).toEqual(expect.arrayContaining([once, urgent]));
      expect(await ids(employeeA, '?frequency=ONE_TIME')).toContain(once);
      expect(await ids(employeeA, '?frequency=URGENT')).toContain(urgent);
      expect(await ids(employeeA, `?employeeId=${empA}`)).toEqual(
        expect.arrayContaining([once, urgent]),
      );
      const all = await ids(employeeA);
      expect(new Set(all).size).toBe(all.length);

      // Hasta el domingo 23:59:59 siguen; desde el lunes 00:00 (Buenos Aires), fuera.
      expect(await idsAt(SUNDAY_END)).toEqual(expect.arrayContaining([once, urgent]));
      const nextWeek = await idsAt(NEXT_MONDAY);
      expect(nextWeek).not.toContain(once);
      expect(nextWeek).not.toContain(urgent);
      for (const filters of [
        { status: 'active' as const, frequency: 'ONE_TIME' as const },
        { status: 'active' as const, frequency: 'URGENT' as const },
        { status: 'active' as const, employeeId: empA },
      ]) {
        const filtered = await idsAt(NEXT_MONDAY, filters);
        expect(filtered).not.toContain(once);
        expect(filtered).not.toContain(urgent);
      }
      // Se conservan: gestión del ADMIN, historial y la fila de la finalización.
      const managed = (await listed(admin, '?status=all')).filter((task) =>
        [once, urgent].includes(task.id),
      );
      expect(managed).toHaveLength(2);
      expect(await prisma.taskExecution.count({ where: { taskId: { in: [once, urgent] } } })).toBe(
        2,
      );
      const history = await request(app).get('/api/v1/tasks/history').set(as(employeeA));
      const others = (history.body.others as { task: { id: string } }[]).map((row) => row.task.id);
      expect(others).toEqual(expect.arrayContaining([once, urgent]));
      // Desempeño la sigue contando como siempre.
      const detail = await request(app)
        .get(
          `/api/v1/performance/employees/${empA}?from=${day(-6)}&to=${day(0)}&limit=50&frequency=URGENT`,
        )
        .set(as(employeeA));
      expect(detail.body.occurrences).toEqual([
        expect.objectContaining({ taskId: urgent, status: 'personal' }),
      ]);
    });

    it('completadas la semana anterior: ocultas ahora (no se renuevan); la urgente sigue en el KPI de Inicio', async () => {
      const once = await createTask('una vez semana anterior', 'ONE_TIME');
      const urgent = await createTask('urgente semana anterior', 'URGENT');
      for (const id of [once, urgent]) await completeTask(serviceA, id, undefined, META, LAST_WEEK);

      expect(await ids(employeeA)).not.toContain(once);
      expect(await ids(employeeA)).not.toContain(urgent);
      expect(await ids(employeeA, '?frequency=URGENT')).not.toContain(urgent);
      expect((await listed(admin, '?status=all')).map((task) => task.id)).toEqual(
        expect.arrayContaining([once, urgent]),
      );
      // Inicio, con su fórmula de siempre: urgentes completadas sí, «Una vez» completadas no.
      const home = await listTasks(serviceA, { status: 'active' }, new Date(), { view: 'homeKpi' });
      const homeIds = home.tasks.map((task) => task.id);
      expect(homeIds).toContain(urgent);
      expect(homeIds).not.toContain(once);
      expect(home.tasks.find((task) => task.id === urgent)?.currentExecution).not.toBeNull();
    });

    it('pendientes vencidas siguen visibles; sin fecha y completadas antes de su fecha siguen la misma regla', async () => {
      const overdue = await createTask('una vez vencida', 'ONE_TIME', day(-10));
      const noDate = await createTask('una vez sin fecha', 'ONE_TIME');
      const early = await createTask('una vez anticipada', 'ONE_TIME', day(20));

      const before = await listed(employeeA);
      expect(before.find((task) => task.id === overdue)).toMatchObject({
        scheduleStatus: 'OVERDUE',
        currentExecution: null,
      });
      // Pendientes: siguen apareciendo aunque pase su fecha (también la semana próxima).
      expect(await idsAt(NEXT_MONDAY)).toEqual(expect.arrayContaining([overdue, noDate, early]));

      for (const id of [noDate, early]) expect((await complete(id)).status).toBe(201);
      const after = await listed(employeeA);
      // La fecha prevista se conserva aparte de la finalización.
      expect(after.find((task) => task.id === early)).toMatchObject({
        scheduledDate: day(20),
        scheduleStatus: null,
        currentExecution: expect.objectContaining({ completedAt: expect.any(String) }),
      });
      expect(after.map((task) => task.id)).toEqual(expect.arrayContaining([noDate, early]));
      // La semana próxima salen, aunque la fecha prevista todavía no haya llegado.
      const nextWeek = await idsAt(NEXT_MONDAY);
      expect(nextWeek).not.toContain(noDate);
      expect(nextWeek).not.toContain(early);
      expect(nextWeek).toContain(overdue);
    });

    it('deshacer una oculta la devuelve pendiente (una fila); una nueva finalización cuenta desde su propio registro', async () => {
      const urgent = await createTask('urgente oculta', 'URGENT');
      const first = await completeTask(serviceA, urgent, undefined, META, LAST_WEEK);
      expect(await ids(employeeA)).not.toContain(urgent);
      const executionId = first.task.currentExecution!.id;

      const reverted = await request(app)
        .post(`/api/v1/tasks/${urgent}/revert`)
        .set(as(admin))
        .send({ executionId, reason: 'Prueba sintética' });
      expect(reverted.status).toBe(200);
      const pending = (await listed(employeeA)).filter((task) => task.id === urgent);
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ currentExecution: null, canComplete: true });

      expect((await complete(urgent)).status).toBe(201);
      const again = (await listed(employeeA)).filter((task) => task.id === urgent);
      expect(again).toHaveLength(1);
      expect(again[0]!.currentExecution!.id).not.toBe(executionId);
      expect(await prisma.taskExecution.count({ where: { taskId: urgent } })).toBe(2);
      expect(await idsAt(NEXT_MONDAY)).not.toContain(urgent);
    });

    it('una desactivada no reaparece como activa al deshacer', async () => {
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
      expect((await listed(admin, '?status=all')).find((task) => task.id === urgent)).toMatchObject(
        {
          active: false,
          currentExecution: null,
        },
      );
    });

    it('recurrentes: tachadas en su período y pendientes al empezar el siguiente, sin duplicar ni tocar la ejecución', async () => {
      const daily = await createTask('diaria', 'DAILY');
      const weekly = await createTask('semanal', 'WEEKLY');
      for (const id of [daily, weekly]) expect((await complete(id)).status).toBe(201);
      const now = await listed(employeeA);
      for (const id of [daily, weekly]) {
        expect(now.find((task) => task.id === id)?.currentExecution).not.toBeNull();
      }
      const nextWeek = (await listTasks(serviceA, { status: 'active' }, NEXT_MONDAY)).tasks;
      for (const id of [daily, weekly]) {
        const rows = nextWeek.filter((task) => task.id === id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ currentExecution: null, canComplete: true });
      }
      const executions = await prisma.taskExecution.findMany({
        where: { taskId: { in: [daily, weekly] } },
        select: { revertedAt: true, completed: true },
      });
      expect(executions).toEqual([
        { revertedAt: null, completed: true },
        { revertedAt: null, completed: true },
      ]);
    });
  },
);
