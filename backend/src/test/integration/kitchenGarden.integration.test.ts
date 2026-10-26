import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import {
  completeGardenActivity,
  createGardenActivity,
  listGardenActivities,
} from '../../kitchenGarden/gardenActivitiesService';
import { getGardenPerformance } from '../../kitchenGarden/gardenPerformanceService';
import type { GardenActor } from '../../kitchenGarden/gardenParticipants';
import {
  assertNoSyntheticWritesOnRealData,
  assertRealTaskStateUnchanged,
  captureRealTaskState,
  type RealTaskState,
} from './realTaskDataGuard';

/**
 * 🥬 Huerta contra Neon real (`demo`), por HTTP real y por el servicio con un
 * «ahora» controlado. Datos SINTÉTICOS: usuarios, empleados, perfil y
 * actividades con `test-huerta-<RUN>`; nunca se agrega como participante a una
 * persona real ni se toca una tarea. `afterAll` borra solo lo creado (por id)
 * y verifica con `realTaskDataGuard` que las tablas de ✅ Tareas quedaron
 * intactas, y que no quedan filas de la Huerta de esta corrida.
 */

const RUN = `test-huerta-${Date.now()}`;
const TAG = `[${RUN}]`;
const API = '/api/v1/kitchen-garden';
const META = { ipAddress: null, userAgent: 'integration-test' };

interface Person {
  userId: string;
  employeeId: string | null;
  token: string;
  participantId?: string;
}

let app: Express;
let admin: Person;
let empA: Person;
let empB: Person;
let outsider: Person;
let suspended: Person;
const userIds: string[] = [];
const employeeIds: string[] = [];
let realState: RealTaskState;
let startedAt: Date;
let huertaBefore: number[];

const ar = (day: string, time = '12:00') => new Date(`${day}T${time}:00.000-03:00`);
const as = (person: Person) => ({ Authorization: `Bearer ${person.token}` });

async function createPerson(
  suffix: string,
  role: 'ADMIN' | 'EMPLOYEE',
  { withEmployee = true, status = 'ACTIVE' as 'ACTIVE' | 'SUSPENDED', profileName = '' } = {},
): Promise<Person> {
  let employeeId: string | null = null;
  if (withEmployee) {
    employeeId = (
      await prisma.employee.create({
        data: {
          code: `${RUN}-${suffix}`,
          displayName: `Sintético ${suffix} ${RUN}`,
          role: 'Huerta (test)',
          colorHex: '#4a7c59',
        },
        select: { id: true },
      })
    ).id;
    employeeIds.push(employeeId);
  }
  const user = await prisma.user.create({
    data: {
      username: `${RUN}-${suffix}`,
      role,
      status,
      pinHash: 'synthetic-not-a-real-hash',
      employeeId,
    },
    select: { id: true },
  });
  userIds.push(user.id);
  if (profileName) {
    await prisma.userProfile.create({ data: { userId: user.id, displayName: profileName } });
  }
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
  return { userId: user.id, employeeId, token };
}

async function huertaCountsBefore(at: Date) {
  const before = { createdAt: { lt: at } };
  return Promise.all([
    prisma.kitchenGardenParticipant.count({ where: before }),
    prisma.kitchenGardenActivity.count({ where: before }),
    prisma.kitchenGardenPlanningInterval.count({ where: before }),
    prisma.kitchenGardenExecution.count({ where: before }),
  ]);
}

async function addParticipant(person: Person) {
  const response = await request(app)
    .post(`${API}/participants`)
    .set(as(admin))
    .send({ userId: person.userId });
  expect(response.status).toBe(201);
  person.participantId = response.body.participant.id;
  return response.body.participant;
}

type ActivityBody = Record<string, unknown> & {
  id: string;
  description: string;
  canComplete: boolean;
  currentExecution: null | Record<string, unknown>;
};

async function createActivity(
  description: string,
  responsible: Person,
  frequency: string,
  extra: Record<string, unknown> = {},
) {
  const response = await request(app)
    .post(`${API}/activities`)
    .set(as(admin))
    .send({
      description: `${TAG} ${description}`,
      participantId: responsible.participantId,
      frequency,
      ...extra,
    });
  expect(response.status).toBe(201);
  return response.body.activity as ActivityBody;
}

const complete = (person: Person, activityId: string, body: Record<string, unknown> = {}) =>
  request(app).post(`${API}/activities/${activityId}/complete`).set(as(person)).send(body);

