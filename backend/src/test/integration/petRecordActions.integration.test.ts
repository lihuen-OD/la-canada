import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import { addDays, formatLocalDate, toLocalDate } from '../../lib/businessTime';
import { PET_TYPE_ICON_OPTIONS } from '../../pets/petCatalog';

/**
 * 🐾 Corregir la próxima fecha y anular registros clínicos — ADMIN y EMPLOYEE
 * activos, sobre registros de cualquier autor (ampliación del 2026-11-02) —
 * contra Neon real (`demo`) por HTTP real: sin sesión no se puede; autor y
 * persona se conservan; auditoría del actor real con valores anterior y
 * nuevo; guardar sin cambios no escribe; validaciones de fechas, Peso,
 * anulados y cumplidos; dos correcciones simultáneas (una 409, sin pisar);
 * corregir mientras otra persona registra la aplicación; anular reabre el
 * pendiente que cumplía; doble anulación con una sola auditoría; y los demás
 * permisos de Mascotas siguen siendo de ADMIN. Reglas de datos:
 *  - todo lo creado lleva el prefijo `test-pra-<RUN>` (usuarios, empleados,
 *    tipo, mascotas y descripciones); Vencimientos se consulta SIEMPRE
 *    filtrado por la mascota sintética;
 *  - nunca se edita ninguna fila preexistente;
 *  - `afterAll` borra solo los ids creados y verifica que no quede ninguno.
 */

const RUN = `test-pra-${Date.now()}`;
const api = '/api/v1/pets';
/** Pruebas con muchas requests secuenciales contra Neon (latencia real de red). */
const SLOW = 120_000;

interface Actor {
  userId: string;
  token: string;
}

let app: Express;
let admin: Actor;
let employeeA: Actor;
let employeeB: Actor;
const employeeIds: string[] = [];
const userIds: string[] = [];
let typeId = '';
let petId = '';
let otherPetId = '';

const today = () => toLocalDate(new Date(), config.businessTimeZone);
const day = (offset: number) => formatLocalDate(addDays(today(), offset));
const dbDate = (text: string) => new Date(`${text}T00:00:00.000Z`);

