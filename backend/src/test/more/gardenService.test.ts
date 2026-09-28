import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🌳 Jardín (Etapa 5Y) con un Prisma simulado mínimo: ver es de todos,
 * publicar es solo ADMIN, el tipo real del archivo sale de los bytes, el
 * número de versión es el máximo + 1 calculado bajo lock de aviso dentro de la
 * transacción, y la idempotencia nunca publica dos versiones. La SQL real
 * (índice único, `RESTRICT`, `pg_advisory_xact_lock`) se prueba contra `demo`
 * en `garden.integration.test.ts`.
 */
const db = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    gardenPlanVersion: {
      count: fn(),
      findMany: fn(),
      findFirst: fn(),
      aggregate: fn(),
      create: fn(),
    },
    fileAsset: { create: fn(), update: fn(), updateMany: fn() },
    idempotencyRecord: { findUnique: fn(), create: fn(), update: fn() },
    auditLog: { create: fn() },
    $executeRaw: fn(),
    $transaction: fn(),
  };
});
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import { createHash } from 'node:crypto';
import { canonicalRequestHash } from '../../lib/idempotency';
import { setObjectStorageForTests, type ObjectStorageClient } from '../../lib/objectStorage';
import type { TaskActor } from '../../tasks/tasksService';
import {
  findReadableGardenPlanVersion,
  listGardenPlanVersions,
  publishGardenPlanVersion,
  readGardenPlanObject,
} from '../../more/gardenService';

const META = { ipAddress: null, userAgent: 'vitest' };
const ID = '44444444-4444-4444-8444-444444444444';
const ADMIN: TaskActor = { userId: 'user-a', role: 'ADMIN', employeeId: null };
const EMPLOYEE: TaskActor = { userId: 'user-e', role: 'EMPLOYEE', employeeId: 'emp-1' };
const NOW = new Date('2026-09-28T13:30:00Z');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const audits = () => db.auditLog.create.mock.calls.map((call) => call[0].data);

function fakeStorage(overrides: Partial<ObjectStorageClient> = {}) {
  return {
    bucket: 'bucket-test',
    putObject: vi.fn(async () => ({ etag: '"e"' })),
    getObject: vi.fn(async () => ({ body: JPEG, contentType: 'image/jpeg', etag: null })),
    deleteObject: vi.fn(async () => undefined),
    ...overrides,
  };
}

const version = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  versionNumber: 3,
  createdAt: NOW,
  fileAsset: { sizeBytes: 1024, mimeType: 'image/jpeg' },
  publishedBy: { username: 'pablo', employee: { displayName: 'Pablo' } },
  ...overrides,
});

beforeEach(() => {
  for (const group of Object.values(db)) {
    if (typeof group === 'function') group.mockReset();
    else for (const method of Object.values(group)) method.mockReset();
  }
  db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
  db.$executeRaw.mockResolvedValue(0);
  db.auditLog.create.mockResolvedValue({});
  db.gardenPlanVersion.aggregate.mockResolvedValue({ _max: { versionNumber: 2 } });
  db.gardenPlanVersion.create.mockResolvedValue(version());
  db.fileAsset.create.mockResolvedValue({ id: ID });
  db.fileAsset.updateMany.mockResolvedValue({ count: 1 });
  setObjectStorageForTests(null);
});
afterEach(() => setObjectStorageForTests(undefined));

