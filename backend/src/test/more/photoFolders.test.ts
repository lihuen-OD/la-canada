import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 📸 Carpetas de Fotos con un Prisma simulado: permisos (creador o ADMIN),
 * orden por nombre, conteos agrupados, idempotencia y unicidad del nombre,
 * renombre y eliminación con versión, mover con la carpeta vista, subida a
 * una carpeta eliminada a mitad de camino y que nada de esto encola copias
 * en Drive. La SQL real (bloqueos, índice único parcial, CHECK) se prueba
 * contra `demo` en `photoFolders.integration.test.ts`.
 */
const db = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    photoFolder: {
      findMany: fn(),
      findFirst: fn(),
      findUnique: fn(),
      create: fn(),
      update: fn(),
      updateMany: fn(),
    },
    fileAsset: {
      groupBy: fn(),
      count: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
      updateMany: fn(),
      findUniqueOrThrow: fn(),
    },
    employee: { findUnique: fn() },
    idempotencyRecord: { findUnique: fn(), create: fn(), update: fn() },
    driveBackupJob: { create: fn() },
    auditLog: { create: fn() },
    $transaction: fn(),
    $queryRaw: fn(),
  };
});
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import { Prisma } from '../../generated/prisma/client';
import { setDriveBackupConfigForTests } from '../../driveBackup/config';
import { setObjectStorageForTests, type ObjectStorageClient } from '../../lib/objectStorage';
import type { TaskActor } from '../../tasks/tasksService';
import {
  comparePhotoFolders,
  createPhotoFolder,
  deletePhotoFolder,
  listPhotoFolders,
  movePhoto,
  photoFolderPermissions,
  renamePhotoFolder,
} from '../../more/photoFoldersService';
import { listPhotos, uploadPhoto } from '../../more/photosService';
import {
  createPhotoFolderBodySchema,
  listPhotosQuerySchema,
  movePhotoBodySchema,
  renamePhotoFolderBodySchema,
  uploadPhotoQuerySchema,
} from '../../more/moreSchemas';

const META = { ipAddress: null, userAgent: 'vitest' };
const FOLDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_FOLDER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const THIRD_FOLDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PHOTO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CREATOR: TaskActor = { userId: 'user-creator', role: 'EMPLOYEE', employeeId: 'emp-1' };
const STRANGER: TaskActor = { userId: 'user-other', role: 'EMPLOYEE', employeeId: 'emp-2' };
const ADMIN: TaskActor = { userId: 'user-admin', role: 'ADMIN', employeeId: null };
const NOW = new Date('2026-10-30T15:00:00Z');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const KEY = 'clave-carpeta-0001';
const DRIVE_DEMO = {
  destinationId: 'shared-drive-root-1',
  environment: 'DEMO' as const,
  credentialsFile: '/no/existe/credenciales.json',
};
const audits = () => db.auditLog.create.mock.calls.map((call) => call[0].data);

const folderRow = (overrides: Record<string, unknown> = {}) => ({
  id: FOLDER,
  name: 'Jardín',
  nameKey: 'jardín',
  version: 1,
  createdAt: NOW,
  createdByUserId: CREATOR.userId,
  ...overrides,
});
const photoRow = (folderId: string | null) => ({
  id: PHOTO,
  title: 'Rosas',
  category: 'MEMORY',
  createdAt: NOW,
  folderId,
  taggedEmployee: null,
});

function fakeStorage(overrides: Partial<ObjectStorageClient> = {}) {
  return {
    bucket: 'bucket-test',
    putObject: vi.fn(async () => ({ etag: '"e"' })),
    getObject: vi.fn(async () => null),
    deleteObject: vi.fn(async () => undefined),
    ...overrides,
  };
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['name_key'] },
  });
}

beforeEach(() => {
  for (const group of Object.values(db)) {
    if (typeof group === 'function') group.mockReset();
    else for (const method of Object.values(group)) method.mockReset();
  }
  db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
  db.auditLog.create.mockResolvedValue({});
  db.idempotencyRecord.create.mockResolvedValue({ id: 'idem-1' });
  db.idempotencyRecord.update.mockResolvedValue({});
  setObjectStorageForTests(null);
  // Copia en Drive ACTIVADA en todas: ninguna operación de carpetas encola.
  setDriveBackupConfigForTests(DRIVE_DEMO);
});
afterEach(() => {
  setObjectStorageForTests(undefined);
  setDriveBackupConfigForTests(undefined);
});