async function createEmployee(suffix: string) {
  const { id } = await prisma.employee.create({
    data: {
      code: `${RUN}-${suffix}`,
      displayName: `Persona ${RUN} ${suffix}`,
      role: 'Test',
      colorHex: '#4a7c59',
    },
    select: { id: true },
  });
  employeeIds.push(id);
  return id;
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

interface RecordDto {
  id: string;
  employee: { id: string } | null;
  nextDue: { date: string; status: string } | null;
  fulfills: { id: string; voided: boolean } | null;
}

function postRecord(actor: Actor, body: object, pet = petId) {
  return request(app)
    .post(`${api}/${pet}/records`)
    .set(as(actor))
    .set('Idempotency-Key', key())
    .send(body);
}

async function record(
  actor: Actor,
  description: string,
  recordDate: string,
  nextDueDate?: string,
  extra: object = {},
) {
  const response = await postRecord(actor, {
    type: 'VACCINE',
    recordDate,
    description: `${RUN} ${description}`,
    ...(nextDueDate ? { nextDueDate } : {}),
    ...extra,
  });
  expect(response.status).toBe(201);
  return response.body.record as RecordDto;
}

const correct = (
  actor: Actor,
  recordId: string,
  nextDueDate: string,
  expectedNextDueDate: string | null,
  pet = petId,
) =>
  request(app)
    .patch(`${api}/${pet}/records/${recordId}/next-due`)
    .set(as(actor))
    .send({ nextDueDate, expectedNextDueDate });

const voidRecord = (actor: Actor, recordId: string) =>
  request(app).post(`${api}/${petId}/records/${recordId}/void`).set(as(actor)).send({});

const stored = (recordId: string) =>
  prisma.animalMedicalRecord.findUniqueOrThrow({ where: { id: recordId } });

const audits = (recordId: string, action: string) =>
  prisma.auditLog.findMany({
    where: { entityId: recordId, action },
    orderBy: { createdAt: 'asc' },
  });

const dueIds = async (actor: Actor, status?: string) => {
  const response = await request(app)
    .get(`${api}/due`)
    .set(as(actor))
    .query({ petId, pageSize: '50', ...(status ? { status } : {}) });
  expect(response.status).toBe(200);
  return (response.body.items as { record: { id: string } }[]).map((item) => item.record.id);
};

beforeAll(async () => {
  app = createApp();
  admin = await createActor('ADMIN', 'admin');
  employeeA = await createActor('EMPLOYEE', 'emp-a', await createEmployee('emp-a'));
  employeeB = await createActor('EMPLOYEE', 'emp-b', await createEmployee('emp-b'));
  typeId = (await prisma.animalType.create({ data: { name: `${RUN}-tipo` }, select: { id: true } }))
    .id;
  const pet = async (suffix: string) =>
    (
      await prisma.animal.create({
        data: { name: `${RUN}-${suffix}`, animalTypeId: typeId },
        select: { id: true },
      })
    ).id;
  petId = await pet('mascota');
  otherPetId = await pet('otra');
}, 60_000);

afterAll(async () => {
  const petIds = [petId, otherPetId].filter(Boolean);
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
        { entityId: { in: [...recordIds, ...petIds, typeId].filter(Boolean) } },
      ],
    },
  });
  // Primero los que cumplen (FK RESTRICT hacia el pendiente), después el resto.
  await prisma.animalMedicalRecord.deleteMany({
    where: { id: { in: recordIds }, fulfillsRecordId: { not: null } },
  });
  await prisma.animalMedicalRecord.deleteMany({ where: { id: { in: recordIds } } });
  await prisma.animal.deleteMany({ where: { id: { in: petIds } } });
  if (typeId) await prisma.animalType.deleteMany({ where: { id: typeId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });

  // Sin residuos: ninguno de los ids creados ni nada con el prefijo de la corrida.
  expect(await prisma.animalMedicalRecord.count({ where: { id: { in: recordIds } } })).toBe(0);
  expect(await prisma.animal.count({ where: { name: { startsWith: RUN } } })).toBe(0);
  expect(await prisma.animalType.count({ where: { name: { startsWith: RUN } } })).toBe(0);
  expect(await prisma.user.count({ where: { username: { startsWith: RUN } } })).toBe(0);
  expect(await prisma.employee.count({ where: { code: { startsWith: RUN } } })).toBe(0);
  expect(await prisma.auditLog.count({ where: { entityId: { in: recordIds } } })).toBe(0);
  expect(await prisma.idempotencyRecord.count({ where: { actorUserId: { in: userIds } } })).toBe(0);
}, 60_000);

describe('sin sesión', () => {
  it('no corrige ni anula (401) y el registro queda igual', async () => {
    const target = await record(admin, 'sin-sesion', day(-10), day(10));
    const path = `${api}/${petId}/records/${target.id}`;
    const body = { nextDueDate: day(11), expectedNextDueDate: day(10) };
    expect((await request(app).patch(`${path}/next-due`).send(body)).status).toBe(401);
    expect((await request(app).post(`${path}/void`).send({})).status).toBe(401);
    expect(
      (
        await request(app)
          .patch(`${path}/next-due`)
          .set('Authorization', 'Bearer token-invalido')
          .send(body)
      ).status,
    ).toBe(401);
    const row = await stored(target.id);
    expect(row.nextDueDate).toEqual(dbDate(day(10)));
    expect(row.voidedAt).toBeNull();
    expect(await audits(target.id, 'pet.record_next_due_updated')).toHaveLength(0);
    expect(await audits(target.id, 'pet.record_voided')).toHaveLength(0);
  });
});

