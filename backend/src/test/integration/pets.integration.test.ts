import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import pg from 'pg';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import { addDays, formatLocalDate, toLocalDate } from '../../lib/businessTime';
import { setObjectStorageForTests, type ObjectStorageClient } from '../../lib/objectStorage';

/**
 * 🐾 Mascotas (Etapa 5M) contra Neon real (`demo`) por HTTP real. Reglas:
 *  - todo lo creado es sintético y lleva `test-5m-<RUN>` (usuarios,
 *    empleados, un tipo propio y sus mascotas); los 9 tipos reales solo se
 *    leen (el intento de dar de baja uno precargado debe fallar sin tocarlo);
 *  - no hay credenciales de Object Storage en local: el test inyecta un
 *    almacenamiento EN MEMORIA (nunca un bucket real) para probar el flujo
 *    completo de `FileAsset` contra Postgres real;
 *  - `afterAll` borra solo lo creado (por id) y verifica 0 residuos y
 *    conteos globales idénticos a los iniciales.
 */

const RUN = `test-5m-${Date.now()}`;
const TZ = config.businessTimeZone;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(RUN)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(RUN),
]);

interface Actor {
  userId: string;
  token: string;
}

let app: Express;
let admin: Actor;
let employee: Actor;
let employeeId = '';
let typeId = '';
let perroId = '';
const userIds: string[] = [];
const employeeIds: string[] = [];
let baseline: Record<string, number>;

const objects = new Map<string, Buffer>();
const memoryStorage: ObjectStorageClient = {
  bucket: 'memoria-test',
  async putObject(key, body) {
    objects.set(key, body);
    return { etag: '"memoria"' };
  },
  async getObject(key) {
    const body = objects.get(key);
    return body ? { body, contentType: null, etag: null } : null;
  },
  async deleteObject(key) {
    objects.delete(key);
  },
};

type QueryFn = (...args: unknown[]) => unknown;
const originalQuery = pg.Client.prototype.query as unknown as QueryFn;
const statements: string[] = [];
let counting = false;

async function countStatements<T>(run: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
  statements.length = 0;
  counting = true;
  try {
    const result = await run();
    return { result, sql: statements.filter((s) => !/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) };
  } finally {
    counting = false;
  }
}