const actorOf = (person: Person, role: 'ADMIN' | 'EMPLOYEE'): GardenActor => ({
  userId: person.userId,
  role,
  participantId: person.participantId ?? null,
});

beforeAll(async () => {
  expect(process.env.DATABASE_TARGET).toBe('demo');
  realState = await captureRealTaskState();
  startedAt = realState.startedAt;
  huertaBefore = await huertaCountsBefore(startedAt);
  app = createApp();
  admin = await createPerson('admin', 'ADMIN', {
    withEmployee: false,
    profileName: `Admin sintético ${RUN}`,
  });
  empA = await createPerson('a', 'EMPLOYEE');
  empB = await createPerson('b', 'EMPLOYEE');
  outsider = await createPerson('fuera', 'EMPLOYEE');
  suspended = await createPerson('suspendido', 'EMPLOYEE', { status: 'SUSPENDED' });
}, 90_000);

afterAll(async () => {
  const activityIds = (
    await prisma.kitchenGardenActivity.findMany({
      where: { description: { startsWith: TAG } },
      select: { id: true },
    })
  ).map((row) => row.id);
  const executionIds = (
    await prisma.kitchenGardenExecution.findMany({
      where: { activityId: { in: activityIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  const participantIds = (
    await prisma.kitchenGardenParticipant.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  await assertNoSyntheticWritesOnRealData(realState, userIds, []);
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { entityId: { in: [...activityIds, ...executionIds, ...participantIds] } },
      ],
    },
  });
  await prisma.kitchenGardenExecution.deleteMany({ where: { id: { in: executionIds } } });
  await prisma.kitchenGardenPlanningInterval.deleteMany({
    where: { activityId: { in: activityIds } },
  });
  await prisma.kitchenGardenActivity.deleteMany({ where: { id: { in: activityIds } } });
  await prisma.kitchenGardenParticipant.deleteMany({ where: { id: { in: participantIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });

  // ✅ Tareas intactas (conteos de lo anterior, filas reales idénticas, sin residuos).
  await assertRealTaskStateUnchanged(realState, userIds, RUN);
  // 🥬 Huerta: nada de esta corrida y lo anterior, igual.
  expect(
    await prisma.kitchenGardenActivity.count({ where: { description: { startsWith: TAG } } }),
  ).toBe(0);
  expect(await prisma.kitchenGardenParticipant.count({ where: { userId: { in: userIds } } })).toBe(
    0,
  );
  expect(await huertaCountsBefore(startedAt)).toEqual(huertaBefore);
}, 90_000);

describe('participantes (HTTP)', { timeout: 90_000 }, () => {
  it('candidatos: usuarios ACTIVE una sola vez (empleados y ADMIN), nunca suspendidos; solo ADMIN', async () => {
    const response = await request(app).get(`${API}/participants/candidates`).set(as(admin));
    expect(response.status).toBe(200);
    const ids = (response.body.candidates as { userId: string }[]).map((row) => row.userId);
    for (const person of [admin, empA, empB, outsider]) {
      expect(ids.filter((id) => id === person.userId)).toHaveLength(1);
    }
    expect(ids).not.toContain(suspended.userId);
    const adminRow = (response.body.candidates as { userId: string; displayName: string }[]).find(
      (row) => row.userId === admin.userId,
    );
    expect(adminRow?.displayName).toBe(`Admin sintético ${RUN}`);
    expect((await request(app).get(`${API}/participants/candidates`).set(as(empA))).status).toBe(
      403,
    );
  });

  it('ADMIN agrega un ADMIN sin ficha y empleados; repetido → 409; un EMPLOYEE no administra; nada cambia de rol', async () => {
    const adminParticipant = await addParticipant(admin);
    expect(adminParticipant).toMatchObject({
      displayName: `Admin sintético ${RUN}`,
      roleLabel: 'Administrador',
      active: true,
    });
    await addParticipant(empA);
    await addParticipant(empB);
    const again = await request(app)
      .post(`${API}/participants`)
      .set(as(admin))
      .send({ userId: empA.userId });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('GARDEN_PARTICIPANT_ALREADY_ACTIVE');
    const byEmployee = await request(app)
      .post(`${API}/participants`)
      .set(as(empA))
      .send({ userId: outsider.userId });
    expect(byEmployee.status).toBe(403);
    const suspendedAdd = await request(app)
      .post(`${API}/participants`)
      .set(as(admin))
      .send({ userId: suspended.userId });
    expect(suspendedAdd.status).toBe(400);
    // Participar no cambia rol ni crea usuarios o empleados.
    const roles = await prisma.user.findMany({
      where: { id: { in: [admin.userId, empA.userId, empB.userId] } },
      select: { role: true },
    });
    expect(roles.map((row) => row.role).sort()).toEqual(['ADMIN', 'EMPLOYEE', 'EMPLOYEE']);
    expect(await prisma.user.count({ where: { username: { startsWith: RUN } } })).toBe(5);
    expect(await prisma.employee.count({ where: { code: { startsWith: RUN } } })).toBe(4);
  });
});

describe('actividades, permisos y ejecuciones (HTTP)', { timeout: 90_000 }, () => {
  it('solo ADMIN crea; el responsable debe ser participante activo; todos consultan', async () => {
    const denied = await request(app)
      .post(`${API}/activities`)
      .set(as(empA))
      .send({ description: `${TAG} no`, participantId: empA.participantId, frequency: 'DAILY' });
    expect(denied.status).toBe(403);
    const invalid = await request(app)
      .post(`${API}/activities`)
      .set(as(admin))
      .send({
        description: `${TAG} fantasma`,
        participantId: crypto.randomUUID(),
        frequency: 'DAILY',
      });
    expect(invalid.status).toBe(400);
    const activity = await createActivity('regar almácigos', empA, 'DAILY');
    const listed = await request(app)
      .get(`${API}/activities?participantId=${empA.participantId}`)
      .set(as(outsider));
    expect(listed.status).toBe(200);
    const row = (listed.body.activities as ActivityBody[]).find((item) => item.id === activity.id);
    expect(row).toMatchObject({ canComplete: false, responsible: { id: empA.participantId } });
  });

  it('el participante completa lo suyo; no lo ajeno ni a nombre de otro; quien no participa, nada', async () => {
    const own = await createActivity('propia de A', empA, 'DAILY');
    const others = await createActivity('de B', empB, 'DAILY');
    expect((await complete(empA, own.id)).status).toBe(201);
    expect((await complete(empA, others.id)).status).toBe(403);
    expect((await complete(empB, others.id, { participantId: empA.participantId })).status).toBe(
      403,
    );
    const outside = await complete(outsider, others.id);
    expect(outside.status).toBe(403);
    expect(await prisma.kitchenGardenExecution.count({ where: { activityId: others.id } })).toBe(0);
  });

  it('ADMIN registra lo que hizo otro participante: responsable, ejecutor y usuario de la sesión por separado', async () => {
    const activity = await createActivity('asignada a B, la hizo A', empB, 'WEEKLY');
    const response = await complete(admin, activity.id, { participantId: empA.participantId });
    expect(response.status).toBe(201);
    expect(response.body.activity.currentExecution).toMatchObject({
      assignedTo: { id: empB.participantId, displayName: `Sintético b ${RUN}` },
      completedBy: { id: empA.participantId, displayName: `Sintético a ${RUN}` },
    });
    const row = await prisma.kitchenGardenExecution.findFirstOrThrow({
      where: { activityId: activity.id },
    });
    expect(row).toMatchObject({
      assignedParticipantId: empB.participantId,
      completedByParticipantId: empA.participantId,
      recordedByUserId: admin.userId,
    });
  });

  it('doble clic y concurrencia: una sola ejecución vigente y una sola auditoría', async () => {
    const activity = await createActivity('concurrente', empA, 'DAILY');
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => complete(empA, activity.id)),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(7);
    expect(responses.find((response) => response.status === 409)?.body.error.code).toBe(
      'GARDEN_ACTIVITY_ALREADY_COMPLETED',
    );
    const executions = await prisma.kitchenGardenExecution.findMany({
      where: { activityId: activity.id },
      select: { id: true },
    });
    expect(executions).toHaveLength(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'kitchen_garden.activity_completed', entityId: executions[0]!.id },
      }),
    ).toBe(1);
  });

  it('reversión lógica: el participante deshace lo suyo; ADMIN corrige con motivo; se puede volver a completar', async () => {
    const activity = await createActivity('revertible', empA, 'DAILY');
    const done = await complete(empA, activity.id);
    const executionId = done.body.activity.currentExecution.id as string;
    expect(
      (
        await request(app)
          .post(`${API}/activities/${activity.id}/revert`)
          .set(as(empB))
          .send({ executionId })
      ).status,
    ).toBe(403);
    const reverted = await request(app)
      .post(`${API}/activities/${activity.id}/revert`)
      .set(as(empA))
      .send({ executionId });
    expect(reverted.status).toBe(200);
    expect(reverted.body.activity.currentExecution).toBeNull();
    expect(
      await prisma.kitchenGardenExecution.findUniqueOrThrow({ where: { id: executionId } }),
    ).toMatchObject({
      completed: false,
      revertedByUserId: empA.userId,
    });
    const again = await complete(empA, activity.id);
    expect(again.status).toBe(201);
    const noReason = await request(app)
      .post(`${API}/activities/${activity.id}/revert`)
      .set(as(admin))
      .send({ executionId: again.body.activity.currentExecution.id });
    expect(noReason.status).toBe(400);
    expect(await prisma.kitchenGardenExecution.count({ where: { activityId: activity.id } })).toBe(
      2,
    );
  });
});

