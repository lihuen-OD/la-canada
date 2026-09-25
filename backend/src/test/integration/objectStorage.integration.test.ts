import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { getObjectStorage, readObjectStorageConfig } from '../../lib/objectStorage';

/**
 * Object Storage REAL (bucket de la rama `demo`) — Etapa 5M. A diferencia de
 * `pets.integration.test.ts`, acá NO se inyecta el almacenamiento en memoria:
 * se usan las `OBJECT_STORAGE_*` del entorno. Nunca se imprime ningún valor
 * de configuración (ni endpoint, ni bucket, ni claves).
 *
 * Todo es sintético (`test-5m-os-<RUN>`): un tipo, una mascota, usuarios y
 * empleado. `afterAll` borra del bucket cada objeto creado (verificando que
 * ya no existe) y luego las filas, y compara conteos globales.
 */

const RUN = `test-5m-os-${Date.now()}`;
const api = '/api/v1/pets';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`jpeg ${RUN}`)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(`png ${RUN}`),
]);

interface Actor {
  userId: string;
  token: string;
}

let app: Express;
let admin: Actor;
let employee: Actor;
let petId = '';
let typeId = '';
const userIds: string[] = [];
const employeeIds: string[] = [];
let baseline: Record<string, number>;

const storage = () => {
  const client = getObjectStorage();
  if (!client) throw new Error('Object Storage no configurado');
  return client;
};

async function globalCounts() {
  return {
    types: await prisma.animalType.count(),
    animals: await prisma.animal.count(),
    files: await prisma.fileAsset.count(),
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
const upload = (actor: Actor, body: Buffer, type: string) =>
  request(app)
    .post(`${api}/${petId}/photo`)
    .set(as(actor))
    .set('Content-Type', type)
    .set('X-File-Name', 'foto-sintetica')
    .send(body);
const readPhoto = (actor: Actor, fileId: string) =>
  request(app)
    .get(`${api}/photos/${fileId}`)
    .set(as(actor))
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });

beforeAll(async () => {
  // Precondición sin revelar valores: las 5 variables presentes.
  expect(readObjectStorageConfig(), 'faltan variables OBJECT_STORAGE_*').not.toBeNull();
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
  employeeIds.push(emp.id);
  admin = await createActor('ADMIN', 'admin');
  employee = await createActor('EMPLOYEE', 'emp', emp.id);
  typeId = (
    await prisma.animalType.create({
      data: { name: `Test5mos ${Date.now() % 1_000_000}`, icon: '🐾' },
      select: { id: true },
    })
  ).id;
  petId = (
    await prisma.animal.create({
      data: { name: `${RUN}-mascota`, animalTypeId: typeId },
      select: { id: true },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  // 1) Bucket: borrar TODO objeto creado por esta corrida y verificar que no existe.
  const files = await prisma.fileAsset.findMany({
    where: { animalId: petId },
    select: { id: true, objectKey: true },
  });
  const client = getObjectStorage();
  if (client) {
    for (const file of files) {
      await client.deleteObject(file.objectKey);
      expect(await client.getObject(file.objectKey), 'objeto remanente en el bucket').toBeNull();
    }
  }
  // 2) Base: solo filas sintéticas, por id.
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: userIds } }, { entityId: { in: [petId, typeId] } }] },
  });
  await prisma.fileAsset.deleteMany({ where: { animalId: petId } });
  await prisma.animal.deleteMany({ where: { id: petId } });
  await prisma.animalType.deleteMany({ where: { id: typeId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });

  expect(await globalCounts()).toEqual(baseline);
  expect(await prisma.user.count({ where: { username: { startsWith: 'test-5m-os-' } } })).toBe(0);
  expect(await prisma.animal.count({ where: { name: { startsWith: 'test-5m-os-' } } })).toBe(0);
}, 120_000);