describe('corregir la próxima fecha (ADMIN y EMPLOYEE)', () => {
  it(
    'EMPLOYEE corrige la fecha de un registro cargado por un ADMIN: conserva el autor y audita quién la cambió',
    async () => {
      const target = await record(admin, 'de-admin', day(-30), day(5));
      const before = await stored(target.id);
      const response = await correct(employeeA, target.id, day(12), day(5));
      expect(response.status).toBe(200);
      expect(response.body.changed).toBe(true);
      expect(response.body.record.nextDue).toMatchObject({ date: day(12), status: 'UPCOMING' });
      expect(response.body.record.employee).toBeNull();

      const after = await stored(target.id);
      expect(after.nextDueDate).toEqual(dbDate(day(12)));
      // Todo lo demás del registro queda igual: autor, persona, atención, texto, vínculos.
      expect({ ...after, nextDueDate: null, updatedAt: null }).toEqual({
        ...before,
        nextDueDate: null,
        updatedAt: null,
      });
      expect(after.recordedByUserId).toBe(admin.userId);
      expect(after.employeeId).toBeNull();

      const [audit, ...rest] = await audits(target.id, 'pet.record_next_due_updated');
      expect(rest).toHaveLength(0);
      expect(audit).toMatchObject({
        actorUserId: employeeA.userId,
        entityType: 'AnimalMedicalRecord',
        previousState: { nextDueDate: day(5) },
        newState: { nextDueDate: day(12) },
      });
      // Próximas atenciones / Vencimientos ya muestran la fecha nueva.
      const due = await request(app).get(`${api}/due`).set(as(employeeB)).query({ petId });
      const item = (due.body.items as { record: { id: string }; nextDue: { date: string } }[]).find(
        (entry) => entry.record.id === target.id,
      );
      expect(item?.nextDue.date).toBe(day(12));
    },
    SLOW,
  );

  it('EMPLOYEE corrige la de otro EMPLOYEE y ADMIN la de un EMPLOYEE (persona y autor intactos)', async () => {
    const target = await record(employeeA, 'de-emp-a', day(-30), day(5));
    expect((await correct(employeeB, target.id, day(6), day(5))).status).toBe(200);
    expect((await correct(admin, target.id, day(7), day(6))).status).toBe(200);
    const row = await stored(target.id);
    expect(row.nextDueDate).toEqual(dbDate(day(7)));
    expect(row.recordedByUserId).toBe(employeeA.userId);
    expect(row.employeeId).toBe(employeeIds[0]);
    const trail = await audits(target.id, 'pet.record_next_due_updated');
    expect(trail.map((entry) => [entry.actorUserId, entry.previousState, entry.newState])).toEqual([
      [employeeB.userId, { nextDueDate: day(5) }, { nextDueDate: day(6) }],
      [admin.userId, { nextDueDate: day(6) }, { nextDueDate: day(7) }],
    ]);
  });

  it('completa la fecha de un registro que no la tenía (lo que vio la pantalla: sin fecha)', async () => {
    const target = await record(admin, 'completar', day(-20));
    expect(target.nextDue).toBeNull();
    const response = await correct(employeeB, target.id, day(3), null);
    expect(response.status).toBe(200);
    expect(response.body.record.nextDue).toMatchObject({ date: day(3), status: 'UPCOMING' });
    expect(await dueIds(employeeA)).toContain(target.id);
  });

  it('guardar la misma fecha no escribe ni audita', async () => {
    const target = await record(employeeA, 'sin-cambios', day(-30), day(9));
    const before = await stored(target.id);
    const response = await correct(employeeB, target.id, day(9), day(9));
    expect(response.status).toBe(200);
    expect(response.body.changed).toBe(false);
    expect(response.body.record.nextDue.date).toBe(day(9));
    const after = await stored(target.id);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await audits(target.id, 'pet.record_next_due_updated')).toHaveLength(0);
  });

  it(
    'validaciones: posterior a la atención, sin Peso, anulados ni cumplidos, solo la fecha',
    async () => {
      const target = await record(employeeA, 'validar', day(-30), day(9));
      for (const invalid of [day(-30), day(-31)]) {
        const response = await correct(employeeB, target.id, invalid, day(9));
        expect(response.status).toBe(400);
      }
      // Solo la fecha: ni la fecha original, ni descripción, ni peso, ni tipo, ni autor.
      for (const extra of [
        { recordDate: day(-29) },
        { description: 'otra' },
        { weightKg: '1' },
        { type: 'DEWORMING' },
        { recordedByUserId: employeeB.userId },
      ]) {
        const response = await request(app)
          .patch(`${api}/${petId}/records/${target.id}/next-due`)
          .set(as(employeeB))
          .send({ nextDueDate: day(10), expectedNextDueDate: day(9), ...extra });
        expect(response.status).toBe(400);
      }
      // Un cliente que no manda la fecha que vio no puede pisar otra corrección.
      const missing = await request(app)
        .patch(`${api}/${petId}/records/${target.id}/next-due`)
        .set(as(employeeB))
        .send({ nextDueDate: day(10) });
      expect(missing.status).toBe(400);
      // De otra mascota → 404.
      expect((await correct(employeeB, target.id, day(10), day(9), otherPetId)).status).toBe(404);
      expect(await audits(target.id, 'pet.record_next_due_updated')).toHaveLength(0);
      expect((await stored(target.id)).nextDueDate).toEqual(dbDate(day(9)));

      const weight = await record(employeeA, 'peso', day(-3), undefined, {
        type: 'WEIGHT',
        weightKg: '10.5',
      });
      expect((await correct(employeeB, weight.id, day(3), null)).status).toBe(400);

      const voided = await record(admin, 'anulado', day(-30), day(4));
      expect((await voidRecord(admin, voided.id)).status).toBe(200);
      const onVoided = await correct(employeeA, voided.id, day(6), day(4));
      expect(onVoided.status).toBe(409);
      expect(onVoided.body.error.code).toBe('PET_RECORD_ALREADY_VOIDED');

      const fulfilled = await record(admin, 'cumplida', day(-30), day(-1));
      const application = await postRecord(employeeA, {
        type: 'VACCINE',
        recordDate: day(0),
        description: `${RUN} aplicacion`,
        fulfillsRecordId: fulfilled.id,
      });
      expect(application.status).toBe(201);
      const onFulfilled = await correct(employeeB, fulfilled.id, day(3), day(-1));
      expect(onFulfilled.status).toBe(409);
      expect(onFulfilled.body.error.code).toBe('PET_DUE_ALREADY_FULFILLED');
      expect(await audits(fulfilled.id, 'pet.record_next_due_updated')).toHaveLength(0);
    },
    SLOW,
  );

  it('dos correcciones simultáneas de la misma fecha: una gana y la otra recibe 409 sin pisarla', async () => {
    const target = await record(admin, 'carrera', day(-30), day(10));
    const results = await Promise.all([
      correct(employeeA, target.id, day(11), day(10)),
      correct(employeeB, target.id, day(12), day(10)),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const winner = results.find((result) => result.status === 200)!;
    const loser = results.find((result) => result.status === 409)!;
    expect(loser.body.error.code).toBe('PET_NEXT_DUE_CHANGED');
    const kept = winner.body.record.nextDue.date as string;
    expect((await stored(target.id)).nextDueDate).toEqual(dbDate(kept));
    const trail = await audits(target.id, 'pet.record_next_due_updated');
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      previousState: { nextDueDate: day(10) },
      newState: { nextDueDate: kept },
    });
    // Una pantalla que todavía muestra la fecha anterior tampoco la pisa.
    const stale = await correct(admin, target.id, day(20), day(10));
    expect(stale.status).toBe(409);
    expect((await stored(target.id)).nextDueDate).toEqual(dbDate(kept));
  });

  it('corregir mientras otra persona registra la aplicación: nunca queda corregida una atención ya cumplida', async () => {
    const target = await record(admin, 'carrera-cumplir', day(-30), day(2));
    const [edit, fulfill] = await Promise.all([
      correct(employeeA, target.id, day(4), day(2)),
      postRecord(employeeB, {
        type: 'VACCINE',
        recordDate: day(0),
        description: `${RUN} aplicacion carrera`,
        fulfillsRecordId: target.id,
      }),
    ]);
    expect(fulfill.status).toBe(201);
    const trail = await audits(target.id, 'pet.record_next_due_updated');
    if (edit.status === 200) {
      // La corrección llegó antes: la aplicación cumplió la fecha ya corregida.
      expect(trail).toHaveLength(1);
      expect((await stored(target.id)).nextDueDate).toEqual(dbDate(day(4)));
    } else {
      expect(edit.status).toBe(409);
      expect(edit.body.error.code).toBe('PET_DUE_ALREADY_FULFILLED');
      expect(trail).toHaveLength(0);
      expect((await stored(target.id)).nextDueDate).toEqual(dbDate(day(2)));
    }
    // Ya cumplida, nadie la corrige.
    const current = (await stored(target.id)).nextDueDate!.toISOString().slice(0, 10);
    const after = await correct(admin, target.id, day(30), current);
    expect(after.status).toBe(409);
    expect(after.body.error.code).toBe('PET_DUE_ALREADY_FULFILLED');
  });
});