describe('esquemas', () => {
  it('nombre: recorta, colapsa espacios y normaliza a NFC; hasta 80 caracteres de texto plano', () => {
    expect(createPhotoFolderBodySchema.parse({ name: '  Jardín   de\t invierno ' })).toEqual({
      name: 'Jardín de invierno',
    });
    expect(createPhotoFolderBodySchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createPhotoFolderBodySchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
    expect(createPhotoFolderBodySchema.safeParse({ name: 'x'.repeat(80) }).success).toBe(true);
    expect(createPhotoFolderBodySchema.safeParse({ name: '<b>x</b>' }).success).toBe(false);
    expect(createPhotoFolderBodySchema.safeParse({ name: 'a\u0000b' }).success).toBe(false);
  });

  it.each([
    'Sin carpeta',
    '  sin   CARPETA ',
    'Todas las fotos',
    'TODAS LAS FOTOS',
    'Fotos por organizar',
    ' fotos  POR organizar',
  ])('reserva los nombres de los accesos especiales: %j', (name) => {
    const parsed = createPhotoFolderBodySchema.safeParse({ name });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(
      /Todas las fotos.*Fotos por organizar.*Sin carpeta/,
    );
  });

  it('el cliente nunca envía autor, clave ni estado', () => {
    expect(createPhotoFolderBodySchema.safeParse({ name: 'x', createdByUserId: 'u' }).success).toBe(
      false,
    );
    expect(renamePhotoFolderBodySchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(renamePhotoFolderBodySchema.safeParse({ name: 'x', version: 0 }).success).toBe(false);
    expect(
      renamePhotoFolderBodySchema.safeParse({ name: 'x', version: 1, nameKey: 'x' }).success,
    ).toBe(false);
  });

  it('mover exige una carpeta de destino y la carpeta vista (null = por organizar)', () => {
    expect(
      movePhotoBodySchema.parse({ folderId: FOLDER.toUpperCase(), fromFolderId: null }),
    ).toEqual({ folderId: FOLDER, fromFolderId: null });
    expect(movePhotoBodySchema.safeParse({ folderId: FOLDER }).success).toBe(false);
    expect(movePhotoBodySchema.safeParse({ fromFolderId: null }).success).toBe(false);
    // Ninguna foto vuelve a quedar sin carpeta.
    expect(movePhotoBodySchema.safeParse({ folderId: null, fromFolderId: FOLDER }).success).toBe(
      false,
    );
    expect(movePhotoBodySchema.safeParse({ folderId: 'x', fromFolderId: null }).success).toBe(
      false,
    );
  });

  it('galería: `folder` = none o UUID; subida: carpeta opcional', () => {
    expect(listPhotosQuerySchema.parse({ folder: 'none' }).folder).toBe('none');
    expect(listPhotosQuerySchema.parse({ folder: FOLDER.toUpperCase() }).folder).toBe(FOLDER);
    expect(listPhotosQuerySchema.safeParse({ folder: 'todas' }).success).toBe(false);
    expect(uploadPhotoQuerySchema.parse({ category: 'MEMORY' }).folderId).toBeUndefined();
    expect(uploadPhotoQuerySchema.parse({ category: 'MEMORY', folderId: FOLDER }).folderId).toBe(
      FOLDER,
    );
  });
});

describe('permisos y orden', () => {
  it('renombra y elimina quien la creó o un ADMIN; otro usuario no', () => {
    expect(photoFolderPermissions(CREATOR, CREATOR.userId)).toEqual({
      canRename: true,
      canDelete: true,
    });
    expect(photoFolderPermissions(ADMIN, CREATOR.userId)).toEqual({
      canRename: true,
      canDelete: true,
    });
    expect(photoFolderPermissions(STRANGER, CREATOR.userId)).toEqual({
      canRename: false,
      canDelete: false,
    });
  });

  it('por nombre en español (números naturales, sin mayúsculas ni tildes) con desempate estable', () => {
    const folders = [
      { id: '3', name: 'carpeta 10' },
      { id: '2', name: 'Árboles' },
      { id: '1', name: 'Carpeta 2' },
      { id: '5', name: 'arboles' },
      { id: '4', name: 'arboles' },
    ];
    expect([...folders].sort(comparePhotoFolders).map((folder) => folder.id)).toEqual([
      '4',
      '5',
      '2',
      '1',
      '3',
    ]);
  });
});

describe('listado de carpetas', () => {
  it('dos sentencias fijas: carpetas vigentes y un GROUP BY por carpeta; nunca una por tarjeta', async () => {
    db.photoFolder.findMany.mockResolvedValue([
      folderRow({ id: OTHER_FOLDER, name: 'Visitas', createdByUserId: STRANGER.userId }),
      folderRow(),
    ]);
    db.fileAsset.groupBy.mockResolvedValue([
      { folderId: null, _count: { _all: 4 } },
      { folderId: FOLDER, _count: { _all: 2 } },
    ]);
    const result = await listPhotoFolders(CREATOR);
    expect(db.photoFolder.findMany.mock.calls[0]?.[0].where).toEqual({ deletedAt: null });
    expect(db.fileAsset.groupBy.mock.calls[0]?.[0]).toMatchObject({
      by: ['folderId'],
      where: { status: 'AVAILABLE', category: { in: ['TASK_EVIDENCE', 'MEMORY'] } },
    });
    expect(db.fileAsset.count).not.toHaveBeenCalled();
    expect(db.fileAsset.findMany).not.toHaveBeenCalled();
    expect(result.folders.map((folder) => [folder.name, folder.photoCount])).toEqual([
      ['Jardín', 2],
      ['Visitas', 0],
    ]);
    expect(result.folders.map((folder) => folder.permissions.canRename)).toEqual([true, false]);
    expect(result.unfiled).toEqual({ photoCount: 4 });
    expect(result.all).toEqual({ photoCount: 6 });
    expect(result.photoStorage).toBe('unconfigured');
    expect(JSON.stringify(result)).not.toMatch(/nameKey|createdByUserId|objectKey/);
  });
});

describe('crear', () => {
  it('ADMIN y EMPLOYEE crean; autor = sesión, clave en minúsculas y auditoría; sin copias en Drive', async () => {
    for (const actor of [ADMIN, CREATOR]) {
      db.photoFolder.findFirst.mockResolvedValue(null);
      db.photoFolder.create.mockResolvedValue(folderRow({ createdByUserId: actor.userId }));
      const result = await createPhotoFolder(actor, { name: 'Jardín' }, META, KEY);
      expect(result).toMatchObject({
        kind: 'created',
        body: { folder: { id: FOLDER, name: 'Jardín', photoCount: 0, version: 1 } },
      });
      expect(db.photoFolder.create.mock.calls.at(-1)?.[0].data).toEqual({
        name: 'Jardín',
        nameKey: 'jardín',
        createdByUserId: actor.userId,
      });
    }
    expect(audits().map((audit) => [audit.action, audit.actorUserId])).toEqual([
      ['photo_folder.created', ADMIN.userId],
      ['photo_folder.created', CREATOR.userId],
    ]);
    expect(db.driveBackupJob.create).not.toHaveBeenCalled();
  });

  it('exige Idempotency-Key antes de tocar la base', async () => {
    await expect(
      createPhotoFolder(CREATOR, { name: 'Jardín' }, META, undefined),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_INVALID' });
    await expect(createPhotoFolder(CREATOR, { name: 'Jardín' }, META, 'x')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_INVALID',
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('un nombre vigente igual (sin mayúsculas ni espacios) es 409, también si gana otra solicitud (P2002)', async () => {
    db.photoFolder.findFirst.mockResolvedValue({ id: OTHER_FOLDER });
    await expect(createPhotoFolder(CREATOR, { name: 'JARDÍN' }, META, KEY)).rejects.toMatchObject({
      code: 'PHOTO_FOLDER_NAME_TAKEN',
    });
    expect(db.photoFolder.findFirst.mock.calls[0]?.[0].where).toEqual({
      nameKey: 'jardín',
      deletedAt: null,
    });
    expect(db.photoFolder.create).not.toHaveBeenCalled();

    db.photoFolder.findFirst.mockResolvedValue(null);
    db.photoFolder.create.mockRejectedValue(uniqueViolation());
    await expect(createPhotoFolder(CREATOR, { name: 'Jardín' }, META, KEY)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PHOTO_FOLDER_NAME_TAKEN',
    });
    expect(audits()).toHaveLength(0);
  });
});

describe('renombrar', () => {
  it('quien la creó y un ADMIN renombran; otro usuario recibe 403 sin escribir', async () => {
    db.photoFolder.findFirst.mockResolvedValueOnce(folderRow());
    await expect(
      renamePhotoFolder(STRANGER, FOLDER, { name: 'Huerta', version: 1 }, META),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(db.photoFolder.updateMany).not.toHaveBeenCalled();

    for (const actor of [CREATOR, ADMIN]) {
      db.photoFolder.findFirst.mockResolvedValueOnce(folderRow()).mockResolvedValueOnce(null);
      db.photoFolder.updateMany.mockResolvedValueOnce({ count: 1 });
      db.fileAsset.count.mockResolvedValueOnce(3);
      const result = await renamePhotoFolder(actor, FOLDER, { name: 'Huerta', version: 1 }, META);
      expect(result.folder).toMatchObject({ name: 'Huerta', version: 2, photoCount: 3 });
    }
    expect(db.photoFolder.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: FOLDER, version: 1, deletedAt: null },
      data: { name: 'Huerta', nameKey: 'huerta', version: { increment: 1 } },
    });
    expect(audits()[0]).toMatchObject({
      action: 'photo_folder.renamed',
      previousState: { name: 'Jardín', version: 1 },
      newState: { name: 'Huerta', version: 2 },
    });
  });

  it('el mismo nombre efectivo no escribe ni audita, aunque la versión vista sea vieja', async () => {
    db.photoFolder.findFirst.mockResolvedValue(folderRow({ version: 4 }));
    db.fileAsset.count.mockResolvedValue(0);
    const result = await renamePhotoFolder(CREATOR, FOLDER, { name: 'Jardín', version: 1 }, META);
    expect(result.folder).toMatchObject({ name: 'Jardín', version: 4 });
    expect(db.photoFolder.updateMany).not.toHaveBeenCalled();
    expect(audits()).toHaveLength(0);
  });

  it('cambiar solo mayúsculas es un cambio real (sin chocar consigo misma)', async () => {
    db.photoFolder.findFirst.mockResolvedValue(folderRow());
    db.photoFolder.updateMany.mockResolvedValue({ count: 1 });
    db.fileAsset.count.mockResolvedValue(0);
    await renamePhotoFolder(CREATOR, FOLDER, { name: 'JARDÍN', version: 1 }, META);
    // Misma clave: no busca duplicados.
    expect(db.photoFolder.findFirst).toHaveBeenCalledTimes(1);
    expect(db.photoFolder.updateMany).toHaveBeenCalledTimes(1);
  });

  it('versión vieja = 409; nombre de otra vigente = 409; carpeta eliminada o inexistente = 404', async () => {
    db.photoFolder.findFirst.mockResolvedValueOnce(folderRow({ version: 2 }));
    await expect(
      renamePhotoFolder(CREATOR, FOLDER, { name: 'Huerta', version: 1 }, META),
    ).rejects.toMatchObject({ code: 'PHOTO_FOLDER_VERSION_CONFLICT' });

    db.photoFolder.findFirst
      .mockResolvedValueOnce(folderRow())
      .mockResolvedValueOnce({ id: OTHER_FOLDER });
    await expect(
      renamePhotoFolder(CREATOR, FOLDER, { name: 'Visitas', version: 1 }, META),
    ).rejects.toMatchObject({ code: 'PHOTO_FOLDER_NAME_TAKEN' });
    expect(db.photoFolder.findFirst.mock.calls[2]?.[0].where).toEqual({
      nameKey: 'visitas',
      deletedAt: null,
      NOT: { id: FOLDER },
    });

    db.photoFolder.findFirst.mockResolvedValueOnce(null);
    await expect(
      renamePhotoFolder(CREATOR, FOLDER, { name: 'Huerta', version: 1 }, META),
    ).rejects.toMatchObject({ statusCode: 404, code: 'PHOTO_FOLDER_NOT_FOUND' });
    expect(db.photoFolder.updateMany).not.toHaveBeenCalled();
  });

  it('pierde la carrera contra otra escritura confirmada: conflicto (o 404 si la eliminaron), sin auditar', async () => {
    // Primera lectura: la carpeta; búsqueda de duplicados (`NOT: { id }`): ninguno.
    db.photoFolder.findFirst.mockImplementation(async (args: { where: { NOT?: unknown } }) =>
      args.where.NOT ? null : folderRow(),
    );
    db.photoFolder.updateMany.mockResolvedValue({ count: 0 });
    db.photoFolder.findUnique.mockResolvedValueOnce({ deletedAt: null });
    await expect(
      renamePhotoFolder(CREATOR, FOLDER, { name: 'Huerta', version: 1 }, META),
    ).rejects.toMatchObject({ code: 'PHOTO_FOLDER_VERSION_CONFLICT' });
    db.photoFolder.findUnique.mockResolvedValueOnce({ deletedAt: NOW });
    await expect(
      renamePhotoFolder(CREATOR, FOLDER, { name: 'Huerta', version: 1 }, META),
    ).rejects.toMatchObject({ code: 'PHOTO_FOLDER_NOT_FOUND' });
    db.photoFolder.updateMany.mockRejectedValueOnce(uniqueViolation());
    await expect(
      renamePhotoFolder(CREATOR, FOLDER, { name: 'Huerta', version: 1 }, META),
    ).rejects.toMatchObject({ code: 'PHOTO_FOLDER_NAME_TAKEN' });
    expect(audits()).toHaveLength(0);
  });
});

describe('eliminar', () => {
  const locked = (overrides: Record<string, unknown> = {}) => [
    {
      name: 'Jardín',
      version: 1,
      created_by_user_id: CREATOR.userId,
      deleted_at: null,
      ...overrides,
    },
  ];
  const sqlOf = (call: unknown[]) => (call[0] as { strings?: string[] }).strings?.join('?') ?? '';

  it('bloquea la fila ANTES de contar y, vacía, la marca eliminada (lógico) con auditoría', async () => {
    db.$queryRaw.mockResolvedValue(locked());
    db.fileAsset.count.mockResolvedValue(0);
    db.photoFolder.update.mockResolvedValue({});
    const result = await deletePhotoFolder(ADMIN, FOLDER, { version: 1 }, META, NOW);
    expect(result).toEqual({ folder: { id: FOLDER, deleted: true } });
    expect(sqlOf(db.$queryRaw.mock.calls[0] as unknown[])).toMatch(
      /FROM "photo_folders".*FOR UPDATE/,
    );
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.fileAsset.count.mock.invocationCallOrder[0] ?? 0,
    );
    expect(db.fileAsset.count.mock.calls[0]?.[0].where).toEqual({
      status: 'AVAILABLE',
      category: { in: ['TASK_EVIDENCE', 'MEMORY'] },
      folderId: FOLDER,
    });
    expect(db.photoFolder.update.mock.calls[0]?.[0]).toEqual({
      where: { id: FOLDER },
      data: { deletedAt: NOW, deletedByUserId: ADMIN.userId, version: { increment: 1 } },
    });
    expect(audits()[0]).toMatchObject({
      action: 'photo_folder.deleted',
      previousState: { name: 'Jardín', version: 1, deleted: false },
      newState: { deleted: true, version: 2, moderated: true },
    });
    expect(db.fileAsset.updateMany).not.toHaveBeenCalled();
    expect(db.driveBackupJob.create).not.toHaveBeenCalled();
  });

  it('con fotos vigentes: 409 sin tocar la carpeta ni sus fotos', async () => {
    db.$queryRaw.mockResolvedValue(locked());
    db.fileAsset.count.mockResolvedValue(1);
    await expect(
      deletePhotoFolder(CREATOR, FOLDER, { version: 1 }, META, NOW),
    ).rejects.toMatchObject({
      code: 'PHOTO_FOLDER_NOT_EMPTY',
    });
    expect(db.photoFolder.update).not.toHaveBeenCalled();
    expect(db.fileAsset.updateMany).not.toHaveBeenCalled();
    expect(audits()).toHaveLength(0);
  });

  it('otro usuario 403; versión vieja 409; inexistente 404', async () => {
    db.$queryRaw.mockResolvedValueOnce(locked());
    await expect(
      deletePhotoFolder(STRANGER, FOLDER, { version: 1 }, META, NOW),
    ).rejects.toMatchObject({ statusCode: 403 });
    db.$queryRaw.mockResolvedValueOnce(locked({ version: 2 }));
    await expect(
      deletePhotoFolder(CREATOR, FOLDER, { version: 1 }, META, NOW),
    ).rejects.toMatchObject({
      code: 'PHOTO_FOLDER_VERSION_CONFLICT',
    });
    db.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      deletePhotoFolder(CREATOR, FOLDER, { version: 1 }, META, NOW),
    ).rejects.toMatchObject({
      code: 'PHOTO_FOLDER_NOT_FOUND',
    });
    expect(db.photoFolder.update).not.toHaveBeenCalled();
  });

  it('repetir la eliminación responde lo mismo sin escribir ni auditar', async () => {
    db.$queryRaw.mockResolvedValue(locked({ deleted_at: NOW, version: 2 }));
    const result = await deletePhotoFolder(CREATOR, FOLDER, { version: 1 }, META, NOW);
    expect(result).toEqual({ folder: { id: FOLDER, deleted: true } });
    expect(db.fileAsset.count).not.toHaveBeenCalled();
    expect(db.photoFolder.update).not.toHaveBeenCalled();
    expect(audits()).toHaveLength(0);
  });
});

describe('mover', () => {
  it('cambia SOLO la carpeta (comparando la vista) tras bloquear el destino; auditado; sin Drive', async () => {
    db.fileAsset.findFirst.mockResolvedValue(photoRow(null));
    db.$queryRaw.mockResolvedValue([{ id: FOLDER }]);
    db.fileAsset.updateMany.mockResolvedValue({ count: 1 });
    const result = await movePhoto(CREATOR, PHOTO, { folderId: FOLDER, fromFolderId: null }, META);
    expect(result).toEqual({
      moved: true,
      photo: expect.objectContaining({ id: PHOTO, title: 'Rosas', folderId: FOLDER }),
    });
    expect(
      ((db.$queryRaw.mock.calls[0] as unknown[])[0] as { strings: string[] }).strings.join('?'),
    ).toMatch(/"deleted_at" IS NULL FOR KEY SHARE/);
    expect(db.fileAsset.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: PHOTO, status: 'AVAILABLE', folderId: null },
      data: { folderId: FOLDER },
    });
    expect(audits()[0]).toMatchObject({
      action: 'photo.moved',
      entityType: 'FileAsset',
      entityId: PHOTO,
      previousState: { folderId: null },
      newState: { folderId: FOLDER },
    });
    expect(db.driveBackupJob.create).not.toHaveBeenCalled();
  });

  it('entre carpetas: cualquier usuario activo, con el destino bloqueado', async () => {
    db.fileAsset.findFirst.mockResolvedValue(photoRow(FOLDER));
    db.$queryRaw.mockResolvedValue([{ id: OTHER_FOLDER }]);
    db.fileAsset.updateMany.mockResolvedValue({ count: 1 });
    const result = await movePhoto(
      STRANGER,
      PHOTO,
      { folderId: OTHER_FOLDER, fromFolderId: FOLDER },
      META,
    );
    expect(result.photo.folderId).toBe(OTHER_FOLDER);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.fileAsset.updateMany.mock.calls[0]?.[0].where).toMatchObject({ folderId: FOLDER });
  });

  it('al destino actual no escribe ni audita', async () => {
    db.fileAsset.findFirst.mockResolvedValue(photoRow(FOLDER));
    const result = await movePhoto(CREATOR, PHOTO, { folderId: FOLDER, fromFolderId: null }, META);
    expect(result).toMatchObject({ moved: false, photo: { folderId: FOLDER } });
    expect(db.fileAsset.updateMany).not.toHaveBeenCalled();
    expect(audits()).toHaveLength(0);
  });

  it('si otra persona la movió (no está donde la vio): 409 sin pisar', async () => {
    db.$queryRaw.mockResolvedValue([{ id: OTHER_FOLDER }]);
    db.fileAsset.findFirst.mockResolvedValue(photoRow(THIRD_FOLDER));
    await expect(
      movePhoto(CREATOR, PHOTO, { folderId: OTHER_FOLDER, fromFolderId: FOLDER }, META),
    ).rejects.toMatchObject({ code: 'PHOTO_MOVE_CONFLICT' });
    // Carrera: leyó la misma carpeta pero otra transacción escribió antes.
    db.fileAsset.findFirst
      .mockResolvedValueOnce(photoRow(FOLDER))
      .mockResolvedValueOnce({ id: PHOTO });
    db.fileAsset.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      movePhoto(CREATOR, PHOTO, { folderId: OTHER_FOLDER, fromFolderId: FOLDER }, META),
    ).rejects.toMatchObject({ code: 'PHOTO_MOVE_CONFLICT' });
    // ... o la eliminaron mientras tanto.
    db.fileAsset.findFirst.mockResolvedValueOnce(photoRow(FOLDER)).mockResolvedValueOnce(null);
    await expect(
      movePhoto(CREATOR, PHOTO, { folderId: OTHER_FOLDER, fromFolderId: FOLDER }, META),
    ).rejects.toMatchObject({ code: 'PHOTO_NOT_FOUND' });
    expect(audits()).toHaveLength(0);
  });

  it('destino eliminado: 409 sin mover a otro lado', async () => {
    db.fileAsset.findFirst.mockResolvedValue(photoRow(null));
    db.$queryRaw.mockResolvedValue([]);
    await expect(
      movePhoto(CREATOR, PHOTO, { folderId: FOLDER, fromFolderId: null }, META),
    ).rejects.toMatchObject({ code: 'PHOTO_FOLDER_UNAVAILABLE' });
    expect(db.fileAsset.updateMany).not.toHaveBeenCalled();
  });

  it('una foto no visible (eliminada o de Mascotas/Jardín) no se mueve', async () => {
    db.fileAsset.findFirst.mockResolvedValue(null);
    await expect(
      movePhoto(CREATOR, PHOTO, { folderId: FOLDER, fromFolderId: null }, META),
    ).rejects.toMatchObject({ code: 'PHOTO_NOT_FOUND' });
    expect(db.fileAsset.findFirst.mock.calls[0]?.[0].where).toMatchObject({
      id: PHOTO,
      status: 'AVAILABLE',
      category: { in: ['TASK_EVIDENCE', 'MEMORY'] },
    });
  });
});