async function globalCounts() {
  return {
    types: await prisma.animalType.count(),
    animals: await prisma.animal.count(),
    records: await prisma.animalMedicalRecord.count(),
    files: await prisma.fileAsset.count(),
    idempotency: await prisma.idempotencyRecord.count(),
    audits: await prisma.auditLog.count(),
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
const today = () => toLocalDate(new Date(), TZ);
const key = () => crypto.randomUUID().replace(/-/g, '');
const api = '/api/v1/pets';

async function createPetAs(actor: Actor, body: object) {
  return request(app).post(api).set(as(actor)).send(body);
}
const postRecord = (actor: Actor, petId: string, body: object, idempotencyKey?: string) => {
  const call = request(app).post(`${api}/${petId}/records`).set(as(actor));
  return (idempotencyKey ? call.set('Idempotency-Key', idempotencyKey) : call).send(body);
};
const uploadPhoto = (actor: Actor, petId: string, body: Buffer, type: string) =>
  request(app)
    .post(`${api}/${petId}/photo`)
    .set(as(actor))
    .set('Content-Type', type)
    .set('X-File-Name', 'foto-sintetica.jpg')
    .send(body);

beforeAll(async () => {
  baseline = await globalCounts();
  app = createApp();
  const emp = await prisma.employee.create({
    data: {
      code: `${RUN}-emp`,
      displayName: `Sintético ${RUN}`,
      role: 'Test',
      colorHex: '#4a7c59',
    },
    select: { id: true },
  });
  employeeId = emp.id;
  employeeIds.push(emp.id);
  admin = await createActor('ADMIN', 'admin');
  employee = await createActor('EMPLOYEE', 'emp', employeeId);
  perroId = (await prisma.animalType.findUniqueOrThrow({ where: { name: 'Perro' } })).id;
  setObjectStorageForTests(memoryStorage);

  (pg.Client.prototype as unknown as { query: QueryFn }).query = function (
    this: unknown,
    ...args: unknown[]
  ) {
    if (counting) {
      const text =
        typeof args[0] === 'string' ? args[0] : ((args[0] as { text?: string })?.text ?? '');
      statements.push(text.trim().split(/\s+/)[0]?.toUpperCase() ?? '?');
    }
    return originalQuery.apply(this, args);
  };
}, 60_000);

afterAll(async () => {
  (pg.Client.prototype as unknown as { query: QueryFn }).query = originalQuery;
  setObjectStorageForTests(undefined);
  const animalIds = (
    await prisma.animal.findMany({ where: { name: { startsWith: RUN } }, select: { id: true } })
  ).map((row) => row.id);
  const recordIds = (
    await prisma.animalMedicalRecord.findMany({
      where: { animalId: { in: animalIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  const typeIds = (
    await prisma.animalType.findMany({
      where: { name: { startsWith: 'Test5m' } },
      select: { id: true },
    })
  ).map((row) => row.id);
  await prisma.idempotencyRecord.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { entityId: { in: [...animalIds, ...recordIds, ...typeIds] } },
      ],
    },
  });
  await prisma.fileAsset.deleteMany({ where: { animalId: { in: animalIds } } });
  await prisma.animalMedicalRecord.deleteMany({ where: { id: { in: recordIds } } });
  await prisma.animal.deleteMany({ where: { id: { in: animalIds } } });
  await prisma.animalType.deleteMany({ where: { id: { in: typeIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });

  expect(await globalCounts()).toEqual(baseline);
  expect(await prisma.animal.count({ where: { name: { startsWith: 'test-5m-' } } })).toBe(0);
  expect(await prisma.animalType.count({ where: { name: { startsWith: 'Test5m' } } })).toBe(0);
  expect(await prisma.user.count({ where: { username: { startsWith: 'test-5m-' } } })).toBe(0);
  expect(await prisma.employee.count({ where: { code: { startsWith: 'test-5m-' } } })).toBe(0);
  const perro = await prisma.animalType.findUniqueOrThrow({ where: { name: 'Perro' } });
  expect(perro.active).toBe(true);
}, 60_000);

describe('tipos de mascota', () => {
  it('lista los 9 tipos reales con su emoji y marca los precargados', async () => {
    const response = await request(app).get(`${api}/types`).set(as(employee));
    expect(response.status).toBe(200);
    const builtin = response.body.types.filter((type: { builtin: boolean }) => type.builtin);
    expect(builtin.map((type: { name: string }) => type.name).sort()).toEqual(
      [
        'Burro',
        'Caballo',
        'Faisán',
        'Gallina',
        'Gato',
        'Guinea',
        'Pato',
        'Pavo real',
        'Perro',
      ].sort(),
    );
    expect(builtin.find((type: { name: string }) => type.name === 'Perro').icon).toBe('🐕');
    expect(response.body.iconOptions).toHaveLength(25);
  });

  it('solo ADMIN agrega/da de baja; duplicado sin distinguir mayúsculas; baja lógica y reactivación', async () => {
    const body = { name: `test5m ${Date.now() % 1_000_000}`, icon: '🐂' };
    expect((await request(app).post(`${api}/types`).set(as(employee)).send(body)).status).toBe(403);
    const created = await request(app).post(`${api}/types`).set(as(admin)).send(body);
    expect(created.status).toBe(201);
    expect(created.body.type.name).toMatch(/^Test5m /);
    typeId = created.body.type.id;
    const dup = await request(app)
      .post(`${api}/types`)
      .set(as(admin))
      .send({ ...body, name: body.name.toUpperCase() });
    expect(dup.status).toBe(409);

    const off = await request(app)
      .patch(`${api}/types/${typeId}/status`)
      .set(as(admin))
      .send({ active: false });
    expect(off.status).toBe(200);
    expect((await prisma.animalType.findUniqueOrThrow({ where: { id: typeId } })).active).toBe(
      false,
    );
    const again = await request(app)
      .post(`${api}/types`)
      .set(as(admin))
      .send({ ...body, icon: '🐃' });
    expect(again.status).toBe(201);
    expect(again.body.type).toMatchObject({ id: typeId, icon: '🐃', active: true });

    const builtin = await request(app)
      .patch(`${api}/types/${perroId}/status`)
      .set(as(admin))
      .send({ active: false });
    expect(builtin.status).toBe(409);
    expect(builtin.body.error.code).toBe('PET_TYPE_BUILTIN');
  });
});

describe('mascotas y registros clínicos', () => {
  let petId = '';

  it('solo ADMIN crea la ficha; sin nacimiento futuro; el listado paginado tiene sentencias fijas', async () => {
    expect((await createPetAs(employee, { name: `${RUN}-x`, animalTypeId: typeId })).status).toBe(
      403,
    );
    const future = await createPetAs(admin, {
      name: `${RUN}-futuro`,
      animalTypeId: typeId,
      birthDate: formatLocalDate(addDays(today(), 1)),
    });
    expect(future.status).toBe(400);

    const birth = formatLocalDate(addDays(today(), -400));
    const created = await createPetAs(admin, {
      name: `${RUN}-A`,
      animalTypeId: typeId,
      breed: 'Raza sintética',
      birthDate: birth,
    });
    expect(created.status).toBe(201);
    petId = created.body.pet.id;
    expect(created.body.pet).toMatchObject({
      breed: 'Raza sintética',
      birthDate: birth,
      photo: null,
    });
    expect(created.body.pet.age.years).toBe(1);
    expect(created.body.kpis).toEqual({
      vaccines: 0,
      dewormings: 0,
      lastWeight: null,
      daysToBirthday: expect.any(Number),
    });

    const one = await countStatements(() =>
      request(app).get(`${api}?typeId=${typeId}`).set(as(employee)),
    );
    await createPetAs(admin, { name: `${RUN}-B`, animalTypeId: typeId });
    await createPetAs(admin, { name: `${RUN}-C`, animalTypeId: typeId });
    const three = await countStatements(() =>
      request(app).get(`${api}?typeId=${typeId}`).set(as(employee)),
    );
    expect(three.result.body.pets.map((pet: { name: string }) => pet.name)).toEqual([
      `${RUN}-A`,
      `${RUN}-B`,
      `${RUN}-C`,
    ]);
    expect(three.sql.length).toBe(one.sql.length); // sin N+1
    const types = await request(app).get(`${api}/types`).set(as(employee));
    expect(
      types.body.types.find((type: { id: string }) => type.id === typeId).activeAnimalCount,
    ).toBe(3);
  });

  it('EMPLOYEE registra con su persona; peso obligatorio en ⚖️ Peso; sin fechas futuras', async () => {
    const vaccine = await postRecord(employee, petId, {
      type: 'VACCINE',
      recordDate: formatLocalDate(today()),
      description: 'Vacuna sintética',
    });
    expect(vaccine.status).toBe(201);
    expect(vaccine.body.record.employee.id).toBe(employeeId);
    const row = await prisma.animalMedicalRecord.findUniqueOrThrow({
      where: { id: vaccine.body.record.id },
    });
    expect(row.recordedByUserId).toBe(employee.userId);

    expect(
      (await postRecord(employee, petId, { type: 'WEIGHT', recordDate: formatLocalDate(today()) }))
        .status,
    ).toBe(400);
    expect(
      (
        await postRecord(employee, petId, {
          type: 'CHECKUP',
          recordDate: formatLocalDate(addDays(today(), 1)),
        })
      ).status,
    ).toBe(400);
    await postRecord(admin, petId, {
      type: 'WEIGHT',
      recordDate: formatLocalDate(addDays(today(), -10)),
      weightKg: '11.2',
    });
    await postRecord(admin, petId, {
      type: 'WEIGHT',
      recordDate: formatLocalDate(addDays(today(), -2)),
      weightKg: '12.5',
    });
    await postRecord(employee, petId, { type: 'DEWORMING', recordDate: formatLocalDate(today()) });

    const detail = await request(app).get(`${api}/${petId}`).set(as(employee));
    expect(detail.body.kpis).toMatchObject({
      vaccines: 1,
      dewormings: 1,
      lastWeight: { kg: '12.5', date: formatLocalDate(addDays(today(), -2)) },
    });
    const list = await request(app).get(`${api}?typeId=${typeId}`).set(as(employee));
    expect(list.body.pets[0].lastWeight.kg).toBe('12.5');
  });

  it('el CHECK de Postgres impide un peso sin valor (o un valor en otro tipo) por cualquier vía', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "animal_medical_records" ("id","animal_id","type","record_date","updated_at") VALUES (gen_random_uuid(), ${petId}::uuid, 'WEIGHT', '2001-01-01', now())`;
      }),
    ).rejects.toThrow(/animal_medical_records_weight_value_check/);
  });

  it('Idempotency-Key: doble envío simultáneo crea UN registro; replay 201 idéntico', async () => {
    const idempotencyKey = key();
    const body = {
      type: 'CLINICAL_EVENT',
      recordDate: '2001-02-03',
      description: 'Evento sintético',
    };
    const [first, second] = await Promise.all([
      postRecord(employee, petId, body, idempotencyKey),
      postRecord(employee, petId, body, idempotencyKey),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body.record.id).toBe(first.body.record.id);
    expect(
      await prisma.animalMedicalRecord.count({
        where: { animalId: petId, recordDate: new Date('2001-02-03T00:00:00Z') },
      }),
    ).toBe(1);
  });

  it('historial filtrable y paginado, más reciente primero; solo ADMIN anula y el registro se conserva', async () => {
    const weights = await request(app)
      .get(`${api}/${petId}/records?type=WEIGHT&pageSize=1`)
      .set(as(employee));
    expect(weights.body).toMatchObject({ total: 2, totalPages: 2 });
    expect(weights.body.records[0].weightKg).toBe('12.5');

    const all = await request(app).get(`${api}/${petId}/records`).set(as(employee));
    const target = all.body.records.find((record: { type: string }) => record.type === 'VACCINE');
    const path = `${api}/${petId}/records/${target.id}/void`;
    expect((await request(app).post(path).set(as(employee)).send({})).status).toBe(403);
    const [a, b] = await Promise.all([
      request(app).post(path).set(as(admin)).send({}),
      request(app).post(path).set(as(admin)).send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const row = await prisma.animalMedicalRecord.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.voidedAt).not.toBeNull();
    expect(row.voidedByUserId).toBe(admin.userId);
    const detail = await request(app).get(`${api}/${petId}`).set(as(employee));
    expect(detail.body.kpis.vaccines).toBe(0);
    const after = await request(app).get(`${api}/${petId}/records`).set(as(employee));
    expect(after.body.records.map((record: { id: string }) => record.id)).not.toContain(target.id);
  });

  it('foto: solo ADMIN; MIME real; reemplazo con baja lógica y física; proxy autenticado', async () => {
    expect((await uploadPhoto(employee, petId, JPEG, 'image/jpeg')).status).toBe(403);
    const mismatch = await uploadPhoto(admin, petId, JPEG, 'image/png');
    expect(mismatch.status).toBe(415);
    const tooLarge = await uploadPhoto(
      admin,
      petId,
      Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]),
      'image/jpeg',
    );
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.code).toBe('PET_PHOTO_TOO_LARGE');

    const first = await uploadPhoto(admin, petId, JPEG, 'image/jpeg');
    expect(first.status).toBe(201);
    const firstId = first.body.photo.id as string;
    const firstRow = await prisma.fileAsset.findUniqueOrThrow({ where: { id: firstId } });
    expect(firstRow).toMatchObject({
      status: 'AVAILABLE',
      bucket: 'memoria-test',
      category: 'ANIMAL_PROFILE',
      animalId: petId,
      mimeType: 'image/jpeg',
      originalFilename: 'foto-sintetica.jpg',
    });
    expect(objects.has(firstRow.objectKey)).toBe(true);

    const served = await request(app).get(`${api}/photos/${firstId}`).set(as(employee));
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['cache-control']).toContain('private');
    expect(Buffer.compare(served.body as Buffer, JPEG)).toBe(0);

    const second = await uploadPhoto(admin, petId, PNG, 'image/png');
    expect(second.status).toBe(201);
    const old = await prisma.fileAsset.findUniqueOrThrow({ where: { id: firstId } });
    expect(old.status).toBe('DELETED');
    expect(old.deletedAt).not.toBeNull();
    expect(objects.has(old.objectKey)).toBe(false);
    expect((await request(app).get(`${api}/photos/${firstId}`).set(as(employee))).status).toBe(404);
    const detail = await request(app).get(`${api}/${petId}`).set(as(employee));
    expect(detail.body.pet.photo).toEqual({ id: second.body.photo.id });

    const removed = await request(app).post(`${api}/${petId}/photo/remove`).set(as(admin)).send({});
    expect(removed.status).toBe(200);
    expect((await request(app).get(`${api}/${petId}`).set(as(employee))).body.pet.photo).toBeNull();
    expect(await prisma.fileAsset.count({ where: { animalId: petId, status: 'AVAILABLE' } })).toBe(
      0,
    );
    expect(
      await prisma.auditLog.count({
        where: { entityId: petId, action: { in: ['pet.photo_updated', 'pet.photo_removed'] } },
      }),
    ).toBe(3);
  });

  it('sin OBJECT_STORAGE_* configurado: 503 claro para fotos y el resto del módulo sigue funcionando', async () => {
    setObjectStorageForTests(null);
    try {
      const upload = await uploadPhoto(admin, petId, JPEG, 'image/jpeg');
      expect(upload.status).toBe(503);
      expect(upload.body.error.code).toBe('OBJECT_STORAGE_NOT_CONFIGURED');
      const list = await request(app).get(`${api}?typeId=${typeId}`).set(as(employee));
      expect(list.status).toBe(200);
      expect(list.body.photoStorage).toBe('unconfigured');
    } finally {
      setObjectStorageForTests(memoryStorage);
    }
  });
});
