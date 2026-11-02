import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';

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
      updateMany: fn(),
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
      findUniqueOrThrow: fn(),
      updateMany: fn(),
      groupBy: fn(),
      findMany: fn(),
      count: fn(),
    },
    fileAsset: { create: fn(), update: fn(), updateMany: fn(), findMany: fn(), findFirst: fn() },
    driveBackupJob: { create: fn() },
    auditLog: { create: fn() },
    $queryRaw: fn(),
    $transaction: fn(),
  };
});
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import { setDriveBackupConfigForTests } from '../../driveBackup/config';
import { setObjectStorageForTests, type ObjectStorageClient } from '../../lib/objectStorage';
import {
  createPet,
  createPetRecord,
  deletePet,
  deletePetType,
  updatePetRecordNextDue,
  createPetType,
  listPetRecords,
  listPets,
  setPetActive,
  setPetTypeActive,
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
/** Copia en Drive activada (Etapa 5Z); la subida nunca lee las credenciales. */
const DRIVE_DEMO = {
  destinationId: 'shared-drive-root-1',
  environment: 'DEMO' as const,
  credentialsFile: '/no/existe/credenciales.json',
};

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
  // La copia en Drive la fija cada prueba, nunca el `.env` de la máquina.
  setDriveBackupConfigForTests(null);
});
afterEach(() => {
  setObjectStorageForTests(undefined);
  setDriveBackupConfigForTests(undefined);
});