describe('anular (ADMIN y EMPLOYEE)', () => {
  it(
    'EMPLOYEE anula un registro cargado por un ADMIN: lógico, con quién y cuándo, conservando el autor',
    async () => {
      const target = await record(admin, 'anular-de-admin', day(-5), day(20));
      const kpis = async () =>
        (await request(app).get(`${api}/${petId}`).set(as(employeeA))).body.kpis.vaccines as number;
      const vaccinesBefore = await kpis();
      const before = await stored(target.id);

      const response = await voidRecord(employeeA, target.id);
      expect(response.status).toBe(200);
      const after = await stored(target.id);
      expect(after.voidedAt).not.toBeNull();
      expect(after.voidedAt?.toISOString()).toBe(response.body.record.voidedAt);
      expect(after.voidedByUserId).toBe(employeeA.userId);
      // Nunca DELETE: la fila sigue con su autor, persona, fechas y texto.
      expect({ ...after, voidedAt: null, voidedByUserId: null, updatedAt: null }).toEqual({
        ...before,
        updatedAt: null,
      });
      const [audit, ...rest] = await audits(target.id, 'pet.record_voided');
      expect(rest).toHaveLength(0);
      expect(audit).toMatchObject({
        actorUserId: employeeA.userId,
        newState: { voided: true },
        previousState: { voided: false, nextDueDate: day(20) },
      });
      // Deja de contar en la ficha, el historial y los pendientes.
      expect(await kpis()).toBe(vaccinesBefore - 1);
      const history = await request(app).get(`${api}/${petId}/records`).set(as(employeeB));
      expect((history.body.records as RecordDto[]).map((row) => row.id)).not.toContain(target.id);
      expect(await dueIds(employeeB)).not.toContain(target.id);
    },
    SLOW,
  );

  it(
    'anular la aplicación que cumplía otra atención la vuelve a dejar pendiente; el vínculo se conserva',
    async () => {
      const original = await record(admin, 'original', day(-60), day(-3));
      const application = await postRecord(employeeA, {
        type: 'VACCINE',
        recordDate: day(0),
        description: `${RUN} aplicacion a anular`,
        fulfillsRecordId: original.id,
      });
      expect(application.status).toBe(201);
      const applicationId = (application.body.record as RecordDto).id;
      const history = await request(app).get(`${api}/${petId}/records`).set(as(employeeB));
      const listed = (history.body.records as RecordDto[]).find((row) => row.id === applicationId);
      expect(listed?.fulfills).toMatchObject({ id: original.id, voided: false });
      expect(await dueIds(employeeB, 'OVERDUE')).not.toContain(original.id);

      expect((await voidRecord(employeeB, applicationId)).status).toBe(200);
      expect(await dueIds(employeeB, 'OVERDUE')).toContain(original.id);
      const row = await stored(applicationId);
      expect(row).toMatchObject({
        fulfillsRecordId: original.id,
        recordedByUserId: employeeA.userId,
        voidedByUserId: employeeB.userId,
      });
      // El pendiente reabierto se puede volver a cumplir.
      const again = await postRecord(admin, {
        type: 'VACCINE',
        recordDate: day(0),
        fulfillsRecordId: original.id,
      });
      expect(again.status).toBe(201);
    },
    SLOW,
  );

  it('doble clic y dos personas a la vez: una sola anulación y una sola auditoría', async () => {
    const target = await record(employeeA, 'doble', day(-5));
    const results = await Promise.all([
      voidRecord(employeeA, target.id),
      voidRecord(employeeA, target.id),
      voidRecord(admin, target.id),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409, 409]);
    for (const result of results.filter((entry) => entry.status === 409)) {
      expect(result.body.error.code).toBe('PET_RECORD_ALREADY_VOIDED');
    }
    expect(await audits(target.id, 'pet.record_voided')).toHaveLength(1);
    const again = await voidRecord(employeeB, target.id);
    expect(again.status).toBe(409);
    expect(await audits(target.id, 'pet.record_voided')).toHaveLength(1);
    expect([employeeA.userId, admin.userId]).toContain((await stored(target.id)).voidedByUserId);
  });
});

