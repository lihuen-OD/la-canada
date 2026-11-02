import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import pg from 'pg';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { setDriveBackupConfigForTests } from '../../driveBackup/config';
import { setObjectStorageForTests, type ObjectStorageClient } from '../../lib/objectStorage';

/**
 * 📸 Carpetas de Fotos contra Neon real (`demo`) por HTTP real. Reglas:
 *  - todo lo creado es sintético y lleva `test-pf-<RUN>` (usuarios, personas,
 *    carpetas, títulos); ninguna foto ni carpeta real se mueve, renombra ni
 *    elimina (en `demo` no hay fotos reales de la galería: solo se leen
 *    conteos);
 *  - el almacenamiento es EN MEMORIA (nunca el bucket real) y la copia en
 *    Drive queda desactivada: ninguna llamada a Google;
 *  - `afterAll` borra solo lo creado (por id) y verifica conteos globales
 *    idénticos a los iniciales y ningún trabajo de Drive nuevo.
 */

const RUN = `test-pf-${Date.now()}`;
const NAME_TAG = RUN.replace(/\d/g, (digit) => 'abcdefghij'[Number(digit)] ?? 'x').replace(
  /-/g,
  ' ',
);
const jpeg = (seed: string) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${RUN}-${seed}`)]);

interface Actor {
  userId: string;
  token: string;
}

let app: Express;
let admin: Actor;
let creator: Actor;
let stranger: Actor;
const userIds: string[] = [];
const employeeIds: string[] = [];
const folderIds = new Set<string>();
const fileIds = new Set<string>();
let baseline: Record<string, number>;

const objects = new Map<string, Buffer>();
const storageCalls = { put: 0, delete: 0 };
let failNextPut = false;
const memoryStorage: ObjectStorageClient = {
  bucket: 'memoria-test',
  async putObject(key, body) {
    storageCalls.put += 1;
    if (failNextPut) {
      failNextPut = false;
      throw new Error('falla sintética del proveedor');
    }
    objects.set(key, body);
    return { etag: '"memoria"' };
  },
  async getObject(key) {
    const body = objects.get(key);
    return body ? { body, contentType: null, etag: null } : null;
  },
  async deleteObject(key) {
    storageCalls.delete += 1;
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

/**
 * Conteos globales que el uso real de `demo` no cambia durante una corrida.
 * Sesiones, auditorías e idempotencia sí cambian con cualquier inicio de
 * sesión real: para esas se verifica que no quede NADA de esta corrida.
 */
async function globalCounts() {
  return {
    files: await prisma.fileAsset.count(),
    folders: await prisma.photoFolder.count(),
    driveJobs: await prisma.driveBackupJob.count(),
    users: await prisma.user.count(),
    employees: await prisma.employee.count(),
  };
}

async function createActor(role: 'ADMIN' | 'EMPLOYEE', suffix: string): Promise<Actor> {
  let employeeId: string | undefined;
  if (role === 'EMPLOYEE') {
    const employee = await prisma.employee.create({
      data: {
        code: `${RUN}-${suffix}`,
        displayName: `Sintético ${suffix} ${NAME_TAG}`,
        role: 'Otro',
        colorHex: '#4a7c59',
      },
      select: { id: true },
    });
    employeeIds.push(employee.id);
    employeeId = employee.id;
  }
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
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function createFolder(actor: Actor, name: string, idem = key()) {
  const response = await request(app)
    .post('/api/v1/photos/folders')
    .set(as(actor))
    .set('Idempotency-Key', idem)
    .send({ name });
  if (response.body.folder?.id) folderIds.add(response.body.folder.id);
  return response;
}

/** Subida de la app actual: sin categoría (la elige el backend) y con carpeta. */
async function upload(actor: Actor, title: string, folderId?: string) {
  const params = new URLSearchParams({ title: `${RUN} ${title}` });
  if (folderId) params.set('folderId', folderId);
  const response = await request(app)
    .post(`/api/v1/photos?${params.toString()}`)
    .set(as(actor))
    .set('Content-Type', 'image/jpeg')
    .set('X-File-Name', 'foto.jpg')
    .set('Idempotency-Key', key())
    .send(jpeg(title));
  if (response.body.photo?.id) fileIds.add(response.body.photo.id);
  return response;
}

/**
 * Foto ANTERIOR a las carpetas (sintética): confirmada y sin carpeta, como
 * las que ya existían. Se inserta directo porque la API ya no las crea.
 */
async function legacyPhoto(title: string): Promise<string> {
  const objectKey = `memories/2026/${crypto.randomUUID()}.jpg`;
  const body = jpeg(title);
  objects.set(objectKey, body);
  const row = await prisma.fileAsset.create({
    data: {
      provider: 'NEON_OBJECT_STORAGE',
      bucket: memoryStorage.bucket,
      objectKey,
      originalFilename: 'anterior.jpg',
      title: `${RUN} ${title}`,
      mimeType: 'image/jpeg',
      sizeBytes: body.length,
      category: 'MEMORY',
      status: 'AVAILABLE',
    },
    select: { id: true },
  });
  fileIds.add(row.id);
  return row.id;
}

const move = (
  actor: Actor,
  photoId: string,
  folderId: string | null,
  fromFolderId: string | null,
) =>
  request(app)
    .post(`/api/v1/photos/${photoId}/move`)
    .set(as(actor))
    .send({ folderId, fromFolderId });
const rename = (actor: Actor, folderId: string, name: string, version: number) =>
  request(app).patch(`/api/v1/photos/folders/${folderId}`).set(as(actor)).send({ name, version });
const remove = (actor: Actor, folderId: string, version: number) =>
  request(app).post(`/api/v1/photos/folders/${folderId}/delete`).set(as(actor)).send({ version });
const listFolders = (actor: Actor) => request(app).get('/api/v1/photos/folders').set(as(actor));
const gallery = (actor: Actor, query: string) =>
  request(app).get(`/api/v1/photos?${query}`).set(as(actor));
const auditCount = (entityId: string, action?: string) =>
  prisma.auditLog.count({ where: { entityId, ...(action ? { action } : {}) } });
const ids = (response: request.Response) =>
  (response.body.photos as { id: string }[]).map((photo) => photo.id);

/** Fotos vigentes en carpetas eliminadas de esta corrida: SIEMPRE debe ser 0. */
async function orphanedPhotos() {
  return prisma.fileAsset.count({
    where: {
      status: 'AVAILABLE',
      folderId: { in: [...folderIds] },
      folder: { deletedAt: { not: null } },
    },
  });
}

beforeAll(async () => {
  baseline = await globalCounts();
  app = createApp();
  admin = await createActor('ADMIN', 'admin');
  creator = await createActor('EMPLOYEE', 'creadora');
  stranger = await createActor('EMPLOYEE', 'ajena');
  setObjectStorageForTests(memoryStorage);
  setDriveBackupConfigForTests(null);
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
}, 120_000);

afterAll(async () => {
  (pg.Client.prototype as unknown as { query: QueryFn }).query = originalQuery;
  setObjectStorageForTests(undefined);
  setDriveBackupConfigForTests(undefined);
  const files = await prisma.fileAsset.findMany({
    where: { OR: [{ id: { in: [...fileIds] } }, { title: { startsWith: RUN } }] },
    select: { id: true },
  });
  for (const file of files) fileIds.add(file.id);
  const folders = await prisma.photoFolder.findMany({
    where: { OR: [{ id: { in: [...folderIds] } }, { createdByUserId: { in: userIds } }] },
    select: { id: true },
  });
  for (const folder of folders) folderIds.add(folder.id);
  await prisma.idempotencyRecord.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { entityId: { in: [...fileIds, ...folderIds, ...employeeIds, ...userIds] } },
      ],
    },
  });
  await prisma.driveBackupJob.deleteMany({ where: { fileAssetId: { in: [...fileIds] } } });
  await prisma.fileAsset.deleteMany({ where: { id: { in: [...fileIds] } } });
  await prisma.photoFolder.deleteMany({ where: { id: { in: [...folderIds] } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });

  expect(await globalCounts()).toEqual(baseline);
  expect(await prisma.session.count({ where: { userId: { in: userIds } } })).toBe(0);
  expect(await prisma.idempotencyRecord.count({ where: { actorUserId: { in: userIds } } })).toBe(0);
  expect(
    await prisma.auditLog.count({
      where: {
        OR: [{ actorUserId: { in: userIds } }, { entityId: { in: [...fileIds, ...folderIds] } }],
      },
    }),
  ).toBe(0);
  expect(await prisma.user.count({ where: { username: { startsWith: 'test-pf-' } } })).toBe(0);
  expect(await prisma.fileAsset.count({ where: { title: { startsWith: 'test-pf-' } } })).toBe(0);
  expect(await prisma.photoFolder.count({ where: { name: { startsWith: 'test-pf-' } } })).toBe(0);
}, 120_000);

describe('crear y renombrar', { timeout: 120_000 }, () => {
  it('ADMIN y EMPLOYEE crean; autor de la sesión; el reintento con la misma clave no duplica', async () => {
    const idem = key();
    const first = await createFolder(creator, `  ${RUN}   Jardín `, idem);
    const replay = await createFolder(creator, `  ${RUN}   Jardín `, idem);
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect(replay.body.folder.id).toBe(first.body.folder.id);
    expect(first.body.folder).toMatchObject({
      name: `${RUN} Jardín`,
      photoCount: 0,
      version: 1,
      permissions: { canRename: true, canDelete: true },
    });
    const row = await prisma.photoFolder.findUniqueOrThrow({ where: { id: first.body.folder.id } });
    expect(row).toMatchObject({ createdByUserId: creator.userId, nameKey: `${RUN} jardín` });
    expect(await auditCount(row.id, 'photo_folder.created')).toBe(1);

    const byAdmin = await createFolder(admin, `${RUN} Visitas`);
    expect(byAdmin.status).toBe(201);
    expect(
      (await prisma.photoFolder.findUniqueOrThrow({ where: { id: byAdmin.body.folder.id } }))
        .createdByUserId,
    ).toBe(admin.userId);

    const withoutKey = await request(app)
      .post('/api/v1/photos/folders')
      .set(as(creator))
      .send({ name: `${RUN} Sin clave` });
    expect(withoutKey.status).toBe(400);
    expect(withoutKey.body.error.code).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('duplicados (mayúsculas y espacios) y nombres reservados se rechazan; alta simultánea = una sola', async () => {
    const duplicate = await createFolder(stranger, `${RUN}  JARDÍN`);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('PHOTO_FOLDER_NAME_TAKEN');
    for (const name of ['Sin carpeta', ' todas  las FOTOS ']) {
      const reserved = await createFolder(creator, name);
      expect(reserved.status).toBe(400);
    }
    const name = `${RUN} Simultánea`;
    const results = await Promise.all(Array.from({ length: 6 }, () => createFolder(creator, name)));
    expect(results.map((response) => response.status).sort()).toEqual([
      201, 409, 409, 409, 409, 409,
    ]);
    expect(
      await prisma.photoFolder.count({ where: { nameKey: name.toLowerCase(), deletedAt: null } }),
    ).toBe(1);
  });

  it('renombra quien la creó y un ADMIN; un usuario ajeno no; mismo nombre sin escribir; versión vieja 409', async () => {
    const created = await createFolder(creator, `${RUN} Huerta`);
    const id = created.body.folder.id as string;
    const listed = (await listFolders(stranger)).body.folders.find(
      (folder: { id: string }) => folder.id === id,
    );
    expect(listed.permissions).toEqual({ canRename: false, canDelete: false });
    expect((await rename(stranger, id, `${RUN} Ajena`, 1)).status).toBe(403);

    const same = await rename(creator, id, ` ${RUN}   Huerta `, 1);
    expect(same.status).toBe(200);
    expect(same.body.folder.version).toBe(1);
    expect(await auditCount(id, 'photo_folder.renamed')).toBe(0);

    const renamed = await rename(creator, id, `${RUN} huerta`, 1);
    expect(renamed.status).toBe(200);
    expect(renamed.body.folder).toMatchObject({ name: `${RUN} huerta`, version: 2 });
    const stale = await rename(admin, id, `${RUN} Otra`, 1);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('PHOTO_FOLDER_VERSION_CONFLICT');
    const byAdmin = await rename(admin, id, `${RUN} Huerta nueva`, 2);
    expect(byAdmin.status).toBe(200);
    expect((await rename(admin, id, `${RUN} Visitas`, 3)).body.error.code).toBe(
      'PHOTO_FOLDER_NAME_TAKEN',
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: id, action: 'photo_folder.renamed', actorUserId: admin.userId },
    });
    expect(audit.previousState).toEqual({ name: `${RUN} huerta`, version: 2 });
    expect(audit.newState).toEqual({ name: `${RUN} Huerta nueva`, version: 3 });

    const [left, right] = await Promise.all([
      rename(creator, id, `${RUN} Carrera A`, 3),
      rename(admin, id, `${RUN} Carrera B`, 3),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 409]);
    expect(await auditCount(id, 'photo_folder.renamed')).toBe(3);
  });
});

describe('fotos, carpetas y conteos', { timeout: 120_000 }, () => {
  let garden = '';
  let visits = '';
  let third = '';
  let loose = '';

  it('una foto anterior sin carpeta queda por organizar y en «Todas las fotos»; una nueva sin carpeta se rechaza', async () => {
    const created = await createFolder(creator, `${RUN} Conteos`);
    garden = created.body.folder.id;
    visits = (await createFolder(admin, `${RUN} Conteos destino`)).body.folder.id;
    third = (await createFolder(stranger, `${RUN} Conteos tercera`)).body.folder.id;
    loose = await legacyPhoto('anterior');
    expect(ids(await gallery(creator, 'folder=none&pageSize=48'))).toContain(loose);
    expect(ids(await gallery(creator, 'pageSize=48'))).toContain(loose);
    expect(ids(await gallery(creator, `folder=${garden}`))).not.toContain(loose);
    const counts = (await listFolders(creator)).body;
    expect(counts.unfiled.photoCount).toBeGreaterThanOrEqual(1);

    const putsBefore = storageCalls.put;
    const withoutFolder = await upload(stranger, 'sin carpeta');
    expect(withoutFolder.status).toBe(400);
    expect(withoutFolder.body.error.code).toBe('PHOTO_FOLDER_REQUIRED');
    expect(storageCalls.put).toBe(putsBefore);
    expect(await prisma.fileAsset.count({ where: { title: `${RUN} sin carpeta` } })).toBe(0);
  });

  it('subida confirmada en la carpeta; una subida fallida no aparece en ningún lado', async () => {
    const first = await upload(creator, 'en carpeta 1', garden);
    await sleep(5);
    const second = await upload(stranger, 'en carpeta 2', garden);
    await sleep(5);
    const latest = await upload(admin, 'en carpeta 3', garden);
    expect([first.status, second.status, latest.status]).toEqual([201, 201, 201]);
    expect(first.body.photo.folderId).toBe(garden);
    // Sin pedir la clasificación: la categoría general, nunca evidencia de tarea.
    expect(first.body.photo.category).toBe('MEMORY');
    const pageOne = await gallery(creator, `folder=${garden}&pageSize=2&page=1`);
    const pageTwo = await gallery(creator, `folder=${garden}&pageSize=2&page=2`);
    expect(ids(pageOne)).toEqual([latest.body.photo.id, second.body.photo.id]);
    expect(ids(pageTwo)).toEqual([first.body.photo.id]);
    expect(pageOne.body).toMatchObject({ total: 3, totalPages: 2 });
    expect(ids(await gallery(creator, `folder=${garden}&category=TASK_EVIDENCE`))).toEqual([]);

    failNextPut = true;
    const failed = await upload(creator, 'fallida', garden);
    expect(failed.status).toBe(502);
    const failedRow = await prisma.fileAsset.findFirstOrThrow({
      where: { title: `${RUN} fallida` },
    });
    fileIds.add(failedRow.id);
    expect(failedRow).toMatchObject({ status: 'UPLOAD_FAILED', folderId: null });
    expect((await gallery(creator, `folder=${garden}`)).body.total).toBe(3);
  });

  it('conteos agrupados en sentencias fijas, sin importar la cantidad de carpetas', async () => {
    const { result, sql } = await countStatements(() => listFolders(stranger));
    expect(result.status).toBe(200);
    expect(sql.length).toBeLessThanOrEqual(3);
    const byId = new Map(
      (result.body.folders as { id: string; photoCount: number }[]).map((folder) => [
        folder.id,
        folder.photoCount,
      ]),
    );
    expect(byId.get(garden)).toBe(3);
    expect(byId.get(visits)).toBe(0);
    const allPhotos = await prisma.fileAsset.count({
      where: { status: 'AVAILABLE', category: { in: ['MEMORY', 'TASK_EVIDENCE'] } },
    });
    expect(result.body.all.photoCount).toBe(allPhotos);
    const names = (result.body.folders as { name: string }[]).map((folder) => folder.name);
    const sorted = [...names].sort((a, b) =>
      a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true }),
    );
    expect(names).toEqual(sorted);
    expect(JSON.stringify(result.body)).not.toMatch(/nameKey|memoria-test|objectKey/);

    const filtered = await countStatements(() => gallery(stranger, `folder=${garden}`));
    expect(filtered.sql.length).toBeLessThanOrEqual(5);
  });

  it('mover entre carpetas y organizar una foto anterior conserva archivo y metadatos; al destino actual no audita; nunca a «sin carpeta»', async () => {
    const photoId = ids(await gallery(creator, `folder=${garden}&pageSize=1`))[0] as string;
    const before = await prisma.fileAsset.findUniqueOrThrow({ where: { id: photoId } });
    const callsBefore = { ...storageCalls };
    const objectsBefore = new Map(objects);

    const toVisits = await move(stranger, photoId, visits, garden);
    expect(toVisits.status).toBe(200);
    expect(toVisits.body).toMatchObject({ moved: true, photo: { id: photoId, folderId: visits } });
    expect(ids(await gallery(creator, `folder=${garden}`))).not.toContain(photoId);
    expect(ids(await gallery(creator, `folder=${visits}`))).toContain(photoId);
    expect(ids(await gallery(creator, 'pageSize=48'))).toContain(photoId);

    const toNone = await move(admin, photoId, null, visits);
    expect(toNone.status).toBe(400);
    const toThird = await move(admin, photoId, third, visits);
    expect(toThird.body.photo.folderId).toBe(third);
    const same = await move(creator, photoId, third, null);
    expect(same.body.moved).toBe(false);

    const after = await prisma.fileAsset.findUniqueOrThrow({ where: { id: photoId } });
    const keep = (row: typeof before) => ({
      id: row.id,
      objectKey: row.objectKey,
      bucket: row.bucket,
      checksum: row.checksum,
      etag: row.etag,
      title: row.title,
      category: row.category,
      status: row.status,
      createdAt: row.createdAt,
      uploadedByEmployeeId: row.uploadedByEmployeeId,
      taggedEmployeeId: row.taggedEmployeeId,
      taskId: row.taskId,
      animalId: row.animalId,
      sizeBytes: row.sizeBytes,
    });
    expect(keep(after)).toEqual(keep(before));
    expect(storageCalls).toEqual(callsBefore);
    expect(objects).toEqual(objectsBefore);
    const moves = await prisma.auditLog.findMany({
      where: { entityId: photoId, action: 'photo.moved' },
      orderBy: { createdAt: 'asc' },
    });
    expect(moves.map((audit) => [audit.previousState, audit.newState])).toEqual([
      [{ folderId: garden }, { folderId: visits }],
      [{ folderId: visits }, { folderId: third }],
    ]);
    // Vuelve a su carpeta para las pruebas siguientes.
    expect((await move(creator, photoId, garden, third)).status).toBe(200);

    // Una foto anterior por organizar pasa a una carpeta, sin cambiar nada más.
    const legacyBefore = await prisma.fileAsset.findUniqueOrThrow({ where: { id: loose } });
    const organized = await move(stranger, loose, visits, null);
    expect(organized.body).toMatchObject({ moved: true, photo: { id: loose, folderId: visits } });
    const legacyAfter = await prisma.fileAsset.findUniqueOrThrow({ where: { id: loose } });
    expect(keep(legacyAfter)).toEqual(keep(legacyBefore));
    expect(ids(await gallery(creator, 'folder=none&pageSize=48'))).not.toContain(loose);
    // Vuelve a quedar por organizar (fixture) para las pruebas siguientes.
    await prisma.fileAsset.update({ where: { id: loose }, data: { folderId: null } });
  });

  it('dos movimientos simultáneos de la misma foto: uno gana y el otro recibe conflicto', async () => {
    const photoId = ids(await gallery(creator, `folder=${garden}&pageSize=1`))[0] as string;
    const audits = await auditCount(photoId, 'photo.moved');
    const [left, right] = await Promise.all([
      move(creator, photoId, visits, garden),
      move(stranger, photoId, third, garden),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 409]);
    expect([left, right].find((response) => response.status === 409)?.body.error.code).toBe(
      'PHOTO_MOVE_CONFLICT',
    );
    expect(await auditCount(photoId, 'photo.moved')).toBe(audits + 1);
    const winner = [left, right].find((response) => response.status === 200);
    const row = await prisma.fileAsset.findUniqueOrThrow({ where: { id: photoId } });
    expect(row.folderId).toBe(winner?.body.photo.folderId);
    // Devuelve la foto a su carpeta con la carpeta que realmente tiene.
    expect((await move(creator, photoId, garden, row.folderId)).status).toBe(200);
  });

  it('no se elimina con fotos; la elimina quien la creó o un ADMIN; repetir es seguro', async () => {
    const full = await remove(creator, garden, 1);
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('PHOTO_FOLDER_NOT_EMPTY');
    expect((await gallery(creator, `folder=${garden}`)).body.total).toBe(3);

    const empty = (await createFolder(creator, `${RUN} Vacía`)).body.folder.id as string;
    expect((await remove(stranger, empty, 1)).status).toBe(403);
    const deleted = await remove(creator, empty, 1);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ folder: { id: empty, deleted: true } });
    const again = await remove(creator, empty, 1);
    expect(again.status).toBe(200);
    expect(await auditCount(empty, 'photo_folder.deleted')).toBe(1);
    const row = await prisma.photoFolder.findUniqueOrThrow({ where: { id: empty } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedByUserId).toBe(creator.userId);

    // Eliminada: no se ve, no recibe fotos y su nombre queda libre.
    expect(
      (await listFolders(creator)).body.folders.some(
        (folder: { id: string }) => folder.id === empty,
      ),
    ).toBe(false);
    expect((await gallery(creator, `folder=${empty}`)).status).toBe(404);
    const blockedUpload = await upload(creator, 'a eliminada', empty);
    expect(blockedUpload.body.error.code).toBe('PHOTO_FOLDER_UNAVAILABLE');
    expect(await prisma.fileAsset.count({ where: { title: `${RUN} a eliminada` } })).toBe(0);
    expect((await move(creator, loose, empty, null)).body.error.code).toBe(
      'PHOTO_FOLDER_UNAVAILABLE',
    );
    expect((await rename(creator, empty, `${RUN} Revive`, 2)).status).toBe(404);
    expect((await createFolder(creator, `${RUN} Vacía`)).status).toBe(201);

    const byAdmin = (await createFolder(creator, `${RUN} Moderada`)).body.folder.id as string;
    expect((await remove(admin, byAdmin, 1)).status).toBe(200);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: byAdmin, action: 'photo_folder.deleted' },
    });
    expect(audit.newState).toMatchObject({ deleted: true, moderated: true });
  });

  it('una foto eliminada no cuenta para vaciar y conserva su carpeta como historia', async () => {
    const folder = (await createFolder(creator, `${RUN} Con historia`)).body.folder.id as string;
    const photo = (await upload(creator, 'historia', folder)).body.photo.id as string;
    expect(
      (await request(app).post(`/api/v1/photos/${photo}/delete`).set(as(admin)).send({})).status,
    ).toBe(200);
    expect((await remove(creator, folder, 1)).status).toBe(200);
    const row = await prisma.fileAsset.findUniqueOrThrow({ where: { id: photo } });
    expect(row).toMatchObject({ status: 'DELETED', folderId: folder });
    // La FK RESTRICT impide el borrado físico de la carpeta referenciada.
    await expect(prisma.photoFolder.delete({ where: { id: folder } })).rejects.toThrow();
  });
});

describe(
  'carreras entre eliminación, movimiento y confirmación de subida',
  { timeout: 120_000 },
  () => {
    /**
     * Una transacción paralela con la carpeta bloqueada (como la eliminación
     * o un movimiento en curso) que se confirma recién al abrir la compuerta.
     */
    function holdTransaction(
      work: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>,
    ) {
      let open!: () => void;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      let locked!: () => void;
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const done = prisma.$transaction(
        async (tx) => {
          await work(tx);
          locked();
          await gate;
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
      return { ready, open, done };
    }
    const settledFlag = <T>(promise: Promise<T>) => {
      const state = { settled: false };
      void promise.then(
        () => (state.settled = true),
        () => (state.settled = true),
      );
      return state;
    };

    it('eliminación en curso → un movimiento que llega después espera y recibe 409 (no queda huérfana)', async () => {
      const folder = (await createFolder(creator, `${RUN} Carrera mover`)).body.folder.id as string;
      const photo = await legacyPhoto('carrera mover');
      const deletion = holdTransaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "photo_folders" WHERE "id" = ${folder}::uuid FOR UPDATE`;
        await tx.photoFolder.update({
          where: { id: folder },
          data: {
            deletedAt: new Date(),
            deletedByUserId: creator.userId,
            version: { increment: 1 },
          },
        });
      });
      await deletion.ready;
      const moving = move(stranger, photo, folder, null).then((response) => response);
      const state = settledFlag(moving);
      await sleep(700);
      expect(state.settled).toBe(false);
      deletion.open();
      await deletion.done;
      const response = await moving;
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('PHOTO_FOLDER_UNAVAILABLE');
      expect(
        (await prisma.fileAsset.findUniqueOrThrow({ where: { id: photo } })).folderId,
      ).toBeNull();
      expect(await orphanedPhotos()).toBe(0);
    });

    it('movimiento en curso → la eliminación espera, cuenta la foto y responde 409', async () => {
      const folder = (await createFolder(creator, `${RUN} Carrera eliminar`)).body.folder
        .id as string;
      const photo = await legacyPhoto('carrera eliminar');
      const moving = holdTransaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "photo_folders" WHERE "id" = ${folder}::uuid AND "deleted_at" IS NULL FOR KEY SHARE`;
        await tx.fileAsset.update({ where: { id: photo }, data: { folderId: folder } });
      });
      await moving.ready;
      const deleting = remove(creator, folder, 1).then((response) => response);
      const state = settledFlag(deleting);
      await sleep(700);
      expect(state.settled).toBe(false);
      moving.open();
      await moving.done;
      const response = await deleting;
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('PHOTO_FOLDER_NOT_EMPTY');
      expect(
        (await prisma.photoFolder.findUniqueOrThrow({ where: { id: folder } })).deletedAt,
      ).toBeNull();
    });

    it('eliminación confirmada mientras se subía: 409 al confirmar, sin foto visible y sin objeto', async () => {
      const folder = (await createFolder(creator, `${RUN} Carrera subir`)).body.folder.id as string;
      const deletion = holdTransaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "photo_folders" WHERE "id" = ${folder}::uuid FOR UPDATE`;
        await tx.photoFolder.update({
          where: { id: folder },
          data: {
            deletedAt: new Date(),
            deletedByUserId: creator.userId,
            version: { increment: 1 },
          },
        });
      });
      await deletion.ready;
      const objectsBefore = objects.size;
      const uploading = upload(stranger, 'carrera subir', folder).then((response) => response);
      await sleep(900);
      deletion.open();
      await deletion.done;
      const response = await uploading;
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('PHOTO_FOLDER_UNAVAILABLE');
      const row = await prisma.fileAsset.findFirstOrThrow({
        where: { title: `${RUN} carrera subir` },
      });
      fileIds.add(row.id);
      expect(row.folderId).toBeNull();
      expect(['PENDING_DELETION', 'DELETED']).toContain(row.status);
      expect(objects.size).toBe(objectsBefore);
      expect(await orphanedPhotos()).toBe(0);
    });

    it('eliminar y mover a la vez por HTTP (varias rondas): nunca una foto vigente en una carpeta eliminada', async () => {
      for (let round = 0; round < 4; round += 1) {
        const folder = (await createFolder(creator, `${RUN} Ronda ${round}`)).body.folder
          .id as string;
        const photo = await legacyPhoto(`ronda ${round}`);
        const [moved, deleted] = await Promise.all([
          move(stranger, photo, folder, null),
          remove(creator, folder, 1),
        ]);
        const outcome = [moved.status, deleted.status];
        expect([
          [200, 409],
          [409, 200],
        ]).toContainEqual(outcome);
        expect(await orphanedPhotos()).toBe(0);
      }
    });
  },
);

