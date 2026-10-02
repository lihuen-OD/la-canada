import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Encolado de la copia en Drive desde los flujos reales de subida (Etapa 5Z)
 * con un Prisma simulado: el trabajo se crea DENTRO de la transacción que deja
 * la foto `AVAILABLE`, solo si la copia está activada, nunca para el plano del
 * Jardín, y la subida a Neon jamás llama a Google (Drive caído, sin
 * configurar o lento no la afecta).
 */
const db = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    animal: { findUnique: fn() },
    employee: { findUnique: fn() },
    fileAsset: {
      create: fn(),
      update: fn(),
      updateMany: fn(),
      findMany: fn(),
      findFirst: fn(),
      findUniqueOrThrow: fn(),
    },
    driveBackupJob: { create: fn() },
    gardenPlanVersion: { aggregate: fn(), create: fn() },
    idempotencyRecord: { findUnique: fn() },
    auditLog: { create: fn() },
    $queryRaw: fn(),
    $executeRaw: fn(),
    $transaction: fn(),
  };
});
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import { setDriveBackupConfigForTests } from '../../driveBackup/config';
import { setObjectStorageForTests } from '../../lib/objectStorage';
import { deletePhoto, uploadPhoto } from '../../more/photosService';
import { publishGardenPlanVersion } from '../../more/gardenService';
import { uploadPetPhoto } from '../../pets/petPhotoService';
import type { TaskActor } from '../../tasks/tasksService';

const META = { ipAddress: null, userAgent: 'vitest' };
const FILE_ID = '22222222-2222-4222-8222-222222222222';
const PET_ID = '44444444-4444-4444-8444-444444444444';
const ADMIN: TaskActor = { userId: 'user-a', role: 'ADMIN', employeeId: null };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const DEMO = {
  destinationId: 'shared-drive-root-1',
  environment: 'DEMO' as const,
  // Ruta inexistente a propósito: la subida nunca la lee.
  credentialsFile: '/no/existe/credenciales.json',
};

let inTransaction = false;
const fetchSpy = vi.spyOn(globalThis, 'fetch');

beforeEach(() => {
  for (const group of Object.values(db)) {
    if (typeof group === 'function') group.mockReset();
    else for (const method of Object.values(group)) method.mockReset();
  }
  db.$transaction.mockImplementation(async (run: (tx: typeof db) => unknown) => {
    inTransaction = true;
    try {
      return await run(db);
    } finally {
      inTransaction = false;
    }
  });
  db.driveBackupJob.create.mockImplementation(async () => {
    expect(inTransaction).toBe(true);
    return {};
  });
  db.auditLog.create.mockResolvedValue({});
  db.fileAsset.create.mockResolvedValue({ id: FILE_ID });
  db.fileAsset.update.mockResolvedValue({});
  db.fileAsset.updateMany.mockResolvedValue({ count: 1 });
  db.fileAsset.findMany.mockResolvedValue([]);
  db.fileAsset.findUniqueOrThrow.mockResolvedValue({
    id: FILE_ID,
    title: 'Jardín',
    category: 'MEMORY',
    createdAt: new Date('2026-10-02T12:00:00Z'),
    taggedEmployee: null,
  });
  db.animal.findUnique.mockResolvedValue({ active: true });
  db.$queryRaw.mockResolvedValue([{ id: PET_ID }]);
  setObjectStorageForTests({
    bucket: 'bucket-test',
    putObject: vi.fn(async () => ({ etag: '"e"' })),
    getObject: vi.fn(async () => null),
    deleteObject: vi.fn(async () => undefined),
  });
  fetchSpy.mockClear();
  fetchSpy.mockRejectedValue(new Error('Google no debe llamarse durante la subida'));
});
afterEach(() => {
  setDriveBackupConfigForTests(undefined);
  setObjectStorageForTests(undefined);
});

const uploadGallery = () =>
  uploadPhoto(
    ADMIN,
    { body: JPEG, declaredType: 'image/jpeg', filename: 'x.jpg' },
    { category: 'MEMORY', title: 'Jardín' },
    META,
  );
const uploadPet = () =>
  uploadPetPhoto(
    ADMIN,
    PET_ID,
    { body: JPEG, declaredType: 'image/jpeg', filename: undefined },
    META,
  );

describe('integración desactivada (por defecto)', () => {
  it('Fotos y Mascotas suben igual y no crean trabajos de copia', async () => {
    setDriveBackupConfigForTests(null);
    await expect(uploadGallery()).resolves.toMatchObject({ kind: 'created' });
    await expect(uploadPet()).resolves.toEqual({ photo: { id: FILE_ID } });
    expect(db.driveBackupJob.create).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('integración activada', () => {
  beforeEach(() => setDriveBackupConfigForTests(DEMO));

  it('📸 Fotos: el trabajo se crea en la transacción de confirmación, sin llamar a Google', async () => {
    await expect(uploadGallery()).resolves.toMatchObject({ kind: 'created' });
    expect(db.driveBackupJob.create).toHaveBeenCalledWith({
      data: { fileAssetId: FILE_ID, module: 'fotos', environment: 'DEMO' },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('🐾 Mascotas: idem, en la carpeta de mascotas', async () => {
    await expect(uploadPet()).resolves.toEqual({ photo: { id: FILE_ID } });
    expect(db.driveBackupJob.create).toHaveBeenCalledWith({
      data: { fileAssetId: FILE_ID, module: 'mascotas', environment: 'DEMO' },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('si la confirmación falla, tampoco queda el trabajo (misma transacción)', async () => {
    db.fileAsset.updateMany.mockResolvedValueOnce({ count: 0 }); // la foto no quedó AVAILABLE
    await expect(uploadGallery()).rejects.toBeDefined();
    expect(db.driveBackupJob.create).not.toHaveBeenCalled();
  });

  it('subida a Neon fallida: ni foto ni trabajo de copia', async () => {
    setObjectStorageForTests({
      bucket: 'bucket-test',
      putObject: vi.fn(async () => {
        throw new Error('neon caído');
      }),
      getObject: vi.fn(async () => null),
      deleteObject: vi.fn(async () => undefined),
    });
    await expect(uploadGallery()).rejects.toMatchObject({ code: 'OBJECT_STORAGE_UNAVAILABLE' });
    expect(db.driveBackupJob.create).not.toHaveBeenCalled();
  });

  it('🌳 el plano del Jardín no es una fotografía: no se copia', async () => {
    db.gardenPlanVersion.aggregate.mockResolvedValue({ _max: { versionNumber: 1 } });
    db.gardenPlanVersion.create.mockResolvedValue({
      id: 'v2',
      versionNumber: 2,
      createdAt: new Date(),
      fileAsset: { sizeBytes: JPEG.length, mimeType: 'image/jpeg' },
      publishedBy: { username: 'admin', employee: null, profile: null },
    });
    await publishGardenPlanVersion(
      ADMIN,
      { body: JPEG, declaredType: 'image/jpeg', filename: 'plano.jpg' },
      META,
    );
    expect(db.driveBackupJob.create).not.toHaveBeenCalled();
  });

  it('eliminar una foto no toca la cola ni Drive (la copia completada se conserva)', async () => {
    db.fileAsset.findFirst.mockResolvedValue({
      id: FILE_ID,
      objectKey: 'memories/2026/x.jpg',
      category: 'MEMORY',
      taggedEmployeeId: null,
    });
    await deletePhoto(ADMIN, FILE_ID, META);
    expect(db.driveBackupJob.create).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
