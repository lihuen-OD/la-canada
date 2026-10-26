import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import { startOfLocalDay } from '../../lib/businessTime';
import {
  createPetRecord,
  getPetDueAlerts,
  voidPetRecord,
  type PetActor,
} from '../../pets/petService';

/**
 * 🐾 Atenciones de mascotas en Inicio contra Neon real (`demo`): la consulta
 * real (regla de 📅 Vencimientos, mascotas activas, ventana de 30 días,
 * totales y orden antes de limitar a 5), cumplimiento y reapertura por los
 * flujos reales del servicio, y `GET /dashboard` por HTTP para los dos roles.
 *
 * Datos SINTÉTICOS (`test-pdh-<RUN>`: usuarios, empleado, tipo, mascotas y
 * descripciones) con fechas de 2001 y un «ahora» de junio de 2001: cualquier
 * pendiente real (de 2025 en adelante) queda a más de 30 días, así que los
 * totales del servicio son exactamente los de los fixtures sin depender de
 * los datos de `demo` (se verifica como precondición). Ninguna fila
 * preexistente se edita. Limpieza solo por id de lo creado; `afterAll`
 * comprueba que las filas creadas antes de empezar siguen idénticas (excepto
 * las que otra persona tocó mientras corría: `demo` puede estar en uso).
 */

const RUN = `test-pdh-${Date.now()}`;
const TZ = config.businessTimeZone;
const META = { ipAddress: null, userAgent: 'integration-test' };

interface Actor {
  userId: string;
  token: string;
}

let app: Express;
let admin: Actor;
let employee: Actor;
let employeeId = '';
let typeId = '';
let petA = '';
let petB = '';
let petInactive = '';
const userIds: string[] = [];
let startedAt: Date;
let before: Awaited<ReturnType<typeof snapshotBefore>>;

/** Medianoche de `BUSINESS_TIME_ZONE` del día `YYYY-MM-DD` (sin suponer el desfase). */
const midnight = (text: string) => {
  const [year, month, day] = text.split('-').map(Number);
  return startOfLocalDay({ year: year!, month: month!, day: day! }, TZ);
};
/** «Ahora» de las pruebas: viernes 15/06/2001 al mediodía de Buenos Aires. */
const NOW = new Date(midnight('2001-06-15').getTime() + 12 * 3_600_000);
const D = (text: string) => new Date(`${text}T00:00:00.000Z`);

const adminActor = (): PetActor => ({ userId: admin.userId, role: 'ADMIN', employeeId: null });
const employeeActor = (): PetActor => ({ userId: employee.userId, role: 'EMPLOYEE', employeeId });