describe('historia, períodos y orden', { timeout: 120_000 }, () => {
  it('reasignar y cambiar la frecuencia no reescriben el pasado (planificación propia)', async () => {
    const activity = await createActivity('reasignable', empA, 'DAILY');
    const done = await complete(empA, activity.id);
    const executionId = done.body.activity.currentExecution.id as string;
    expect(
      (
        await request(app)
          .patch(`${API}/activities/${activity.id}`)
          .set(as(admin))
          .send({ participantId: empB.participantId })
      ).status,
    ).toBe(200);
    const history = await request(app).get(`${API}/history`).set(as(admin));
    const row = (
      history.body.recurring as {
        activity: { id: string; responsible: { id: string } };
        slots: { execution: { id: string; assignedTo: { id: string } } | null }[];
      }[]
    ).find((item) => item.activity.id === activity.id)!;
    expect(row.activity.responsible.id).toBe(empB.participantId);
    expect(
      row.slots.find((slot) => slot.execution?.id === executionId)?.execution?.assignedTo.id,
    ).toBe(empA.participantId);
    const changed = await request(app)
      .patch(`${API}/activities/${activity.id}`)
      .set(as(admin))
      .send({ frequency: 'WEEKLY', suggestedWeekday: 3 });
    expect(changed.status).toBe(200);
    const intervals = await prisma.kitchenGardenPlanningInterval.findMany({
      where: { activityId: activity.id },
      orderBy: { validFrom: 'asc' },
    });
    expect(
      intervals.map((row) => [row.participantId, row.frequency, row.validTo === null]),
    ).toEqual([
      [empA.participantId, 'DAILY', false],
      [empB.participantId, 'DAILY', false],
      [empB.participantId, 'WEEKLY', true],
    ]);
    expect(
      await prisma.kitchenGardenExecution.findUniqueOrThrow({ where: { id: executionId } }),
    ).toMatchObject({
      assignedParticipantId: empA.participantId,
      completedByParticipantId: empA.participantId,
    });
    // Nunca se escribió nada en las tablas de Tareas.
    expect(await prisma.task.count({ where: { description: { contains: RUN } } })).toBe(0);
  });

  it('quincenal: el 15 a las 23:59 es la 1.ª quincena y el 16 a las 00:00 la 2.ª (zona de negocio)', async () => {
    const adminActor = actorOf(admin, 'ADMIN');
    const { activity } = await createGardenActivity(
      adminActor,
      {
        description: `${TAG} quincenal`,
        participantId: empA.participantId!,
        frequency: 'SEMI_MONTHLY',
        suggestedFirstHalfDay: 10,
        suggestedSecondHalfDay: 31,
      },
      META,
      ar('2026-11-01', '08:00'),
    );
    const at = async (instant: Date) =>
      (
        await listGardenActivities(
          actorOf(empA, 'EMPLOYEE'),
          { participantId: empA.participantId, status: 'active' },
          instant,
        )
      ).activities.find((item) => item.id === activity.id)!;
    await completeGardenActivity(
      actorOf(empA, 'EMPLOYEE'),
      activity.id,
      undefined,
      META,
      ar('2026-11-15', '10:00'),
    );
    expect(await at(ar('2026-11-15', '23:59'))).toMatchObject({
      periodKey: '2026-11-Q1',
      canComplete: false,
      suggestedDate: '2026-11-10',
    });
    expect(await at(ar('2026-11-16', '00:00'))).toMatchObject({
      periodKey: '2026-11-Q2',
      canComplete: true,
      currentExecution: null,
      suggestedDate: '2026-11-30',
    });
  });

  it('«Una vez» con fecha: Programada, Para hoy y Vencida; completada sale del listado activo', async () => {
    const adminActor = actorOf(admin, 'ADMIN');
    const { activity } = await createGardenActivity(
      adminActor,
      {
        description: `${TAG} una vez con fecha`,
        participantId: empA.participantId!,
        frequency: 'ONE_TIME',
        scheduledDate: '2026-12-20',
      },
      META,
      ar('2026-12-01'),
    );
    const status = async (instant: Date) =>
      (
        await listGardenActivities(
          adminActor,
          { participantId: empA.participantId, status: 'active' },
          instant,
        )
      ).activities.find((item) => item.id === activity.id)?.scheduleStatus;
    expect(await status(ar('2026-12-19', '23:59'))).toBe('SCHEDULED');
    expect(await status(ar('2026-12-20', '00:00'))).toBe('DUE_TODAY');
    expect(await status(ar('2026-12-21', '00:00'))).toBe('OVERDUE');
    // Cumplimiento anticipado permitido; después sale del listado activo.
    await completeGardenActivity(
      actorOf(empA, 'EMPLOYEE'),
      activity.id,
      undefined,
      META,
      ar('2026-12-10'),
    );
    expect(await status(ar('2026-12-10', '18:00'))).toBeUndefined();
    const all = await listGardenActivities(
      adminActor,
      { participantId: empA.participantId, status: 'all' },
      ar('2026-12-10', '18:00'),
    );
    expect(all.activities.find((item) => item.id === activity.id)?.currentExecution).not.toBeNull();
  });

  it('fecha → orden dentro de la frecuencia y diarias por número (con filtros de persona y frecuencia)', async () => {
    const cases = [
      ['D 15/01 orden 2', '2027-01-15', 2],
      ['B 19/01 orden 3', '2027-01-19', 3],
      ['A sin fecha orden 1', null, 1],
      ['C 19/01 orden 1', '2027-01-19', 1],
    ] as const;
    for (const [label, date, executionOrder] of cases) {
      await createActivity(`única ${label}`, empB, 'ONE_TIME', {
        executionOrder,
        ...(date ? { scheduledDate: date } : {}),
      });
    }
    await createActivity('diaria Z orden 3', empB, 'DAILY', { executionOrder: 3 });
    await createActivity('diaria A sin orden', empB, 'DAILY');
    await createActivity('diaria M orden 1', empB, 'DAILY', { executionOrder: 1 });
    const listed = async (frequency: string) =>
      (
        (
          await request(app)
            .get(`${API}/activities?participantId=${empB.participantId}&frequency=${frequency}`)
            .set(as(empA))
        ).body.activities as ActivityBody[]
      )
        .filter(
          (item) =>
            item.description.startsWith(`${TAG} única`) ||
            item.description.startsWith(`${TAG} diaria`),
        )
        .map((item) => item.description.slice(TAG.length + 1));
    expect(await listed('ONE_TIME')).toEqual([
      'única D 15/01 orden 2',
      'única C 19/01 orden 1',
      'única B 19/01 orden 3',
      'única A sin fecha orden 1',
    ]);
    expect(await listed('DAILY')).toEqual([
      'diaria M orden 1',
      'diaria Z orden 3',
      'diaria A sin orden',
    ]);
  });
});