describe('los demás permisos de Mascotas siguen siendo de ADMIN', () => {
  it(
    'EMPLOYEE no administra mascotas, tipos ni fotos (403) y nada cambia',
    async () => {
      const icon = PET_TYPE_ICON_OPTIONS[0]!.icon;
      const attempts: (() => request.Test)[] = [
        () =>
          request(app)
            .post(api)
            .send({ name: `${RUN}-nueva`, animalTypeId: typeId }),
        () =>
          request(app)
            .patch(`${api}/${petId}`)
            .send({ name: `${RUN}-renombrada` }),
        () => request(app).patch(`${api}/${petId}/status`).send({ active: false }),
        () => request(app).delete(`${api}/${otherPetId}`),
        () => request(app).get(api).query({ status: 'inactive' }),
        () => request(app).post(`${api}/types`).send({ name: 'Tipo sintético', icon }),
        () => request(app).patch(`${api}/types/${typeId}/status`).send({ active: false }),
        () => request(app).delete(`${api}/types/${typeId}`),
        () => request(app).get(`${api}/types`).query({ status: 'all' }),
        () => request(app).post(`${api}/${petId}/photo/remove`).send({}),
        () =>
          request(app)
            .post(`${api}/${petId}/photo`)
            .set('Content-Type', 'image/jpeg')
            .send(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])),
      ];
      for (const attempt of attempts) {
        const response = await attempt().set(as(employeeB));
        expect(response.status).toBe(403);
      }
      const pet = await prisma.animal.findUniqueOrThrow({ where: { id: petId } });
      expect(pet).toMatchObject({ name: `${RUN}-mascota`, active: true });
      expect(await prisma.animal.count({ where: { id: otherPetId } })).toBe(1);
      expect(await prisma.animalType.findUniqueOrThrow({ where: { id: typeId } })).toMatchObject({
        active: true,
      });
      expect(await prisma.animal.count({ where: { name: `${RUN}-nueva` } })).toBe(0);
    },
    SLOW,
  );
});