describe('🌳 Jardín — ver el plano y el historial', () => {
  it('pagina de la más reciente a la más antigua y expone la vigente en la primera página', async () => {
    db.gardenPlanVersion.count.mockResolvedValue(3);
    db.gardenPlanVersion.findMany.mockResolvedValue([version(), version({ versionNumber: 2 })]);
    const page1 = await listGardenPlanVersions({ page: 1, pageSize: 2 });
    expect(page1.current).toMatchObject({ id: ID, versionNumber: 3, publishedBy: 'Pablo' });
    expect(page1.versions).toHaveLength(2);
    expect(page1.totalPages).toBe(2);
    expect(db.gardenPlanVersion.findMany.mock.calls[0]?.[0]).toMatchObject({
      orderBy: { versionNumber: 'desc' },
      skip: 0,
      take: 2,
      // Solo las versiones cuyo archivo sigue disponible.
      where: { fileAsset: { is: { status: 'AVAILABLE' } } },
    });
    db.gardenPlanVersion.findMany.mockResolvedValue([version({ versionNumber: 1 })]);
    const page2 = await listGardenPlanVersions({ page: 2, pageSize: 2 });
    expect(page2.current).toBeNull();
    expect(db.gardenPlanVersion.findMany.mock.calls[1]?.[0]).toMatchObject({ skip: 2 });
  });

  it('vacío no es un error: sin versiones, la pantalla muestra el estado inicial', async () => {
    db.gardenPlanVersion.count.mockResolvedValue(0);
    db.gardenPlanVersion.findMany.mockResolvedValue([]);
    await expect(listGardenPlanVersions({ page: 1, pageSize: 20 })).resolves.toMatchObject({
      current: null,
      versions: [],
      total: 0,
      totalPages: 1,
    });
  });

  it('no filtra ni pagina nada del usuario: el plano es el mismo para todos', async () => {
    db.gardenPlanVersion.count.mockResolvedValue(0);
    db.gardenPlanVersion.findMany.mockResolvedValue([]);
    await listGardenPlanVersions({ page: 1, pageSize: 20 });
    const where = db.gardenPlanVersion.findMany.mock.calls[0]?.[0].where as Record<string, unknown>;
    expect(Object.keys(where)).toEqual(['fileAsset']);
  });

  it('contenido: 404 si la versión no existe y sin almacenamiento configurado es 503', async () => {
    setObjectStorageForTests(fakeStorage());
    db.gardenPlanVersion.findFirst.mockResolvedValue(null);
    await expect(findReadableGardenPlanVersion(ID)).rejects.toMatchObject({
      code: 'GARDEN_PLAN_VERSION_NOT_FOUND',
      statusCode: 404,
    });
    setObjectStorageForTests(null);
    await expect(findReadableGardenPlanVersion(ID)).rejects.toMatchObject({
      code: 'OBJECT_STORAGE_NOT_CONFIGURED',
      statusCode: 503,
    });
  });

  it('contenido: lee el objeto y nunca devuelve la clave del bucket al cliente', async () => {
    const storage = fakeStorage();
    setObjectStorageForTests(storage);
    db.gardenPlanVersion.findFirst.mockResolvedValue({
      fileAsset: { objectKey: 'garden-plans/2026/x.jpg', mimeType: 'image/jpeg', checksum: 'abc' },
    });
    const found = await findReadableGardenPlanVersion(ID);
    expect(found).toEqual({
      objectKey: 'garden-plans/2026/x.jpg',
      mimeType: 'image/jpeg',
      checksum: 'abc',
    });
    await expect(readGardenPlanObject('garden-plans/2026/x.jpg')).resolves.toEqual(JPEG);
    expect(storage.getObject).toHaveBeenCalledWith('garden-plans/2026/x.jpg');
  });

  it('contenido: si el objeto no existe en el bucket, 404 y no un error opaco', async () => {
    setObjectStorageForTests(fakeStorage({ getObject: vi.fn(async () => null) }));
    await expect(readGardenPlanObject('garden-plans/2026/x.jpg')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('🌳 Jardín — publicar una versión (solo ADMIN)', () => {
  const publish = (actor: TaskActor, key?: string, body: Buffer = JPEG, type = 'image/jpeg') =>
    publishGardenPlanVersion(
      actor,
      { body, declaredType: type, filename: 'plano.jpg' },
      META,
      key,
      NOW,
    );

  it('EMPLOYEE: 403 en español, sin tocar la base ni el almacenamiento', async () => {
    const storage = fakeStorage();
    setObjectStorageForTests(storage);
    await expect(publish(EMPLOYEE)).rejects.toMatchObject({
      statusCode: 403,
      message: 'Solo un administrador puede publicar una versión del plano.',
    });
    expect(db.fileAsset.create).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('sin almacenamiento configurado: 503 claro, sin tocar la base', async () => {
    await expect(publish(ADMIN)).rejects.toMatchObject({ code: 'OBJECT_STORAGE_NOT_CONFIGURED' });
    expect(db.fileAsset.create).not.toHaveBeenCalled();
  });

  it('el tipo real sale de los bytes: un PNG declarado JPEG, o un SVG, se rechaza', async () => {
    setObjectStorageForTests(fakeStorage());
    await expect(publish(ADMIN, undefined, JPEG, 'image/png')).rejects.toMatchObject({
      statusCode: 415,
    });
    await expect(
      publish(ADMIN, undefined, Buffer.from('<svg/>'), 'image/svg+xml'),
    ).rejects.toMatchObject({ statusCode: 415 });
    expect(db.fileAsset.create).not.toHaveBeenCalled();
  });

  it('cuerpo vacío o sin Content-Type de imagen: 415 antes de subir nada', async () => {
    setObjectStorageForTests(fakeStorage());
    await expect(publish(ADMIN, undefined, Buffer.alloc(0))).rejects.toMatchObject({
      statusCode: 415,
    });
  });

  it('ADMIN publica: clave del backend, versión = máximo + 1 bajo lock, AVAILABLE y auditada', async () => {
    const storage = fakeStorage();
    setObjectStorageForTests(storage);
    const result = await publish(ADMIN);
    expect(result).toMatchObject({ kind: 'created', body: { version: { versionNumber: 3 } } });
    // El lock se toma antes de leer el MAX: si no, dos publicaciones eleían el mismo número.
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const key = db.fileAsset.create.mock.calls[0]?.[0].data.objectKey as string;
    expect(key).toMatch(/^garden-plans\/2026\/[0-9a-f-]{36}\.jpg$/);
    expect(storage.putObject).toHaveBeenCalledWith(key, JPEG, 'image/jpeg');
    // El `FileAsset` nace `PENDING_UPLOAD` por default: el servicio nunca lo
    // declara AVAILABLE al crearlo, solo después de que el PUT responde.
    const created = db.fileAsset.create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(created).toMatchObject({ category: 'GARDEN_PLAN', bucket: 'bucket-test' });
    expect(created.status).toBeUndefined();
    expect(db.gardenPlanVersion.create.mock.calls[0]?.[0].data).toEqual({
      versionNumber: 3,
      fileAssetId: ID,
      publishedByUserId: 'user-a',
    });
    expect(db.fileAsset.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: ID, status: 'PENDING_UPLOAD' },
      data: { status: 'AVAILABLE' },
    });
    expect(audits()[0]).toMatchObject({
      action: 'garden_plan.version_published',
      actorUserId: 'user-a',
      entityType: 'GardenPlanVersion',
    });
  });

  it('la primera versión es la 1, no la 0', async () => {
    setObjectStorageForTests(fakeStorage());
    db.gardenPlanVersion.aggregate.mockResolvedValue({ _max: { versionNumber: null } });
    await publish(ADMIN);
    expect(db.gardenPlanVersion.create.mock.calls[0]?.[0].data.versionNumber).toBe(1);
  });

  it('el proveedor falla: UPLOAD_FAILED y 502 reintentable, sin versión creada', async () => {
    setObjectStorageForTests(
      fakeStorage({
        putObject: vi.fn(async () => {
          throw new Error('boom');
        }),
      }),
    );
    db.fileAsset.create.mockResolvedValue({ id: ID });
    await expect(publish(ADMIN)).rejects.toMatchObject({ code: 'OBJECT_STORAGE_UNAVAILABLE' });
    expect(db.fileAsset.update.mock.calls[0]?.[0].data).toEqual({ status: 'UPLOAD_FAILED' });
    expect(db.gardenPlanVersion.create).not.toHaveBeenCalled();
  });

  it('si la transacción falla tras subir, el objeto sobrante se descarta', async () => {
    const storage = fakeStorage();
    setObjectStorageForTests(storage);
    db.fileAsset.updateMany.mockResolvedValue({ count: 0 });
    await expect(publish(ADMIN)).rejects.toMatchObject({
      code: 'GARDEN_PLAN_VERSION_NOT_FOUND',
    });
    // El descarte es baja lógica y luego borrado físico confirmado.
    expect(
      db.fileAsset.updateMany.mock.calls.map(
        (call) => (call[0] as { data: { status: string } }).data.status,
      ),
    ).toEqual(['AVAILABLE', 'PENDING_DELETION', 'DELETED']);
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
  });

  it('un reintento con la misma clave ya resuelto responde el original sin volver a subir', async () => {
    const storage = fakeStorage();
    setObjectStorageForTests(storage);
    const checksum = createHash('sha256').update(JPEG).digest('hex');
    db.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash: canonicalRequestHash(['POST /more/garden/versions', checksum]),
      responseStatus: 201,
      responseBody: { version: { id: ID } },
      completedAt: NOW,
    });
    const result = await publish(ADMIN, 'clave-idempotente-123');
    expect(result).toEqual({ kind: 'replay', status: 201, body: { version: { id: ID } } });
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(db.gardenPlanVersion.create).not.toHaveBeenCalled();
  });

  it('la misma clave con otra imagen es 409, sin subir nada', async () => {
    const storage = fakeStorage();
    setObjectStorageForTests(storage);
    db.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash: 'otra-huella',
      responseStatus: 201,
      responseBody: {},
      completedAt: NOW,
    });
    await expect(publish(ADMIN, 'clave-idempotente-123')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('una clave con formato inválido se rechaza antes de tocar nada', async () => {
    setObjectStorageForTests(fakeStorage());
    await expect(publish(ADMIN, 'corta')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_INVALID',
    });
    expect(db.fileAsset.create).not.toHaveBeenCalled();
  });
});
