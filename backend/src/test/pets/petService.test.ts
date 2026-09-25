import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reglas de 🐾 Mascotas con un Prisma simulado mínimo: permisos por rol,
 * persona/actor, fechas de negocio, tipos precargados y el flujo de foto
 * con un almacenamiento en memoria. La SQL real se prueba contra `demo`
 * en `pets.integration.test.ts`.
 */
const db = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    animal: {
      findUnique: fn(),
      create: fn(),
      update: fn(),
      findMany: fn(),
      count: fn(),
      groupBy: fn(),
    },
    animalType: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
      updateMany: fn(),
    },
    animalMedicalRecord: {
      create: fn(),
      findUnique: fn(),
      updateMany: fn(),
      groupBy: fn(),
      findMany: fn(),
      count: fn(),
    },
    fileAsset: { create: fn(), update: fn(), updateMany: fn(), findMany: fn(), findFirst: fn() },
    auditLog: { create: fn() },
    $queryRaw: fn(),
    $transaction: fn(),
  };
});
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import { setObjectStorageForTests, type ObjectStorageClient } from '../../lib/objectStorage';
import {
  createPet,
  createPetRecord,
  createPetType,
  deactivatePetType,
  updatePet,
  voidPetRecord,
  type PetActor,
} from '../../pets/petService';
import { readPetPhoto, removePetPhoto, uploadPetPhoto } from '../../pets/petPhotoService';

const META = { ipAddress: null, userAgent: 'vitest' };
const PET_ID = '22222222-2222-4222-8222-222222222222';
const TYPE_ID = '33333333-3333-4333-8333-333333333333';
const EMPLOYEE: PetActor = { userId: 'user-e', role: 'EMPLOYEE', employeeId: 'emp-1' };
const ADMIN: PetActor = { userId: 'user-a', role: 'ADMIN', employeeId: null };
/** 23:30 del 25/09 en Buenos Aires = 02:30 UTC del 26/09. */
const NOW = new Date('2026-09-26T02:30:00Z');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function fakeStorage(overrides: Partial<ObjectStorageClient> = {}) {
  return {
    bucket: 'bucket-test',
    putObject: vi.fn(async () => ({ etag: '"e"' })),
    getObject: vi.fn(async () => ({ body: JPEG, contentType: 'image/jpeg', etag: null })),
    deleteObject: vi.fn(async () => undefined),
    ...overrides,
  };
}

beforeEach(() => {
  for (const group of Object.values(db)) {
    if (typeof group === 'function') group.mockReset();
    else for (const method of Object.values(group)) method.mockReset();
  }
  db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
  db.auditLog.create.mockResolvedValue({});
  setObjectStorageForTests(null);
});
afterEach(() => setObjectStorageForTests(undefined));