describe('galería por carpeta', () => {
  beforeEach(() => {
    db.fileAsset.count.mockResolvedValue(0);
    db.fileAsset.findMany.mockResolvedValue([]);
  });

  it('«Sin carpeta» filtra folder_id nulo; sin filtro, todas (como antes)', async () => {
    await listPhotos({ folder: 'none', page: 1, pageSize: 24 });
    expect(db.fileAsset.findMany.mock.calls[0]?.[0].where).toMatchObject({ folderId: null });
    await listPhotos({ page: 1, pageSize: 24 });
    expect(db.fileAsset.findMany.mock.calls[1]?.[0].where).not.toHaveProperty('folderId');
    expect(db.photoFolder.findFirst).not.toHaveBeenCalled();
  });

  it('una carpeta: filtra por ella (con tipo) y 404 si no existe o se eliminó', async () => {
    db.photoFolder.findFirst.mockResolvedValueOnce({ id: FOLDER });
    await listPhotos({ folder: FOLDER, category: 'TASK_EVIDENCE', page: 2, pageSize: 24 });
    expect(db.fileAsset.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { folderId: FOLDER, category: 'TASK_EVIDENCE', status: 'AVAILABLE' },
      skip: 24,
      take: 24,
    });
    expect(db.photoFolder.findFirst.mock.calls[0]?.[0].where).toEqual({
      id: FOLDER,
      deletedAt: null,
    });
    db.photoFolder.findFirst.mockResolvedValueOnce(null);
    await expect(listPhotos({ folder: FOLDER, page: 1, pageSize: 24 })).rejects.toMatchObject({
      code: 'PHOTO_FOLDER_NOT_FOUND',
    });
  });
});