describe(
  'desempeño de la Huerta (servicio, ventana de 2001 sin datos reales)',
  { timeout: 120_000 },
  () => {
    it('cubierta por otro participante, propias y pendientes; quien no tiene obligaciones, sin porcentaje', async () => {
      const adminActor = actorOf(admin, 'ADMIN');
      const { activity } = await createGardenActivity(
        adminActor,
        {
          description: `${TAG} desempeño diaria`,
          participantId: empA.participantId!,
          frequency: 'DAILY',
        },
        META,
        ar('2001-06-01', '08:00'),
      );
      await completeGardenActivity(
        actorOf(empA, 'EMPLOYEE'),
        activity.id,
        undefined,
        META,
        ar('2001-06-02', '09:00'),
      );
      await completeGardenActivity(
        adminActor,
        activity.id,
        empB.participantId,
        META,
        ar('2001-06-03', '09:00'),
      );
      const result = await getGardenPerformance(
        adminActor,
        { from: '2001-06-01', to: '2001-06-07' },
        undefined,
        ar('2001-06-07', '20:00'),
      );
      const byId = Object.fromEntries(result.participants.map((row) => [row.participant.id, row]));
      // 7 días asignados a A: 1 propia (02), 1 cubierta por B (03) y 5 sin completar → 14,3 %.
      expect(byId[empA.participantId!]).toMatchObject({
        assigned: 7,
        completedPersonally: 1,
        coverageReceived: 1,
        pending: 5,
        percentage: 14.3,
      });
      expect(byId[empB.participantId!]).toMatchObject({
        assigned: 0,
        coverageGiven: 1,
        percentage: null,
      });
      expect(byId[admin.participantId!]).toMatchObject({ assigned: 0, percentage: null });
    });
  },
);

