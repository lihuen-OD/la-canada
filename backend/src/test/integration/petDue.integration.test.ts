import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import { addDays, formatLocalDate, toLocalDate } from '../../lib/businessTime';

/**
 * 🐾 Próximas aplicaciones o controles contra Neon real (`demo`) por HTTP
 * real: estados por fecha de calendario de `BUSINESS_TIME_ZONE`, Vencimientos
 * (orden, filtros, paginación), cumplimiento explícito, doble envío y
 * concurrencia, anulación y reapertura, mascotas inactivas, permisos e
 * indicadores del listado. Reglas de datos:
 *  - todo lo creado lleva el prefijo `test-due-<RUN>` (usuarios, empleado,
 *    tipo, mascotas y descripciones); Vencimientos se consulta SIEMPRE
 *    filtrado por las mascotas sintéticas;
 *  - nunca se edita ninguna fila preexistente;
 *  - `afterAll` borra solo lo creado (por id) y verifica conteos globales
 *    idénticos a los iniciales.
 */

const RUN = `test-due-${Date.now()}`;

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
let baseline: Record<string, number>;

const today = () => toLocalDate(new Date(), config.businessTimeZone);
const day = (offset: number) => formatLocalDate(addDays(today(), offset));

async function globalCounts() {
  return {
    animals: await prisma.animal.count(),
    types: await prisma.animalType.count(),
    records: await prisma.animalMedicalRecord.count(),
    audits: await prisma.auditLog.count(),
    idempotency: await prisma.idempotencyRecord.count(),
    users: await prisma.user.count(),
    sessions: await prisma.session.count(),
    employees: await prisma.employee.count(),
  };
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
const key = () => crypto.randomUUID().replace(/-/g, '');

interface NextDue {
  date: string;
  status: string;
  daysUntil: number;
  fulfilledBy: { id: string } | null;
}
interface RecordDto {
  id: string;
  description: string;
  nextDue: NextDue | null;
  fulfills: { id: string } | null;
}

async function postRecord(actor: Actor, petId: string, body: object, idempotencyKey = key()) {
  return request(app)
    .post(`/api/v1/pets/${petId}/records`)
    .set(as(actor))
    .set('Idempotency-Key', idempotencyKey)
    .send(body);
}

async function record(
  petId: string,
  description: string,
  recordDate: string,
  nextDueDate?: string,
  type = 'VACCINE',
) {
  const response = await postRecord(employee, petId, {
    type,
    recordDate,
    description: `${RUN} ${description}`,
    ...(nextDueDate ? { nextDueDate } : {}),
  });
  expect(response.status).toBe(201);
  return response.body.record as RecordDto;
}

const due = (actor: Actor, query: Record<string, string>) =>
  request(app)
    .get('/api/v1/pets/due')
    .set(as(actor))
    .query({ pageSize: '50', ...query });

beforeAll(async () => {
  baseline = await globalCounts();
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
  petInactive = await pet('inactiva');
}, 60_000);

afterAll(async () => {
  const petIds = [petA, petB, petInactive];
  const recordIds = (
    await prisma.animalMedicalRecord.findMany({
      where: { animalId: { in: petIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  await prisma.idempotencyRecord.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { entityId: { in: [...recordIds, ...petIds, typeId] } },
      ],
    },
  });
  // Primero los que cumplen (FK RESTRICT hacia el pendiente), después el resto.
  await prisma.animalMedicalRecord.deleteMany({
    where: { id: { in: recordIds }, fulfillsRecordId: { not: null } },
  });
  await prisma.animalMedicalRecord.deleteMany({ where: { id: { in: recordIds } } });
  await prisma.animal.deleteMany({ where: { id: { in: petIds } } });
  await prisma.animalType.deleteMany({ where: { id: typeId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: employeeId } });
  expect(await globalCounts()).toEqual(baseline);
  expect(await prisma.animal.count({ where: { name: { startsWith: 'test-due-' } } })).toBe(0);
}, 60_000);

describe('estados por fecha de calendario de BUSINESS_TIME_ZONE', () => {
  const ids: Record<string, string> = {};

  it('límites de 31 y 30 días, mañana, hoy y ayer; histórico vencido; sin fecha no es pendiente', async () => {
    const cases = [
      ['vigente-31', 31, 'SCHEDULED'],
      ['proxima-30', 30, 'UPCOMING'],
      ['proxima-manana', 1, 'UPCOMING'],
      ['vence-hoy', 0, 'DUE_TODAY'],
      ['vencida-ayer', -1, 'OVERDUE'],
    ] as const;
    for (const [name, offset, status] of cases) {
      // La atención es anterior a la fecha programada (histórica para hoy y ayer).
      const created = await record(petA, name, day(Math.min(0, offset) - 40), day(offset));
      ids[name] = created.id;
      expect(created.nextDue).toMatchObject({ date: day(offset), status, daysUntil: offset });
    }
    const legacy = await record(petA, 'sin-fecha', day(-5));
    ids['sin-fecha'] = legacy.id;
    expect(legacy.nextDue).toBeNull();
    // La próxima fecha debe ser posterior a la atención.
    const invalid = await postRecord(employee, petA, {
      type: 'VACCINE',
      recordDate: day(0),
      nextDueDate: day(0),
    });
    expect(invalid.status).toBe(400);
  });

  it('Vencimientos: por fecha ascendente (primero las vencidas), filtros y paginación en el backend', async () => {
    const all = await due(employee, { petId: petA });
    expect(all.status).toBe(200);
    const names = (all.body.items as { record: { description: string } }[]).map((item) =>
      item.record.description.replace(`${RUN} `, ''),
    );
    expect(names).toEqual([
      'vencida-ayer',
      'vence-hoy',
      'proxima-manana',
      'proxima-30',
      'vigente-31',
    ]);
    expect(all.body.today).toBe(day(0));
    expect(new Date(all.body.refreshAt).getTime()).toBeGreaterThan(Date.now());

    const upcoming = await due(employee, { petId: petA, status: 'UPCOMING' });
    expect(upcoming.body.total).toBe(2);
    const overdue = await due(employee, { petId: petA, status: 'OVERDUE' });
    expect(overdue.body.items.map((item: { record: { id: string } }) => item.record.id)).toEqual([
      ids['vencida-ayer'],
    ]);
    const deworming = await due(employee, { petId: petA, type: 'DEWORMING' });
    expect(deworming.body.total).toBe(0);

    const page1 = await due(employee, { petId: petA, pageSize: '2' });
    const page3 = await due(employee, { petId: petA, pageSize: '2', page: '3' });
    expect(page1.body).toMatchObject({ total: 5, totalPages: 3 });
    expect(page1.body.items).toHaveLength(2);
    expect(page3.body.items).toHaveLength(1);
  });

  it('indicadores del listado: vencidas, de hoy y próximas por mascota, sin consulta por animal', async () => {
    const list = await request(app).get('/api/v1/pets').set(as(employee)).query({ typeId });
    expect(list.status).toBe(200);
    const byId = new Map(
      (list.body.pets as { id: string; dueSummary: unknown }[]).map((pet) => [
        pet.id,
        pet.dueSummary,
      ]),
    );
    expect(byId.get(petA)).toEqual({ overdue: 1, dueToday: 1, upcoming: 2 });
    expect(byId.get(petB)).toEqual({ overdue: 0, dueToday: 0, upcoming: 0 });
  });
});

describe('cumplimiento explícito, idempotencia y concurrencia', () => {
  let rabies = '';
  let sextuple = '';

  it('dos vacunas en la misma mascota: se cumple SOLO la elegida; la otra sigue pendiente', async () => {
    rabies = (await record(petB, 'antirrabica', day(-365), day(-2))).id;
    sextuple = (await record(petB, 'sextuple', day(-300), day(10))).id;
    const response = await postRecord(employee, petB, {
      type: 'VACCINE',
      recordDate: day(0),
      description: `${RUN} antirrabica aplicada`,
      nextDueDate: day(365),
      fulfillsRecordId: rabies,
    });
    expect(response.status).toBe(201);
    const newRecord = response.body.record as RecordDto;
    expect(newRecord.fulfills).toMatchObject({ id: rabies });
    // El nuevo registro genera su propio pendiente.
    expect(newRecord.nextDue).toMatchObject({ status: 'SCHEDULED', daysUntil: 365 });
    const stored = await prisma.animalMedicalRecord.findUniqueOrThrow({
      where: { id: newRecord.id },
    });
    expect(stored).toMatchObject({ fulfillsRecordId: rabies, recordedByUserId: employee.userId });

    const history = await request(app).get(`/api/v1/pets/${petB}/records`).set(as(admin));
    const byId = new Map((history.body.records as RecordDto[]).map((row) => [row.id, row]));
    expect(byId.get(rabies)?.nextDue).toMatchObject({
      status: 'FULFILLED',
      fulfilledBy: { id: newRecord.id },
    });
    expect(byId.get(sextuple)?.nextDue?.status).toBe('UPCOMING');

    const open = await due(admin, { petId: petB });
    expect(open.body.items.map((item: { record: { id: string } }) => item.record.id)).toEqual([
      sextuple,
      newRecord.id,
    ]);
    const fulfilled = await due(admin, { petId: petB, status: 'FULFILLED' });
    expect(fulfilled.body.items.map((item: { record: { id: string } }) => item.record.id)).toEqual([
      rabies,
    ]);
  });

  it('doble clic (misma clave) crea UNA aplicación; dos solicitudes distintas a la vez, una sola', async () => {
    const body = {
      type: 'VACCINE',
      recordDate: day(0),
      description: `${RUN} sextuple aplicada`,
      fulfillsRecordId: sextuple,
    };
    const sameKey = key();
    const [first, second] = await Promise.all([
      postRecord(employee, petB, body, sameKey),
      postRecord(employee, petB, body, sameKey),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 201]);
    expect(second.body).toEqual(first.body);
    // Sin siguiente fecha: no genera un pendiente nuevo.
    expect((first.body.record as RecordDto).nextDue).toBeNull();

    const [a, b] = await Promise.all([
      postRecord(admin, petB, { ...body, description: `${RUN} duplicada 1` }),
      postRecord(employee, petB, { ...body, description: `${RUN} duplicada 2` }),
    ]);
    expect([a.status, b.status]).toEqual([409, 409]);
    expect(
      await prisma.animalMedicalRecord.count({
        where: { fulfillsRecordId: sextuple, voidedAt: null },
      }),
    ).toBe(1);
  });

  it('carrera real: dos solicitudes simultáneas sobre un pendiente abierto → una 201 y una 409', async () => {
    const target = (await record(petB, 'desparasitacion', day(-100), day(5), 'DEWORMING')).id;
    const body = { type: 'DEWORMING', recordDate: day(0), fulfillsRecordId: target };
    const results = await Promise.all([
      postRecord(admin, petB, { ...body, description: `${RUN} carrera 1` }),
      postRecord(employee, petB, { ...body, description: `${RUN} carrera 2` }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.animalMedicalRecord.count({
        where: { fulfillsRecordId: target, voidedAt: null },
      }),
    ).toBe(1);
  });

  it('anular la aplicación reabre el pendiente; anular el original lo saca de Vencimientos', async () => {
    const fulfiller = await prisma.animalMedicalRecord.findFirstOrThrow({
      where: { fulfillsRecordId: rabies, voidedAt: null },
      select: { id: true },
    });
    expect(
      (
        await request(app)
          .post(`/api/v1/pets/${petB}/records/${fulfiller.id}/void`)
          .set(as(employee))
          .send({})
      ).status,
    ).toBe(403);
    const voided = await request(app)
      .post(`/api/v1/pets/${petB}/records/${fulfiller.id}/void`)
      .set(as(admin))
      .send({});
    expect(voided.status).toBe(200);
    const reopened = await due(admin, { petId: petB, status: 'OVERDUE' });
    expect(reopened.body.items.map((item: { record: { id: string } }) => item.record.id)).toContain(
      rabies,
    );
    // Se puede volver a cumplir.
    const again = await postRecord(admin, petB, {
      type: 'VACCINE',
      recordDate: day(0),
      fulfillsRecordId: rabies,
    });
    expect(again.status).toBe(201);

    await request(app)
      .post(`/api/v1/pets/${petB}/records/${sextuple}/void`)
      .set(as(admin))
      .send({});
    const afterVoid = await due(admin, { petId: petB, status: 'FULFILLED' });
    expect(
      afterVoid.body.items.map((item: { record: { id: string } }) => item.record.id),
    ).not.toContain(sextuple);
  });
});

describe('corrección de fecha, mascotas inactivas y permisos', () => {
  it('ADMIN completa la fecha de un registro anterior (auditado); EMPLOYEE no puede', async () => {
    const legacy = await record(petA, 'completar-despues', day(-20));
    const denied = await request(app)
      .patch(`/api/v1/pets/${petA}/records/${legacy.id}/next-due`)
      .set(as(employee))
      .send({ nextDueDate: day(3) });
    expect(denied.status).toBe(403);
    const ok = await request(app)
      .patch(`/api/v1/pets/${petA}/records/${legacy.id}/next-due`)
      .set(as(admin))
      .send({ nextDueDate: day(3) });
    expect(ok.status).toBe(200);
    expect(ok.body.record.nextDue).toMatchObject({ status: 'UPCOMING', daysUntil: 3 });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: legacy.id, action: 'pet.record_next_due_updated' },
    });
    expect(audit.actorUserId).toBe(admin.userId);
    expect(audit.newState).toEqual({ nextDueDate: day(3) });
    const before = await prisma.animalMedicalRecord.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(before.description).toBe(`${RUN} completar-despues`);
    const invalid = await request(app)
      .patch(`/api/v1/pets/${petA}/records/${legacy.id}/next-due`)
      .set(as(admin))
      .send({ nextDueDate: day(-20) });
    expect(invalid.status).toBe(400);
  });

  it('una mascota inactiva conserva su historial, no admite aplicaciones ni aparece en Vencimientos', async () => {
    await prisma.animal.update({ where: { id: petInactive }, data: { active: true } });
    const pending = await record(petInactive, 'inactiva', day(-60), day(-10));
    await prisma.animal.update({ where: { id: petInactive }, data: { active: false } });
    const blocked = await postRecord(employee, petInactive, {
      type: 'VACCINE',
      recordDate: day(0),
      fulfillsRecordId: pending.id,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PET_INACTIVE');
    const list = await due(admin, { petId: petInactive });
    expect(list.body.total).toBe(0);
    const history = await request(app).get(`/api/v1/pets/${petInactive}/records`).set(as(admin));
    expect((history.body.records as RecordDto[]).map((row) => row.id)).toContain(pending.id);
  });
});