describe('permisos ADMIN (admin-only del prototipo)', () => {
  it.each([
    ['agregar mascota', () => createPet(EMPLOYEE, { name: 'X', animalTypeId: TYPE_ID }, META)],
    ['editar mascota', () => updatePet(EMPLOYEE, PET_ID, { name: 'X' }, META)],
    ['desactivar mascota', () => setPetActive(EMPLOYEE, PET_ID, false, META)],
    ['eliminar mascota', () => deletePet(EMPLOYEE, PET_ID, META)],
    ['agregar tipo', () => createPetType(EMPLOYEE, { name: 'Ternero', icon: '🐂' }, META)],
    ['desactivar tipo', () => setPetTypeActive(EMPLOYEE, TYPE_ID, false, META)],
    ['eliminar tipo', () => deletePetType(EMPLOYEE, TYPE_ID, META)],
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
    await expect(setPetTypeActive(ADMIN, TYPE_ID, false, META)).rejects.toMatchObject({
      code: 'PET_TYPE_BUILTIN',
    });
    db.animalType.findUnique.mockResolvedValueOnce({
      id: TYPE_ID,
      name: 'Ternero',
      icon: '🐂',
      active: true,
    });
    db.animalType.updateMany.mockResolvedValue({ count: 1 });
    const result = await setPetTypeActive(ADMIN, TYPE_ID, false, META);
    expect(result.type).toMatchObject({ active: false, builtin: false });
    expect(db.auditLog.create.mock.calls[0]?.[0].data.action).toBe('pet.type.deactivated');
    // Reactivar un tipo agregado: condicionado a que esté inactivo, auditado.
    db.animalType.findUnique.mockResolvedValueOnce({
      id: TYPE_ID,
      name: 'Ternero',
      icon: '🐂',
      active: false,
    });
    const reactivated = await setPetTypeActive(ADMIN, TYPE_ID, true, META);
    expect(reactivated.type).toMatchObject({ active: true });
    expect(db.animalType.updateMany).toHaveBeenLastCalledWith({
      where: { id: TYPE_ID, active: false },
      data: { active: true },
    });
    expect(db.auditLog.create.mock.calls[1]?.[0].data.action).toBe('pet.type.reactivated');
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
        nextDueDate: data.nextDueDate ?? null,
        fulfills: null,
        fulfillments: [],
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

  it('historial: sin persona, quien lo registró (cada ADMIN el suyo); con persona, la persona', async () => {
    const row = (id: string, employee: unknown, recordedBy: unknown) => ({
      id,
      type: 'VACCINE',
      recordDate: new Date('2026-09-20T00:00:00.000Z'),
      description: null,
      value: null,
      createdAt: NOW,
      employee,
      recordedBy,
      nextDueDate: null,
      fulfills: null,
      fulfillments: [],
    });
    db.animal.findUnique.mockResolvedValue({ id: PET_ID });
    db.animalMedicalRecord.count.mockResolvedValue(4);
    db.animalMedicalRecord.findMany.mockResolvedValue([
      row('r1', null, { employee: null, personalProfile: { displayName: 'Admin sintética Uno' } }),
      row('r2', null, { employee: null, personalProfile: { displayName: 'Admin sintético Dos' } }),
      row(
        'r3',
        { id: 'emp-1', displayName: 'Persona sintética', colorHex: '#4a7c59' },
        { employee: null, personalProfile: { displayName: 'Admin sintética Uno' } },
      ),
      row('r4', null, null),
    ]);
    const { records } = await listPetRecords(ADMIN, PET_ID, { page: 1, pageSize: 20 });
    expect(
      records.map((record) => [record.employee?.displayName ?? null, record.recordedBy]),
    ).toEqual([
      [null, { displayName: 'Admin sintética Uno' }],
      [null, { displayName: 'Admin sintético Dos' }],
      ['Persona sintética', null],
      [null, null],
    ]);
    // El autor sale de `recordedByUserId` (el alta), nunca de `voidedBy` ni del username.
    const select = db.animalMedicalRecord.findMany.mock.calls[0]?.[0].select;
    expect(select).toHaveProperty('recordedBy');
    expect(select).not.toHaveProperty('voidedBy');
    expect(JSON.stringify(select)).not.toContain('username');
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
    // Ya anulado: una sola auditoría (la del intento que anuló).
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('EMPLOYEE anula un registro de otro autor: solo marca la anulación (quién y cuándo) y audita', async () => {
    db.animalMedicalRecord.findUnique.mockResolvedValue({
      animalId: PET_ID,
      type: 'VACCINE',
      recordDate: new Date('2026-09-20T00:00:00.000Z'),
      value: null,
      nextDueDate: null,
      fulfillsRecordId: 'rec-original',
    });
    db.animalMedicalRecord.updateMany.mockResolvedValue({ count: 1 });
    const result = await voidPetRecord(EMPLOYEE, PET_ID, 'rec-admin', META, NOW);
    expect(result).toEqual({ record: { id: 'rec-admin', voidedAt: NOW.toISOString() } });
    // Autor, persona, vínculo y fechas no se tocan: solo la anulación.
    expect(db.animalMedicalRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 'rec-admin', voidedAt: null },
      data: { voidedAt: NOW, voidedByUserId: 'user-e' },
    });
    expect(db.auditLog.create.mock.calls[0]?.[0].data).toMatchObject({
      actorUserId: 'user-e',
      action: 'pet.record_voided',
      entityId: 'rec-admin',
      previousState: { fulfillsRecordId: 'rec-original', voided: false },
      newState: { voided: true },
    });
  });

  it('historial: el antecedente cumplido indica si su registro original sigue vigente', async () => {
    db.animal.findUnique.mockResolvedValue({ id: PET_ID });
    db.animalMedicalRecord.count.mockResolvedValue(2);
    const fulfiller = (id: string, voidedAt: Date | null) => ({
      id,
      type: 'VACCINE',
      recordDate: new Date('2026-09-20T00:00:00.000Z'),
      description: null,
      value: null,
      createdAt: NOW,
      employee: null,
      recordedBy: null,
      nextDueDate: null,
      fulfills: {
        id: `${id}-original`,
        type: 'VACCINE',
        recordDate: new Date('2025-09-20T00:00:00.000Z'),
        voidedAt,
      },
      fulfillments: [],
    });
    db.animalMedicalRecord.findMany.mockResolvedValue([
      fulfiller('vigente', null),
      fulfiller('anulado', NOW),
    ]);
    const { records } = await listPetRecords(ADMIN, PET_ID, { page: 1, pageSize: 20 });
    expect(records.map((record) => record.fulfills)).toEqual([
      { id: 'vigente-original', type: 'VACCINE', recordDate: '2025-09-20', voided: false },
      { id: 'anulado-original', type: 'VACCINE', recordDate: '2025-09-20', voided: true },
    ]);
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
    db.animal.findUnique.mockResolvedValue({ id: PET_ID, active: true });
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
    // Copia en Drive desactivada: sin trabajo de copia.
    expect(db.driveBackupJob.create).not.toHaveBeenCalled();
  });

  describe('copia en Drive activada', () => {
    const arrange = () => {
      setDriveBackupConfigForTests(DRIVE_DEMO);
      const storage = fakeStorage();
      setObjectStorageForTests(storage);
      db.animal.findUnique.mockResolvedValue({ id: PET_ID, active: true });
      db.fileAsset.create.mockResolvedValue({ id: 'file-new' });
      db.$queryRaw.mockResolvedValue([{ id: PET_ID }]);
      db.fileAsset.findMany.mockResolvedValue([{ id: 'file-old', objectKey: 'animals/x/old.jpg' }]);
      db.fileAsset.updateMany.mockResolvedValue({ count: 1 });
      db.fileAsset.update.mockResolvedValue({});
      return storage;
    };
    const upload = () =>
      uploadPetPhoto(
        ADMIN,
        PET_ID,
        { body: JPEG, declaredType: 'image/jpeg', filename: 'rex.jpg' },
        META,
        NOW,
      );

    it('el trabajo se registra DENTRO de la transacción, después de AVAILABLE y antes de la auditoría', async () => {
      arrange();
      let inTransaction = false;
      db.$transaction.mockImplementation(async (run: (tx: typeof db) => unknown) => {
        inTransaction = true;
        try {
          return await run(db);
        } finally {
          inTransaction = false;
        }
      });
      const enqueuedInTransaction: boolean[] = [];
      db.driveBackupJob.create.mockImplementation(async () => {
        enqueuedInTransaction.push(inTransaction);
        return {};
      });

      await expect(upload()).resolves.toEqual({ photo: { id: 'file-new' } });
      expect(db.driveBackupJob.create).toHaveBeenCalledTimes(1);
      expect(db.driveBackupJob.create).toHaveBeenCalledWith({
        data: { fileAssetId: 'file-new', module: 'mascotas', environment: 'DEMO' },
      });
      expect(enqueuedInTransaction).toEqual([true]);
      const available = db.fileAsset.update.mock.calls.findIndex(
        ([args]) => args.data.status === 'AVAILABLE',
      );
      const [enqueued] = db.driveBackupJob.create.mock.invocationCallOrder;
      const [audited] = db.auditLog.create.mock.invocationCallOrder;
      expect(db.fileAsset.update.mock.invocationCallOrder[available]).toBeLessThan(enqueued!);
      expect(enqueued).toBeLessThan(audited!);
    });

    it('si no se puede registrar la copia, la foto nueva no queda vinculada y la vigente no se borra', async () => {
      const storage = arrange();
      db.driveBackupJob.create.mockRejectedValue(new Error('cola no disponible'));

      await expect(upload()).rejects.toThrow('cola no disponible');
      expect(db.auditLog.create).not.toHaveBeenCalled();
      const created = db.fileAsset.create.mock.calls[0]?.[0].data;
      expect(db.fileAsset.update).toHaveBeenLastCalledWith({
        where: { id: 'file-new' },
        data: { status: 'PENDING_DELETION', deletedAt: NOW },
      });
      expect(storage.deleteObject).toHaveBeenCalledWith(created.objectKey);
      expect(storage.deleteObject).not.toHaveBeenCalledWith('animals/x/old.jpg');
    });
  });

  it('falla del proveedor → UPLOAD_FAILED + 502 reintentable (la foto vigente no se toca)', async () => {
    setObjectStorageForTests(
      fakeStorage({ putObject: vi.fn(async () => Promise.reject(new Error('boom'))) }),
    );
    db.animal.findUnique.mockResolvedValue({ id: PET_ID, active: true });
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

describe('estado de la mascota (desactivar / reactivar)', () => {
  it('EMPLOYEE no cambia el estado ni ve inactivas', async () => {
    await expect(setPetActive(EMPLOYEE, PET_ID, false, META)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      listPets(EMPLOYEE, { status: 'inactive', page: 1, pageSize: 24 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('ADMIN desactiva y reactiva, condicionado al estado previo y auditado', async () => {
    db.animal.count.mockResolvedValue(1);
    db.animal.updateMany.mockResolvedValue({ count: 1 });
    db.animal.findUnique.mockResolvedValue(null); // getPet posterior: irrelevante acá
    await setPetActive(ADMIN, PET_ID, false, META).catch(() => undefined);
    expect(db.animal.updateMany).toHaveBeenLastCalledWith({
      where: { id: PET_ID, active: true },
      data: { active: false },
    });
    expect(db.auditLog.create.mock.calls.at(-1)?.[0].data.action).toBe('pet.deactivated');
    await setPetActive(ADMIN, PET_ID, true, META).catch(() => undefined);
    expect(db.animal.updateMany).toHaveBeenLastCalledWith({
      where: { id: PET_ID, active: false },
      data: { active: true },
    });
    expect(db.auditLog.create.mock.calls.at(-1)?.[0].data.action).toBe('pet.reactivated');
  });

  it('inexistente → 404', async () => {
    db.animal.count.mockResolvedValue(0);
    await expect(setPetActive(ADMIN, PET_ID, false, META)).rejects.toMatchObject({
      code: 'PET_NOT_FOUND',
    });
  });

  it('filtro ADMIN: activas por defecto, inactivas y todas', async () => {
    db.animal.count.mockResolvedValue(0);
    db.animal.findMany.mockResolvedValue([]);
    for (const [status, where] of [
      ['active', { active: true }],
      ['inactive', { active: false }],
      ['all', {}],
    ] as const) {
      await listPets(ADMIN, { status, page: 1, pageSize: 24 });
      expect(db.animal.findMany.mock.calls.at(-1)?.[0].where).toEqual(where);
    }
  });

  it('una mascota inactiva no acepta registros ni fotos nuevas (409 PET_INACTIVE)', async () => {
    db.animal.findUnique.mockResolvedValue({ active: false });
    await expect(
      createPetRecord(ADMIN, PET_ID, { type: 'VACCINE', recordDate: '2026-09-25' }, META, NOW),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PET_INACTIVE' });
    setObjectStorageForTests(fakeStorage());
    await expect(
      uploadPetPhoto(
        ADMIN,
        PET_ID,
        { body: JPEG, declaredType: 'image/jpeg', filename: undefined },
        META,
      ),
    ).rejects.toMatchObject({ code: 'PET_INACTIVE' });
    expect(db.fileAsset.create).not.toHaveBeenCalled();
  });
});

describe('próxima aplicación o control', () => {
  const RECORD_ID = '33333333-3333-4333-8333-333333333333';
  const created = () => db.animalMedicalRecord.create.mock.calls[0]?.[0].data;

  beforeEach(() => {
    db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
    db.auditLog.create.mockResolvedValue({});
    db.animal.findUnique.mockResolvedValue({ active: true });
    db.animalMedicalRecord.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'rec-new',
        type: data.type,
        recordDate: data.recordDate,
        description: null,
        value: null,
        createdAt: NOW,
        employee: null,
        recordedBy: null,
        nextDueDate: data.nextDueDate ?? null,
        fulfills: null,
        fulfillments: [],
      }),
    );
  });

  it('guarda la fecha programada y calcula su estado con BUSINESS_TIME_ZONE', async () => {
    const result = await createPetRecord(
      EMPLOYEE,
      PET_ID,
      { type: 'VACCINE', recordDate: '2026-09-25', nextDueDate: '2026-10-07' },
      META,
      NOW,
    );
    expect(created().nextDueDate).toEqual(new Date('2026-10-07T00:00:00.000Z'));
    expect(result.kind === 'created' && result.body.record.nextDue).toMatchObject({
      date: '2026-10-07',
      status: 'UPCOMING',
      daysUntil: 12, // hoy es 25/09 en Buenos Aires (02:30 UTC del 26)
    });
  });

  it('atención histórica: una próxima fecha ya pasada se acepta y queda VENCIDA', async () => {
    const result = await createPetRecord(
      ADMIN,
      PET_ID,
      { type: 'DEWORMING', recordDate: '2026-06-01', nextDueDate: '2026-09-22' },
      META,
      NOW,
    );
    expect(result.kind === 'created' && result.body.record.nextDue).toMatchObject({
      status: 'OVERDUE',
      daysUntil: -3,
    });
  });

  it('sin fecha programada: nada pendiente (registros anteriores incluidos)', async () => {
    const result = await createPetRecord(
      EMPLOYEE,
      PET_ID,
      { type: 'CHECKUP', recordDate: '2026-09-25' },
      META,
      NOW,
    );
    expect(created().nextDueDate).toBeNull();
    expect(result.kind === 'created' && result.body.record.nextDue).toBeNull();
  });

  it.each(['2026-09-25', '2026-09-24'])(
    'la próxima fecha debe ser posterior a la atención (rechaza %s)',
    async (nextDueDate) => {
      await expect(
        createPetRecord(
          EMPLOYEE,
          PET_ID,
          { type: 'VACCINE', recordDate: '2026-09-25', nextDueDate },
          META,
          NOW,
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(db.animalMedicalRecord.create).not.toHaveBeenCalled();
    },
  );

  it('cumple SOLO el pendiente elegido, en la misma transacción y con auditoría', async () => {
    db.animalMedicalRecord.findUnique.mockResolvedValue({
      animalId: PET_ID,
      type: 'VACCINE',
      voidedAt: null,
      nextDueDate: new Date('2026-09-20T00:00:00.000Z'),
      fulfillments: [],
    });
    await createPetRecord(
      EMPLOYEE,
      PET_ID,
      {
        type: 'VACCINE',
        recordDate: '2026-09-25',
        nextDueDate: '2027-09-25',
        fulfillsRecordId: RECORD_ID,
      },
      META,
      NOW,
    );
    expect(created()).toMatchObject({ fulfillsRecordId: RECORD_ID, recordedByUserId: 'user-e' });
    const actions = db.auditLog.create.mock.calls.map((call) => call[0].data.action);
    expect(actions).toEqual(['pet.record_created', 'pet.record_due_fulfilled']);
    expect(db.auditLog.create.mock.calls[1]?.[0].data).toMatchObject({
      entityId: RECORD_ID,
      actorUserId: 'user-e',
    });
  });

  it.each([
    ['de otra mascota', { animalId: 'otra', type: 'VACCINE', voidedAt: null }, 'PET_DUE_NOT_FOUND'],
    ['anulado', { animalId: PET_ID, type: 'VACCINE', voidedAt: NOW }, 'PET_DUE_NOT_FOUND'],
    [
      'sin fecha programada',
      { animalId: PET_ID, type: 'VACCINE', voidedAt: null, nextDueDate: null },
      'PET_DUE_NOT_FOUND',
    ],
    [
      'ya cumplido',
      { animalId: PET_ID, type: 'VACCINE', voidedAt: null, fulfillments: [{ id: 'x' }] },
      'PET_DUE_ALREADY_FULFILLED',
    ],
    ['de otro tipo', { animalId: PET_ID, type: 'DEWORMING', voidedAt: null }, 'VALIDATION_ERROR'],
  ])('no cumple un pendiente %s y no escribe', async (_label, target, code) => {
    db.animalMedicalRecord.findUnique.mockResolvedValue({
      nextDueDate: new Date('2026-09-20T00:00:00.000Z'),
      fulfillments: [],
      ...target,
    });
    await expect(
      createPetRecord(
        EMPLOYEE,
        PET_ID,
        { type: 'VACCINE', recordDate: '2026-09-25', fulfillsRecordId: RECORD_ID },
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ code });
    expect(db.animalMedicalRecord.create).not.toHaveBeenCalled();
  });

  it('una colisión en el índice único parcial (dos solicitudes a la vez) es un 409 claro', async () => {
    db.animalMedicalRecord.findUnique.mockResolvedValue({
      animalId: PET_ID,
      type: 'VACCINE',
      voidedAt: null,
      nextDueDate: new Date('2026-09-20T00:00:00.000Z'),
      fulfillments: [],
    });
    db.animalMedicalRecord.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'animal_medical_records_active_fulfillment_key' },
      }),
    );
    await expect(
      createPetRecord(
        EMPLOYEE,
        PET_ID,
        { type: 'VACCINE', recordDate: '2026-09-25', fulfillsRecordId: RECORD_ID },
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PET_DUE_ALREADY_FULFILLED' });
  });

  describe('completar o corregir la próxima fecha (ADMIN y EMPLOYEE)', () => {
    const D = (text: string) => new Date(`${text}T00:00:00.000Z`);
    /** Registro de otro autor (un ADMIN sin persona), con su fecha programada. */
    const stored = (overrides: Record<string, unknown> = {}) => ({
      animalId: PET_ID,
      type: 'VACCINE',
      recordDate: D('2026-09-01'),
      nextDueDate: D('2026-11-01'),
      voidedAt: null,
      fulfillments: [],
      ...overrides,
    });
    const correct = (
      actor: PetActor,
      nextDueDate: string,
      expectedNextDueDate: string | null = '2026-11-01',
    ) =>
      updatePetRecordNextDue(
        actor,
        PET_ID,
        RECORD_ID,
        { nextDueDate, expectedNextDueDate },
        META,
        NOW,
      );

    beforeEach(() => {
      db.$queryRaw.mockResolvedValue([{ id: RECORD_ID }]);
      db.animalMedicalRecord.findUnique.mockResolvedValue(stored());
      db.animalMedicalRecord.updateMany.mockResolvedValue({ count: 1 });
      db.animalMedicalRecord.findUniqueOrThrow.mockImplementation(async () => ({
        id: RECORD_ID,
        type: 'VACCINE',
        recordDate: D('2026-09-01'),
        description: 'Descripción sintética',
        value: null,
        createdAt: NOW,
        employee: null,
        recordedBy: { employee: null, personalProfile: { displayName: 'Admin sintética' } },
        nextDueDate: D(
          db.animalMedicalRecord.updateMany.mock.calls.length ? '2026-12-01' : '2026-11-01',
        ),
        fulfills: null,
        fulfillments: [],
      }));
    });

    it.each([
      ['EMPLOYEE', EMPLOYEE, 'user-e'],
      ['ADMIN', ADMIN, 'user-a'],
    ])(
      '%s corrige la fecha de un registro de otro autor: solo `next_due_date`, auditado en la transacción',
      async (_label, actor, userId) => {
        let inTransaction = false;
        const audited: boolean[] = [];
        db.$transaction.mockImplementation(async (run: (tx: typeof db) => unknown) => {
          inTransaction = true;
          try {
            return await run(db);
          } finally {
            inTransaction = false;
          }
        });
        db.auditLog.create.mockImplementation(async () => {
          audited.push(inTransaction);
          return {};
        });
        const { record, changed } = await correct(actor, '2026-12-01');
        expect(changed).toBe(true);
        // Primero se bloquea la fila; recién después se lee su estado.
        const lock = db.$queryRaw.mock.calls[0]?.[0] as { strings: string[] };
        expect(lock.strings.join('?')).toMatch(/FROM "animal_medical_records".*FOR UPDATE/);
        expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
          db.animalMedicalRecord.findUnique.mock.invocationCallOrder[0]!,
        );
        // Solo la próxima fecha: autor, persona, atención y descripción no se tocan.
        expect(db.animalMedicalRecord.updateMany).toHaveBeenCalledWith({
          where: { id: RECORD_ID, voidedAt: null },
          data: { nextDueDate: D('2026-12-01') },
        });
        expect(db.auditLog.create.mock.calls[0]?.[0].data).toMatchObject({
          actorUserId: userId,
          action: 'pet.record_next_due_updated',
          entityId: RECORD_ID,
          previousState: { nextDueDate: '2026-11-01' },
          newState: { nextDueDate: '2026-12-01' },
        });
        expect(audited).toEqual([true]);
        expect(record.recordedBy).toEqual({ displayName: 'Admin sintética' });
        expect(record.nextDue).toMatchObject({ date: '2026-12-01', status: 'SCHEDULED' });
      },
    );

    it('completa la fecha de un registro anterior que no la tenía (lo que vio: sin fecha)', async () => {
      db.animalMedicalRecord.findUnique.mockResolvedValue(stored({ nextDueDate: null }));
      await correct(EMPLOYEE, '2026-12-01', null);
      expect(db.auditLog.create.mock.calls[0]?.[0].data).toMatchObject({
        previousState: { nextDueDate: null },
        newState: { nextDueDate: '2026-12-01' },
      });
    });

    it('guardar la misma fecha no escribe ni audita', async () => {
      const { changed, record } = await correct(EMPLOYEE, '2026-11-01');
      expect(changed).toBe(false);
      expect(record.nextDue?.date).toBe('2026-11-01');
      expect(db.animalMedicalRecord.updateMany).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    });

    it('si otra persona ya la cambió (no es la que vio), 409 sin escribir ni auditar', async () => {
      db.animalMedicalRecord.findUnique.mockResolvedValue(stored({ nextDueDate: D('2026-11-15') }));
      await expect(correct(EMPLOYEE, '2026-12-01', '2026-11-01')).rejects.toMatchObject({
        statusCode: 409,
        code: 'PET_NEXT_DUE_CHANGED',
      });
      // Lo vio sin fecha, pero alguien ya la completó.
      await expect(correct(ADMIN, '2026-12-01', null)).rejects.toMatchObject({
        code: 'PET_NEXT_DUE_CHANGED',
      });
      expect(db.animalMedicalRecord.updateMany).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    });

    it.each([
      ['inexistente', null, 'PET_RECORD_NOT_FOUND'],
      ['de otra mascota', stored({ animalId: 'otra' }), 'PET_RECORD_NOT_FOUND'],
      ['anulado', stored({ voidedAt: NOW }), 'PET_RECORD_ALREADY_VOIDED'],
      ['de ⚖️ Peso', stored({ type: 'WEIGHT', nextDueDate: null }), 'VALIDATION_ERROR'],
      [
        'ya cumplido',
        stored({ fulfillments: [{ id: 'x', recordDate: D('2026-10-30') }] }),
        'PET_DUE_ALREADY_FULFILLED',
      ],
    ])('no corrige un registro %s y no escribe', async (_label, row, code) => {
      db.animalMedicalRecord.findUnique.mockResolvedValue(row);
      await expect(correct(EMPLOYEE, '2026-12-01')).rejects.toMatchObject({ code });
      expect(db.animalMedicalRecord.updateMany).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    });

    it.each(['2026-09-01', '2026-08-31'])(
      'la fecha debe ser posterior a la atención (rechaza %s)',
      async (nextDueDate) => {
        await expect(correct(EMPLOYEE, nextDueDate)).rejects.toMatchObject({ statusCode: 400 });
        expect(db.animalMedicalRecord.updateMany).not.toHaveBeenCalled();
      },
    );
  });
});