describe('aislamiento de ✅ Tareas e Inicio (HTTP)', { timeout: 90_000 }, () => {
  it('ninguna lista, historial ni Desempeño de Tareas, ni Inicio, incluye la Huerta', async () => {
    const huertaIds = [
      ...(await prisma.kitchenGardenActivity.findMany({
        where: { description: { startsWith: TAG } },
        select: { id: true },
      })),
      ...(await prisma.kitchenGardenExecution.findMany({
        where: { activity: { description: { startsWith: TAG } } },
        select: { id: true },
      })),
      ...[admin, empA, empB].map((person) => ({ id: person.participantId! })),
    ].map((row) => row.id);
    expect(huertaIds.length).toBeGreaterThan(0);
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    for (const path of [
      '/api/v1/tasks?status=all',
      '/api/v1/tasks/history',
      `/api/v1/performance/summary?from=${from}&to=${today}`,
      '/api/v1/dashboard',
    ]) {
      const response = await request(app).get(path).set(as(admin));
      expect(response.status, path).toBe(200);
      // Los empleados sintéticos del fixture SÍ aparecen en el equipo general
      // (son empleados); lo que nunca aparece es algo de la Huerta.
      const body = JSON.stringify(response.body);
      expect(body, path).not.toContain(TAG);
      for (const id of huertaIds) expect(body, path).not.toContain(id);
    }
    expect(await prisma.task.count({ where: { description: { contains: RUN } } })).toBe(0);
  });
});