describe('aislamiento y garantías de la base', { timeout: 120_000 }, () => {
  it('la foto de una mascota y el plano del jardín no se mueven ni cuentan; la base lo impide también', async () => {
    const base = {
      provider: 'NEON_OBJECT_STORAGE' as const,
      bucket: 'memoria-test',
      originalFilename: 'x.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1,
      status: 'AVAILABLE' as const,
    };
    const pet = await prisma.fileAsset.create({
      data: { ...base, objectKey: `${RUN}/pet.jpg`, category: 'ANIMAL_PROFILE' },
      select: { id: true },
    });
    const plan = await prisma.fileAsset.create({
      data: { ...base, objectKey: `${RUN}/plan.jpg`, category: 'GARDEN_PLAN' },
      select: { id: true },
    });
    const pending = await prisma.fileAsset.create({
      data: {
        ...base,
        objectKey: `${RUN}/pending.jpg`,
        category: 'MEMORY',
        status: 'PENDING_UPLOAD',
        title: `${RUN} pendiente`,
      },
      select: { id: true },
    });
    for (const id of [pet.id, plan.id, pending.id]) fileIds.add(id);
    const folder = (await createFolder(creator, `${RUN} Aislada`)).body.folder.id as string;

    for (const id of [pet.id, plan.id, pending.id]) {
      expect((await move(admin, id, folder, null)).body.error.code).toBe('PHOTO_NOT_FOUND');
      await expect(
        prisma.fileAsset.update({ where: { id }, data: { folderId: folder } }),
      ).rejects.toThrow();
    }
    const listed = (await listFolders(admin)).body;
    expect(listed.folders.find((item: { id: string }) => item.id === folder).photoCount).toBe(0);
    expect(ids(await gallery(admin, 'folder=none&pageSize=48'))).not.toContain(pending.id);
    // Nombre vigente duplicado directo en la base: el índice único parcial lo rechaza.
    await expect(
      prisma.photoFolder.create({
        data: { name: 'x', nameKey: `${RUN} aislada`, createdByUserId: creator.userId },
      }),
    ).rejects.toThrow();
  });

  it('ninguna operación de carpetas encola copias en Drive', async () => {
    expect(
      await prisma.driveBackupJob.count({ where: { fileAssetId: { in: [...fileIds] } } }),
    ).toBe(0);
    expect(await prisma.driveBackupJob.count()).toBe(baseline.driveJobs);
  });
});