describe('subir a una carpeta', () => {
  const metadata = { title: 'Rosas', category: 'MEMORY' as const, folderId: FOLDER };
  const upload = (key?: string) =>
    uploadPhoto(
      CREATOR,
      { body: JPEG, declaredType: 'image/jpeg', filename: 'x.jpg' },
      metadata,
      META,
      key,
      NOW,
    );

  it('la carpeta se asigna al confirmar, con la carpeta bloqueada; una sola copia en Drive', async () => {
    const putObject = vi.fn(async () => ({ etag: '"e"' }));
    const storage = fakeStorage({ putObject });
    setObjectStorageForTests(storage);
    db.photoFolder.findFirst.mockResolvedValue({ id: FOLDER });
    db.fileAsset.create.mockResolvedValue({ id: PHOTO });
    db.$queryRaw.mockResolvedValue([{ id: FOLDER }]);
    db.fileAsset.updateMany.mockResolvedValue({ count: 1 });
    db.fileAsset.findUniqueOrThrow.mockResolvedValue(photoRow(FOLDER));
    db.driveBackupJob.create.mockResolvedValue({});
    const result = await upload();
    expect(result).toMatchObject({ kind: 'created', body: { photo: { folderId: FOLDER } } });
    // Pendiente sin carpeta: la pertenencia nace recién al confirmar.
    expect(db.fileAsset.create.mock.calls[0]?.[0].data).not.toHaveProperty('folderId');
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeGreaterThan(
      putObject.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(db.fileAsset.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: PHOTO, status: 'PENDING_UPLOAD' },
      data: { status: 'AVAILABLE', etag: '"e"', folderId: FOLDER },
    });
    expect(db.driveBackupJob.create).toHaveBeenCalledTimes(1);
    expect(db.driveBackupJob.create.mock.calls[0]?.[0].data).toMatchObject({
      fileAssetId: PHOTO,
      module: 'fotos',
    });
    expect(audits()[0]).toMatchObject({ action: 'photo.uploaded', newState: { folderId: FOLDER } });
  });

  it('sin carpeta (p. ej. un cliente anterior): 400 propio, sin subir bytes ni tocar la base', async () => {
    const storage = fakeStorage();
    setObjectStorageForTests(storage);
    await expect(
      uploadPhoto(
        CREATOR,
        { body: JPEG, declaredType: 'image/jpeg', filename: 'x.jpg' },
        { title: 'Rosas', category: 'MEMORY' },
        META,
        undefined,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'PHOTO_FOLDER_REQUIRED' });
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(db.fileAsset.create).not.toHaveBeenCalled();
    expect(db.photoFolder.findFirst).not.toHaveBeenCalled();
  });

  it('carpeta eliminada antes de subir: 409 sin subir bytes ni crear registros', async () => {
    const storage = fakeStorage();
    setObjectStorageForTests(storage);
    db.photoFolder.findFirst.mockResolvedValue(null);
    await expect(upload()).rejects.toMatchObject({ code: 'PHOTO_FOLDER_UNAVAILABLE' });
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(db.fileAsset.create).not.toHaveBeenCalled();
  });

  it('carpeta eliminada mientras se subía: 409, el objeto se descarta y la foto nunca queda visible', async () => {
    const storage = fakeStorage();
    setObjectStorageForTests(storage);
    db.photoFolder.findFirst.mockResolvedValue({ id: FOLDER });
    db.fileAsset.create.mockResolvedValue({ id: PHOTO });
    db.$queryRaw.mockResolvedValue([]);
    db.fileAsset.updateMany.mockResolvedValue({ count: 1 });
    await expect(upload()).rejects.toMatchObject({ code: 'PHOTO_FOLDER_UNAVAILABLE' });
    // La única escritura sobre la foto es la baja del objeto sobrante.
    expect(db.fileAsset.updateMany.mock.calls.map((call) => call[0].data.status)).toEqual([
      'PENDING_DELETION',
      'DELETED',
    ]);
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(db.driveBackupJob.create).not.toHaveBeenCalled();
    expect(audits()).toHaveLength(0);
  });
});

describe('aislamiento', () => {
  it('el servicio de carpetas no usa Drive ni el almacenamiento de objetos', () => {
    const source = readFileSync(resolve(__dirname, '../../more/photoFoldersService.ts'), 'utf-8');
    expect(source).not.toMatch(
      /driveBackup|enqueueDriveBackup|getObjectStorage|putObject|deleteObject/,
    );
  });
});