describe('Object Storage real (demo)', () => {
  let firstId = '';
  let firstKey = '';

  it('validación antes de tocar bucket o base: permiso, MIME real y tamaño', async () => {
    expect((await upload(employee, JPEG, 'image/jpeg')).status).toBe(403);
    expect((await upload(admin, JPEG, 'image/png')).status).toBe(415);
    expect((await upload(admin, Buffer.from('<svg/>'), 'image/png')).status).toBe(415);
    const tooLarge = await upload(
      admin,
      Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]),
      'image/jpeg',
    );
    expect(tooLarge.status).toBe(413);
    expect(await prisma.fileAsset.count({ where: { animalId: petId } })).toBe(0);
  });

  it('subida real: FileAsset AVAILABLE con ETag del proveedor y objeto presente en el bucket', async () => {
    const response = await upload(admin, JPEG, 'image/jpeg');
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    firstId = response.body.photo.id;
    const row = await prisma.fileAsset.findUniqueOrThrow({ where: { id: firstId } });
    firstKey = row.objectKey;
    expect(row).toMatchObject({
      status: 'AVAILABLE',
      provider: 'NEON_OBJECT_STORAGE',
      category: 'ANIMAL_PROFILE',
      mimeType: 'image/jpeg',
      sizeBytes: JPEG.length,
      originalFilename: 'foto-sintetica',
    });
    expect(row.bucket).toBe(storage().bucket);
    expect(row.objectKey).toMatch(new RegExp(`^animals/${petId}/[0-9a-f-]{36}\\.jpg$`));
    expect(row.etag).toBeTruthy();
    const stored = await storage().getObject(row.objectKey);
    expect(stored && Buffer.compare(stored.body, JPEG)).toBe(0);
  });

  it('lectura autenticada por proxy: bytes idénticos, headers seguros, ETag y 304', async () => {
    expect((await request(app).get(`${api}/photos/${firstId}`)).status).toBe(401);
    const served = await readPhoto(employee, firstId);
    expect(served.status).toBe(200);
    expect(Buffer.compare(served.body as Buffer, JPEG)).toBe(0);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['cache-control']).toBe('private, max-age=86400, immutable');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-security-policy']).toBe("default-src 'none'");
    const etag = served.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    // Ninguna respuesta expone la URL del bucket ni la clave del objeto.
    expect(JSON.stringify(served.headers)).not.toContain(firstKey);

    const revalidated = await request(app)
      .get(`${api}/photos/${firstId}`)
      .set(as(employee))
      .set('If-None-Match', etag);
    expect(revalidated.status).toBe(304);
  });

  it('reemplazo: la nueva queda AVAILABLE; la anterior DELETED y borrada del bucket', async () => {
    const response = await upload(admin, PNG, 'image/png');
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const secondId = response.body.photo.id as string;
    const old = await prisma.fileAsset.findUniqueOrThrow({ where: { id: firstId } });
    expect(old.status).toBe('DELETED');
    expect(old.deletedAt).not.toBeNull();
    expect(await storage().getObject(firstKey)).toBeNull();
    expect((await readPhoto(employee, firstId)).status).toBe(404);

    const served = await readPhoto(employee, secondId);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(served.body as Buffer, PNG)).toBe(0);
    const detail = await request(app).get(`${api}/${petId}`).set(as(employee));
    expect(detail.body.pet.photo).toEqual({ id: secondId });
    expect(detail.body.photoStorage).toBe('configured');
  });

  it('eliminación: baja lógica y física; ninguna foto vigente ni objeto en el bucket', async () => {
    expect(
      (await request(app).post(`${api}/${petId}/photo/remove`).set(as(employee)).send({})).status,
    ).toBe(403);
    const removed = await request(app).post(`${api}/${petId}/photo/remove`).set(as(admin)).send({});
    expect(removed.status).toBe(200);
    const files = await prisma.fileAsset.findMany({ where: { animalId: petId } });
    expect(files).toHaveLength(2);
    expect(files.every((file) => file.status === 'DELETED' && file.deletedAt)).toBe(true);
    for (const file of files) expect(await storage().getObject(file.objectKey)).toBeNull();
    const detail = await request(app).get(`${api}/${petId}`).set(as(employee));
    expect(detail.body.pet.photo).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { entityId: petId, action: { in: ['pet.photo_updated', 'pet.photo_removed'] } },
      }),
    ).toBe(3);
  });
});