describe('permisos ADMIN (admin-only del prototipo)', () => {
  it.each([
    ['agregar mascota', () => createPet(EMPLOYEE, { name: 'X', animalTypeId: TYPE_ID }, META)],
    ['editar mascota', () => updatePet(EMPLOYEE, PET_ID, { name: 'X' }, META)],
    ['agregar tipo', () => createPetType(EMPLOYEE, { name: 'Ternero', icon: '🐂' }, META)],
    ['eliminar tipo', () => deactivatePetType(EMPLOYEE, TYPE_ID, META)],
    ['eliminar registro', () => voidPetRecord(EMPLOYEE, PET_ID, PET_ID, META)],
    [
      'cambiar foto',
      () =>
        uploadPetPhoto(
          EMPLOYEE,
          PET_ID,
          { body: JPEG, declaredType: 'image/jpeg', filename: undefined },
          META,
        ),
    ],
    ['quitar foto', () => removePetPhoto(EMPLOYEE, PET_ID, META)],
  ])('EMPLOYEE no puede %s y no se toca la base', async (_label, run) => {
    await expect(run()).rejects.toMatchObject({ statusCode: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('tipos', () => {
  it('los precargados no se dan de baja; los agregados, sí (baja lógica auditada)', async () => {
    db.animalType.findUnique.mockResolvedValueOnce({
      id: TYPE_ID,
      name: 'Perro',
      icon: '🐕',
      active: true,
    });
    await expect(deactivatePetType(ADMIN, TYPE_ID, META)).rejects.toMatchObject({
      code: 'PET_TYPE_BUILTIN',
    });
    db.animalType.findUnique.mockResolvedValueOnce({
      id: TYPE_ID,
      name: 'Ternero',
      icon: '🐂',
      active: true,
    });
    db.animalType.updateMany.mockResolvedValue({ count: 1 });
    const result = await deactivatePetType(ADMIN, TYPE_ID, META);
    expect(result.type).toMatchObject({ active: false, builtin: false });
    expect(db.auditLog.create.mock.calls[0]?.[0].data.action).toBe('pet.type.deactivated');
  });

  it('duplicado activo → 409 "Este tipo ya existe."; inactivo → se reactiva con su nuevo símbolo', async () => {
    db.animalType.findFirst.mockResolvedValueOnce({
      id: TYPE_ID,
      name: 'Ternero',
      icon: '🐂',
      active: true,
    });
    await expect(createPetType(ADMIN, { name: 'Ternero', icon: '🐂' }, META)).rejects.toMatchObject(
      {
        message: 'Este tipo ya existe.',
      },
    );
    db.animalType.findFirst.mockResolvedValueOnce({
      id: TYPE_ID,
      name: 'Ternero',
      icon: '🐂',
      active: false,
    });
    db.animalType.update.mockResolvedValue({
      id: TYPE_ID,
      name: 'Ternero',
      icon: '🐃',
      active: true,
    });
    await createPetType(ADMIN, { name: 'ternero', icon: '🐃' }, META);
    expect(db.animalType.update.mock.calls[0]?.[0].data).toEqual({ active: true, icon: '🐃' });
    expect(db.animalType.create).not.toHaveBeenCalled();
  });
});

describe('registros clínicos', () => {
  beforeEach(() => {
    db.animal.findUnique.mockResolvedValue({ active: true });
    db.animalMedicalRecord.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'rec-1',
        type: data.type,
        recordDate: data.recordDate,
        description: data.description,
        value: data.value,
        createdAt: NOW,
        employee: null,
      }),
    );
  });

  it('EMPLOYEE: persona = su empleado, actor = su usuario; fecha según BUSINESS_TIME_ZONE', async () => {
    await createPetRecord(
      EMPLOYEE,
      PET_ID,
      { type: 'VACCINE', recordDate: '2026-09-25' },
      META,
      NOW,
    );
    const data = db.animalMedicalRecord.create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({ employeeId: 'emp-1', recordedByUserId: 'user-e', value: null });
    // En UTC ya es 26/09, en Buenos Aires todavía 25/09: el 26 es futuro.
    await expect(
      createPetRecord(EMPLOYEE, PET_ID, { type: 'VACCINE', recordDate: '2026-09-26' }, META, NOW),
    ).rejects.toMatchObject({ statusCode: 400, message: 'La fecha no puede ser futura.' });
  });

  it('ADMIN sin empleado: sin persona (como el prototipo), actor real el ADMIN; peso como Decimal', async () => {
    await createPetRecord(
      ADMIN,
      PET_ID,
      { type: 'WEIGHT', recordDate: '2026-09-01', weightKg: '12.5' },
      META,
      NOW,
    );
    const data = db.animalMedicalRecord.create.mock.calls[0]?.[0].data;
    expect(data.employeeId).toBeNull();
    expect(data.recordedByUserId).toBe('user-a');
    expect(data.value.toString()).toBe('12.5');
  });

  it('EMPLOYEE sin empleado vinculado → 409; mascota inexistente → 404', async () => {
    await expect(
      createPetRecord(
        { ...EMPLOYEE, employeeId: null },
        PET_ID,
        { type: 'VACCINE', recordDate: '2026-09-25' },
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'EMPLOYEE_LINK_REQUIRED' });
    db.animal.findUnique.mockResolvedValue(null);
    await expect(
      createPetRecord(EMPLOYEE, PET_ID, { type: 'VACCINE', recordDate: '2026-09-25' }, META, NOW),
    ).rejects.toMatchObject({ code: 'PET_NOT_FOUND' });
  });

  it('anular: condicionado a voidedAt null; de otra mascota → 404; ya anulado → 409', async () => {
    db.animalMedicalRecord.findUnique.mockResolvedValueOnce({
      animalId: 'otra',
      type: 'VACCINE',
      recordDate: NOW,
      value: null,
    });
    await expect(voidPetRecord(ADMIN, PET_ID, 'rec-1', META)).rejects.toMatchObject({
      statusCode: 404,
    });
    db.animalMedicalRecord.findUnique.mockResolvedValue({
      animalId: PET_ID,
      type: 'VACCINE',
      recordDate: NOW,
      value: null,
    });
    db.animalMedicalRecord.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(voidPetRecord(ADMIN, PET_ID, 'rec-1', META)).rejects.toMatchObject({
      code: 'PET_RECORD_ALREADY_VOIDED',
    });
    db.animalMedicalRecord.updateMany.mockResolvedValueOnce({ count: 1 });
    await voidPetRecord(ADMIN, PET_ID, 'rec-1', META, NOW);
    expect(db.animalMedicalRecord.updateMany.mock.calls[1]?.[0]).toEqual({
      where: { id: 'rec-1', voidedAt: null },
      data: { voidedAt: NOW, voidedByUserId: 'user-a' },
    });
  });
});

describe('ficha', () => {
  it('fecha de nacimiento futura rechazada; tipo inactivo no se asigna', async () => {
    await expect(
      createPet(ADMIN, { name: 'X', animalTypeId: TYPE_ID, birthDate: '2026-09-26' }, META, NOW),
    ).rejects.toMatchObject({ statusCode: 400 });
    db.animalType.findUnique.mockResolvedValue({ active: false });
    await expect(
      createPet(ADMIN, { name: 'X', animalTypeId: TYPE_ID }, META, NOW),
    ).rejects.toMatchObject({
      code: 'PET_TYPE_INVALID',
    });
  });
});

describe('fotos', () => {
  it('sin OBJECT_STORAGE_* configurado → 503 claro, sin escribir nada', async () => {
    await expect(
      uploadPetPhoto(
        ADMIN,
        PET_ID,
        { body: JPEG, declaredType: 'image/jpeg', filename: undefined },
        META,
      ),
    ).rejects.toMatchObject({ statusCode: 503, code: 'OBJECT_STORAGE_NOT_CONFIGURED' });
    await expect(readPetPhoto(PET_ID)).rejects.toMatchObject({ statusCode: 503 });
    expect(db.fileAsset.create).not.toHaveBeenCalled();
  });

  it('tipo real distinto del declarado (o no imagen) → 415, antes de tocar la base', async () => {
    setObjectStorageForTests(fakeStorage());
    for (const [body, declaredType] of [
      [JPEG, 'image/png'],
      [Buffer.from('<svg/>'), 'image/png'],
      [Buffer.alloc(0), 'image/jpeg'],
    ] as const) {
      await expect(
        uploadPetPhoto(ADMIN, PET_ID, { body, declaredType, filename: undefined }, META),
      ).rejects.toMatchObject({ statusCode: 415 });
    }
    expect(db.fileAsset.create).not.toHaveBeenCalled();
  });

  it('flujo: PENDING_UPLOAD → PUT → AVAILABLE; la anterior pasa a baja lógica y luego se borra', async () => {
    const storage = fakeStorage();
    setObjectStorageForTests(storage);
    db.animal.findUnique.mockResolvedValue({ id: PET_ID });
    db.fileAsset.create.mockResolvedValue({ id: 'file-new' });
    db.$queryRaw.mockResolvedValue([{ id: PET_ID }]);
    db.fileAsset.findMany.mockResolvedValue([{ id: 'file-old', objectKey: 'animals/x/old.jpg' }]);
    db.fileAsset.updateMany.mockResolvedValue({ count: 1 });
    db.fileAsset.update.mockResolvedValue({});

    const result = await uploadPetPhoto(
      ADMIN,
      PET_ID,
      { body: JPEG, declaredType: 'image/jpeg', filename: 'rex.jpg' },
      META,
      NOW,
    );
    expect(result).toEqual({ photo: { id: 'file-new' } });
    const created = db.fileAsset.create.mock.calls[0]?.[0].data;
    expect(created).toMatchObject({
      provider: 'NEON_OBJECT_STORAGE',
      bucket: 'bucket-test',
      mimeType: 'image/jpeg',
      sizeBytes: JPEG.length,
      category: 'ANIMAL_PROFILE',
      animalId: PET_ID,
      originalFilename: 'rex.jpg',
    });
    expect(created.objectKey).toMatch(new RegExp(`^animals/${PET_ID}/[0-9a-f-]{36}\\.jpg$`));
    expect(created).not.toHaveProperty('status'); // arranca en PENDING_UPLOAD (default)
    expect(storage.putObject).toHaveBeenCalledWith(created.objectKey, JPEG, 'image/jpeg');
    expect(db.fileAsset.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: { in: ['file-old'] }, status: 'AVAILABLE' },
      data: { status: 'PENDING_DELETION', deletedAt: NOW },
    });
    expect(storage.deleteObject).toHaveBeenCalledWith('animals/x/old.jpg');
    expect(db.fileAsset.updateMany.mock.calls[1]?.[0]).toEqual({
      where: { id: 'file-old', status: 'PENDING_DELETION' },
      data: { status: 'DELETED' },
    });
  });

  it('falla del proveedor → UPLOAD_FAILED + 502 reintentable (la foto vigente no se toca)', async () => {
    setObjectStorageForTests(
      fakeStorage({ putObject: vi.fn(async () => Promise.reject(new Error('boom'))) }),
    );
    db.animal.findUnique.mockResolvedValue({ id: PET_ID });
    db.fileAsset.create.mockResolvedValue({ id: 'file-new' });
    await expect(
      uploadPetPhoto(
        ADMIN,
        PET_ID,
        { body: JPEG, declaredType: 'image/jpeg', filename: undefined },
        META,
      ),
    ).rejects.toMatchObject({ statusCode: 502, code: 'OBJECT_STORAGE_UNAVAILABLE' });
    expect(db.fileAsset.update).toHaveBeenCalledWith({
      where: { id: 'file-new' },
      data: { status: 'UPLOAD_FAILED' },
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