describe('baja de participantes', { timeout: 120_000 }, () => {
  it('con actividades activas se rechaza; desactivándolas primero se permite y la historia queda', async () => {
    const blocked = await request(app)
      .patch(`${API}/participants/${empB.participantId}/status`)
      .set(as(admin))
      .send({ active: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('GARDEN_PARTICIPANT_HAS_ACTIVITIES');
    const own = await prisma.kitchenGardenActivity.findMany({
      where: { participantId: empB.participantId, active: true },
      select: { id: true },
    });
    for (const activity of own) {
      const off = await request(app)
        .patch(`${API}/activities/${activity.id}/status`)
        .set(as(admin))
        .send({ active: false });
      expect(off.status).toBe(200);
    }
    const executionsBefore = await prisma.kitchenGardenExecution.count({
      where: {
        OR: [
          { assignedParticipantId: empB.participantId },
          { completedByParticipantId: empB.participantId },
        ],
      },
    });
    const ok = await request(app)
      .patch(`${API}/participants/${empB.participantId}/status`)
      .set(as(admin))
      .send({ active: false });
    expect(ok.status).toBe(200);
    expect(ok.body.participant.active).toBe(false);
    const all = await request(app)
      .get(`${API}/activities?status=all&participantId=${empB.participantId}`)
      .set(as(admin));
    expect((all.body.activities as ActivityBody[]).length).toBe(own.length);
    expect(
      await prisma.kitchenGardenExecution.count({
        where: {
          OR: [
            { assignedParticipantId: empB.participantId },
            { completedByParticipantId: empB.participantId },
          ],
        },
      }),
    ).toBe(executionsBefore);
    // Una participación inactiva no completa.
    expect((await complete(empB, own[0]!.id)).status).toBe(403);
  });

  it('suspender la cuenta no borra su historia; deja de ser candidata', async () => {
    await prisma.user.update({ where: { id: empA.userId }, data: { status: 'SUSPENDED' } });
    const history = await request(app)
      .get(`${API}/history?participantId=${empA.participantId}`)
      .set(as(admin));
    expect(history.status).toBe(200);
    const names = JSON.stringify(history.body);
    expect(names).toContain(`Sintético a ${RUN}`);
    const candidates = await request(app).get(`${API}/participants/candidates`).set(as(admin));
    expect(
      (candidates.body.candidates as { userId: string }[]).some(
        (row) => row.userId === empA.userId,
      ),
    ).toBe(false);
    const participants = await request(app).get(`${API}/participants`).set(as(admin));
    expect(
      (participants.body.participants as { id: string; userActive: boolean }[]).find(
        (row) => row.id === empA.participantId,
      ),
    ).toMatchObject({ userActive: false });
  });
});