/** Filas creadas ANTES de empezar (reales o ajenas a esta prueba). */
async function snapshotBefore(at: Date) {
  const created = { createdAt: { lt: at } };
  const [counts, animals, records] = await Promise.all([
    Promise.all([
      prisma.animal.count({ where: created }),
      prisma.animalType.count({ where: created }),
      prisma.animalMedicalRecord.count({ where: created }),
      prisma.auditLog.count({ where: created }),
      prisma.user.count({ where: created }),
      prisma.session.count({ where: created }),
      prisma.employee.count({ where: created }),
    ]),
    prisma.animal.findMany({
      where: created,
      select: { id: true, name: true, active: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
    prisma.animalMedicalRecord.findMany({
      where: created,
      select: {
        id: true,
        voidedAt: true,
        nextDueDate: true,
        fulfillsRecordId: true,
        updatedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
  ]);
  return { counts, animals, records };
}

async function createActor(role: 'ADMIN' | 'EMPLOYEE', suffix: string, linked?: string) {
  const user = await prisma.user.create({
    data: {
      username: `${RUN}-${suffix}`,
      role,
      status: 'ACTIVE',
      pinHash: 'synthetic-not-a-real-hash',
      employeeId: linked,
    },
    select: { id: true },
  });
  userIds.push(user.id);
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

/** Pendiente sintético directo (la regla se prueba en la consulta, no en el alta). */
async function pending(
  petId: string,
  label: string,
  nextDueDate: string | null,
  {
    type = 'VACCINE',
    recordDate = '2001-01-01',
  }: { type?: 'VACCINE' | 'CHECKUP'; recordDate?: string } = {},
) {
  const row = await prisma.animalMedicalRecord.create({
    data: {
      animalId: petId,
      type,
      recordDate: D(recordDate),
      description: `${RUN} ${label}`,
      nextDueDate: nextDueDate ? D(nextDueDate) : null,
      employeeId,
      recordedByUserId: employee.userId,
    },
    select: { id: true },
  });
  return row.id;
}

const labels = (summary: Awaited<ReturnType<typeof getPetDueAlerts>>) =>
  summary.items.map((item) => item.record.description?.slice(RUN.length + 1));

async function syntheticRecordIds() {
  return (
    await prisma.animalMedicalRecord.findMany({
      where: { animalId: { in: [petA, petB, petInactive] } },
      select: { id: true },
    })
  ).map((row) => row.id);
}

async function removeSyntheticRecords() {
  const ids = await syntheticRecordIds();
  // Primero los que cumplen (FK RESTRICT hacia el pendiente), después el resto.
  await prisma.animalMedicalRecord.deleteMany({
    where: { id: { in: ids }, fulfillsRecordId: { not: null } },
  });
  await prisma.animalMedicalRecord.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  expect(process.env.DATABASE_TARGET).toBe('demo');
  startedAt = new Date(Date.now() - 1);
  before = await snapshotBefore(startedAt);
  app = createApp();
  employeeId = (
    await prisma.employee.create({
      data: {
        code: `${RUN}-emp`,
        displayName: `Persona ${RUN}`,
        role: 'Test',
        colorHex: '#4a7c59',
      },
      select: { id: true },
    })
  ).id;
  admin = await createActor('ADMIN', 'admin');
  employee = await createActor('EMPLOYEE', 'emp', employeeId);
  typeId = (await prisma.animalType.create({ data: { name: `${RUN}-tipo` }, select: { id: true } }))
    .id;
  const pet = async (suffix: string, active = true) =>
    (
      await prisma.animal.create({
        data: { name: `${RUN}-${suffix}`, animalTypeId: typeId, active },
        select: { id: true },
      })
    ).id;
  petA = await pet('a');
  petB = await pet('b');
  petInactive = await pet('inactiva', false);
  // Precondición: en junio de 2001 `demo` no tiene pendientes reales que alerten.
  expect(
    await getPetDueAlerts(adminActor(), NOW),
    'demo tiene pendientes reales con fecha hasta el 15/07/2001',
  ).toEqual({ counts: { overdue: 0, dueToday: 0, upcoming: 0 }, items: [] });
}, 60_000);

afterEach(removeSyntheticRecords, 60_000);

afterAll(async () => {
  await removeSyntheticRecords();
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.animal.deleteMany({ where: { id: { in: [petA, petB, petInactive] } } });
  await prisma.animalType.deleteMany({ where: { id: typeId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: employeeId } });

  // Sin residuos de esta corrida.
  expect(await prisma.animal.count({ where: { name: { startsWith: RUN } } })).toBe(0);
  expect(await prisma.animalType.count({ where: { name: { startsWith: RUN } } })).toBe(0);
  expect(
    await prisma.animalMedicalRecord.count({ where: { description: { startsWith: RUN } } }),
  ).toBe(0);
  expect(await prisma.user.count({ where: { username: { startsWith: RUN } } })).toBe(0);
  expect(await prisma.employee.count({ where: { code: { startsWith: RUN } } })).toBe(0);
  expect(await prisma.auditLog.count({ where: { actorUserId: { in: userIds } } })).toBe(0);

  // Lo creado antes de empezar: mismos conteos y filas idénticas, salvo lo que
  // otra persona tocó durante la prueba (auditoría de actores no sintéticos).
  const after = await snapshotBefore(startedAt);
  expect(after.counts).toEqual(before.counts);
  const touched = new Set(
    (
      await prisma.auditLog.findMany({
        where: {
          createdAt: { gte: startedAt },
          action: { startsWith: 'pet.' },
          OR: [{ actorUserId: null }, { actorUserId: { notIn: userIds } }],
        },
        select: { entityId: true },
      })
    ).map((audit) => audit.entityId),
  );
  const untouched = <T extends { id: string }>(rows: T[]) =>
    rows.filter((row) => !touched.has(row.id));
  expect(untouched(after.animals)).toEqual(untouched(before.animals));
  expect(untouched(after.records)).toEqual(untouched(before.records));
}, 60_000);

describe('🐾 Atenciones de mascotas — consulta real (servicio, «ahora» = 15/06/2001)', () => {
  it('límites: vencida antigua, ayer, hoy, mañana y día 30 entran; día 31 y sin próxima fecha, no', async () => {
    await pending(petA, 'día 31', '2001-07-16');
    await pending(petA, 'mañana', '2001-06-16');
    await pending(petA, 'sin fecha', null);
    await pending(petA, 'día 30', '2001-07-15');
    await pending(petA, 'hoy', '2001-06-15');
    await pending(petA, 'antigua', '2001-01-10', { recordDate: '2001-01-02' });
    await pending(petA, 'ayer', '2001-06-14');

    const summary = await getPetDueAlerts(employeeActor(), NOW);
    expect(summary.counts).toEqual({ overdue: 2, dueToday: 1, upcoming: 2 });
    expect(labels(summary)).toEqual(['antigua', 'ayer', 'hoy', 'mañana', 'día 30']);
    expect(summary.items.map((item) => [item.nextDue.status, item.nextDue.daysUntil])).toEqual([
      ['OVERDUE', -156],
      ['OVERDUE', -1],
      ['DUE_TODAY', 0],
      ['UPCOMING', 1],
      ['UPCOMING', 30],
    ]);
  }, 60_000);

  it('más de 5: totales de toda la ventana; filas = vencidas antiguas → hoy → próximas, limitadas a 5', async () => {
    await pending(petB, 'próxima 10/07', '2001-07-10');
    await pending(petA, 'vencida 01/03', '2001-03-01');
    await pending(petB, 'hoy', '2001-06-15');
    await pending(petA, 'próxima 20/06 segunda', '2001-06-20', { recordDate: '2001-02-01' });
    await pending(petB, 'vencida 01/05', '2001-05-01');
    await pending(petB, 'próxima 25/06', '2001-06-25');
    await pending(petA, 'vencida 10/06', '2001-06-10');
    await pending(petA, 'próxima 20/06 primera', '2001-06-20', { recordDate: '2001-01-01' });

    const summary = await getPetDueAlerts(adminActor(), NOW);
    expect(summary.counts).toEqual({ overdue: 3, dueToday: 1, upcoming: 4 });
    expect(labels(summary)).toEqual([
      'vencida 01/03',
      'vencida 01/05',
      'vencida 10/06',
      'hoy',
      'próxima 20/06 primera',
    ]);
  }, 60_000);

  it('dos atenciones del mismo tipo de una mascota: filas separadas, desempate estable (atención y id)', async () => {
    const later = await pending(petA, 'vacuna B', '2001-06-20', { recordDate: '2001-03-01' });
    const sameDayA = await pending(petA, 'vacuna C', '2001-06-20', { recordDate: '2001-02-01' });
    const sameDayB = await pending(petA, 'vacuna D', '2001-06-20', { recordDate: '2001-02-01' });
    const earlier = await pending(petA, 'vacuna A', '2001-06-20', { recordDate: '2001-01-01' });
    const tied = [sameDayA, sameDayB].sort();
    const expected = [earlier, ...tied, later];

    const first = await getPetDueAlerts(adminActor(), NOW);
    const second = await getPetDueAlerts(employeeActor(), NOW);
    expect(first.items.map((item) => item.record.id)).toEqual(expected);
    expect(second).toEqual(first);
    expect(first.counts).toEqual({ overdue: 0, dueToday: 0, upcoming: 4 });
    expect(new Set(first.items.map((item) => item.pet.id))).toEqual(new Set([petA]));
  }, 60_000);

  it('cumplida: sale del resumen; si se anula su cumplimiento, el pendiente vuelve (flujos reales)', async () => {
    /** «Guardar registro» real (sin `Idempotency-Key`: siempre `created`). */
    const register = async (input: Parameters<typeof createPetRecord>[2]) => {
      const result = await createPetRecord(employeeActor(), petA, input, META, NOW);
      if (result.kind !== 'created') throw new Error('se esperaba un alta');
      return result.body.record;
    };
    const original = await register({
      type: 'VACCINE',
      recordDate: '2001-06-01',
      description: `${RUN} antirrábica`,
      nextDueDate: '2001-06-20',
    });
    expect((await getPetDueAlerts(adminActor(), NOW)).items.map((i) => i.record.id)).toEqual([
      original.id,
    ]);

    const fulfillment = await register({
      type: 'VACCINE',
      recordDate: '2001-06-10',
      description: `${RUN} aplicada`,
      fulfillsRecordId: original.id,
    });
    expect(await getPetDueAlerts(adminActor(), NOW)).toEqual({
      counts: { overdue: 0, dueToday: 0, upcoming: 0 },
      items: [],
    });

    await voidPetRecord(adminActor(), petA, fulfillment.id, META, NOW);
    const reopened = await getPetDueAlerts(adminActor(), NOW);
    expect(reopened.counts).toEqual({ overdue: 0, dueToday: 0, upcoming: 1 });
    expect(reopened.items.map((item) => item.record.id)).toEqual([original.id]);
  }, 60_000);

  it('registro original anulado y mascota inactiva: excluidos', async () => {
    const voided = await pending(petA, 'anulada', '2001-06-20');
    await voidPetRecord(adminActor(), petA, voided, META, NOW);
    await pending(petInactive, 'de mascota inactiva', '2001-06-14');
    expect(await getPetDueAlerts(adminActor(), NOW)).toEqual({
      counts: { overdue: 0, dueToday: 0, upcoming: 0 },
      items: [],
    });
  }, 60_000);

  it('cambio de día en BUSINESS_TIME_ZONE: 23:59 del 15/06 → próxima; 00:00 del 16 → hoy; del 17 → vencida', async () => {
    await pending(petB, 'control', '2001-06-16', { type: 'CHECKUP' });
    const status = async (at: Date) => (await getPetDueAlerts(adminActor(), at)).items[0]!.nextDue;
    expect(await status(new Date(midnight('2001-06-16').getTime() - 60_000))).toMatchObject({
      status: 'UPCOMING',
      daysUntil: 1,
    });
    expect(await status(midnight('2001-06-16'))).toMatchObject({
      status: 'DUE_TODAY',
      daysUntil: 0,
    });
    expect(await status(midnight('2001-06-17'))).toMatchObject({
      status: 'OVERDUE',
      daysUntil: -1,
    });
  }, 60_000);
});

describe('🐾 Atenciones de mascotas — GET /dashboard (HTTP, hoy real)', () => {
  it('ADMIN y EMPLOYEE leen el mismo resumen (lectura de todos), sin campos de más', async () => {
    const asEmployee = await request(app).get('/api/v1/dashboard').set(as(employee));
    const asAdmin = await request(app).get('/api/v1/dashboard').set(as(admin));
    expect(asEmployee.status).toBe(200);
    expect(asAdmin.status).toBe(200);
    const petDue = asEmployee.body.petDue as Awaited<ReturnType<typeof getPetDueAlerts>>;
    expect(asAdmin.body.petDue).toEqual(petDue);
    expect(Object.keys(petDue).sort()).toEqual(['counts', 'items']);
    expect(petDue.items.length).toBeLessThanOrEqual(5);
    const total = petDue.counts.overdue + petDue.counts.dueToday + petDue.counts.upcoming;
    expect(petDue.items.length).toBe(Math.min(5, total));
    for (const item of petDue.items) {
      expect(Object.keys(item).sort()).toEqual(['nextDue', 'pet', 'record']);
      expect(Object.keys(item.record).sort()).toEqual(['description', 'id', 'type']);
      expect(Object.keys(item.pet).sort()).toEqual(['id', 'name']);
      expect(Object.keys(item.nextDue).sort()).toEqual(['date', 'daysUntil', 'status']);
      expect(['OVERDUE', 'DUE_TODAY', 'UPCOMING']).toContain(item.nextDue.status);
    }
    // Lo mismo que calcula el servicio de Mascotas para hoy.
    expect(await getPetDueAlerts(adminActor(), new Date())).toEqual(petDue);
  }, 60_000);
});
