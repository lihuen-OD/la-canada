import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';

/**
 * 🥬 Huerta — cultivos y registros con Prisma simulado: permisos (ADMIN y
 * participantes activos escriben, también lo ajeno; el resto, solo consulta),
 * fechas de negocio, siembra directa y almácigo, trasplantes parciales y la
 * decisión explícita sobre los pendientes, bloqueo de la tanda antes de leer,
 * concurrencia optimista, correcciones sin cambios, anulación con motivo y
 * archivo. La SQL real se prueba contra una rama de Neon aislada.
 */
const db = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    kitchenGardenParticipant: { findMany: fn(), findUnique: fn() },
    kitchenGardenCrop: { findUniqueOrThrow: fn(), findMany: fn() },
    kitchenGardenBatch: {
      create: fn(),
      update: fn(),
      findUnique: fn(),
      findUniqueOrThrow: fn(),
      findMany: fn(),
    },
    kitchenGardenCropRecord: {
      create: fn(),
      update: fn(),
      updateMany: fn(),
      findUnique: fn(),
      findUniqueOrThrow: fn(),
      findMany: fn(),
      count: fn(),
    },
    auditLog: { create: fn() },
    $queryRaw: fn(),
    $transaction: fn(),
  };
});
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import {
  canRecordCrops,
  createGardenSowing,
  createGardenTransplant,
  cropNameKey,
  setGardenBatchArchived,
  transplantDueStatus,
  updateGardenBatch,
  updateGardenCropRecord,
  voidGardenCropRecord,
} from '../../kitchenGarden/gardenCropsService';

const META = { ipAddress: null, userAgent: 'vitest' };
/** Lunes 02/11/2026, 23:30 de Buenos Aires = martes 03/11 02:30 UTC: «hoy» es el 02. */
const NOW = new Date('2026-11-03T02:30:00.000Z');
const P = '00000000-0000-4000-8000-0000000000a1';
const Q = '00000000-0000-4000-8000-0000000000a2';
const BATCH = '00000000-0000-4000-8000-0000000000b1';
const SOWING = '00000000-0000-4000-8000-0000000000c1';
const TRANSPLANT = '00000000-0000-4000-8000-0000000000c2';
const ADMIN = { userId: 'u-admin', role: 'ADMIN' as const, participantId: null };
const PABLO = { userId: 'u-pablo', role: 'EMPLOYEE' as const, participantId: P };
const OUTSIDER = { userId: 'u-x', role: 'EMPLOYEE' as const, participantId: null };
const D = (text: string) => new Date(`${text}T00:00:00.000Z`);

/** Tanda bloqueada (lo que lee `readLockedBatch`). */
function lockedBatch(overrides: Record<string, unknown> = {}) {
  return {
    version: 3,
    archivedAt: null,
    name: 'Tanda 1',
    variety: null,
    notes: null,
    transplantPending: true,
    expectedTransplantDate: D('2026-11-10'),
    transplantsClosedAt: null,
    crop: { id: 'crop-1', name: 'Lechuga', nameKey: 'lechuga' },
    records: [{ id: SOWING, type: 'SOWING', performedOn: D('2026-10-20') }],
    ...overrides,
  };
}

/** Lo que lee la ficha (`loadBatchDetail`) después de escribir. */
const DETAIL_ROW = {
  id: BATCH,
  name: 'Tanda 1',
  variety: null,
  notes: null,
  transplantPending: true,
  expectedTransplantDate: D('2026-11-10'),
  transplantsClosedAt: null,
  archivedAt: null,
  version: 3,
  createdAt: NOW,
  crop: { id: 'crop-1', name: 'Lechuga' },
  transplantsClosedByUser: null,
  records: [],
};

beforeEach(() => {
  for (const group of Object.values(db)) {
    if (typeof group === 'function') group.mockReset();
    else for (const method of Object.values(group)) method.mockReset();
  }
  db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
  db.$queryRaw.mockResolvedValue([{ id: BATCH }]);
  db.auditLog.create.mockResolvedValue({});
  db.kitchenGardenParticipant.findUnique.mockResolvedValue({ active: true });
  db.kitchenGardenParticipant.findMany.mockResolvedValue([]);
  db.kitchenGardenBatch.findUnique.mockResolvedValue(DETAIL_ROW);
  db.kitchenGardenBatch.findUniqueOrThrow.mockResolvedValue(lockedBatch());
  db.kitchenGardenBatch.create.mockResolvedValue({ id: BATCH });
  db.kitchenGardenCropRecord.create.mockResolvedValue({ id: TRANSPLANT });
});

const actions = () => db.auditLog.create.mock.calls.map((call) => call[0].data.action);

describe('reglas puras', () => {
  it('cultivo por clave: sin distinguir mayúsculas ni espacios', () => {
    expect(cropNameKey('  Lechuga   Morada ')).toBe('lechuga morada');
    expect(cropNameKey('LECHUGA')).toBe(cropNameKey('lechuga'));
  });

  it('fecha prevista: «Previsto para…», «Para hoy» o «Fecha prevista pasada»; sin fecha, nada', () => {
    expect(transplantDueStatus('2026-11-03', '2026-11-02')).toBe('SCHEDULED');
    expect(transplantDueStatus('2026-11-02', '2026-11-02')).toBe('DUE_TODAY');
    expect(transplantDueStatus('2026-11-01', '2026-11-02')).toBe('PAST');
    expect(transplantDueStatus(null, '2026-11-02')).toBeNull();
  });

  it('escriben ADMIN y participantes activos; el resto solo consulta', () => {
    expect(canRecordCrops(ADMIN)).toBe(true);
    expect(canRecordCrops(PABLO)).toBe(true);
    expect(canRecordCrops(OUTSIDER)).toBe(false);
  });
});

describe('permisos', () => {
  const sowingInput = {
    cropName: 'Lechuga',
    batchName: 'Tanda 1',
    performedOn: '2026-11-01',
    performedByParticipantId: P,
    method: 'DIRECT' as const,
    location: 'Cantero 1',
  };
  it.each([
    ['registrar siembra', () => createGardenSowing(OUTSIDER, sowingInput, META, NOW)],
    [
      'registrar trasplante',
      () =>
        createGardenTransplant(
          OUTSIDER,
          BATCH,
          {
            batchVersion: 1,
            performedOn: '2026-11-01',
            performedByParticipantId: P,
            location: 'Cantero 2',
            remainingPending: true,
          },
          META,
          NOW,
        ),
    ],
    [
      'corregir la tanda',
      () => updateGardenBatch(OUTSIDER, BATCH, { version: 1, name: 'X' }, META),
    ],
    ['archivar', () => setGardenBatchArchived(OUTSIDER, BATCH, true, META)],
    [
      'corregir un registro',
      () => updateGardenCropRecord(OUTSIDER, SOWING, { version: 1, location: 'X' }, META),
    ],
    ['anular', () => voidGardenCropRecord(OUTSIDER, SOWING, 'Error de carga', META)],
  ])('quien no participa no puede %s y no se toca la base', async (_label, run) => {
    await expect(run()).rejects.toMatchObject({ statusCode: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('siembra (alta de la tanda)', () => {
  const base = {
    cropName: 'Lechuga',
    batchName: 'Tanda de primavera',
    performedOn: '2026-11-02',
    performedByParticipantId: Q,
    location: 'Cantero 1',
  };

  it('almácigo: tanda + siembra + auditoría en UNA transacción; queda un trasplante pendiente', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: 'crop-new' }]); // cultivo creado
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
    await createGardenSowing(
      PABLO,
      {
        ...base,
        method: 'SEEDBED',
        quantity: '120',
        quantityUnit: 'SEEDS',
        expectedTransplantDate: '2026-11-20',
      },
      META,
      NOW,
    );
    expect(db.kitchenGardenBatch.create.mock.calls[0]?.[0].data).toMatchObject({
      cropId: 'crop-new',
      name: 'Tanda de primavera',
      transplantPending: true,
      expectedTransplantDate: D('2026-11-20'),
      createdByUserId: 'u-pablo',
    });
    const sowing = db.kitchenGardenCropRecord.create.mock.calls[0]?.[0].data;
    // La persona que lo realizó (otra, elegida) y el usuario que lo registró (la sesión).
    expect(sowing).toMatchObject({
      type: 'SOWING',
      performedOn: D('2026-11-02'),
      performedByParticipantId: Q,
      recordedByUserId: 'u-pablo',
      method: 'SEEDBED',
      quantityUnit: 'SEEDS',
    });
    expect(sowing.quantity.toString()).toBe('120');
    expect(actions()).toEqual(['kitchen_garden.crop_created', 'kitchen_garden.batch_sown']);
    expect(audited).toEqual([true, true]);
  });

  it('directa: sin trasplante pendiente; el cultivo existente se reutiliza sin auditarlo', async () => {
    db.$queryRaw.mockResolvedValueOnce([]); // ya existía (ON CONFLICT DO NOTHING)
    db.kitchenGardenCrop.findUniqueOrThrow.mockResolvedValue({ id: 'crop-1' });
    await createGardenSowing(ADMIN, { ...base, method: 'DIRECT' }, META, NOW);
    expect(db.kitchenGardenCrop.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { nameKey: 'lechuga' },
      select: { id: true },
    });
    expect(db.kitchenGardenBatch.create.mock.calls[0]?.[0].data).toMatchObject({
      cropId: 'crop-1',
      transplantPending: false,
      expectedTransplantDate: null,
    });
    expect(actions()).toEqual(['kitchen_garden.batch_sown']);
  });

  it('fecha según BUSINESS_TIME_ZONE: el 03/11 todavía es futuro; prevista anterior a la siembra, rechazada', async () => {
    await expect(
      createGardenSowing(
        PABLO,
        { ...base, performedOn: '2026-11-03', method: 'DIRECT' },
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 400, message: 'La fecha no puede ser futura.' });
    await expect(
      createGardenSowing(
        PABLO,
        { ...base, method: 'SEEDBED', expectedTransplantDate: '2026-11-01' },
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('la persona elegida tiene que participar hoy de la Huerta', async () => {
    db.kitchenGardenParticipant.findUnique.mockResolvedValue({ active: false });
    await expect(
      createGardenSowing(ADMIN, { ...base, method: 'DIRECT' }, META, NOW),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Elegí un participante activo de la Huerta.',
    });
    expect(db.kitchenGardenBatch.create).not.toHaveBeenCalled();
  });
});

describe('trasplantes', () => {
  const input = (overrides: Record<string, unknown> = {}) => ({
    batchVersion: 3,
    performedOn: '2026-11-01',
    performedByParticipantId: P,
    location: 'Cantero 4',
    quantity: '30',
    remainingPending: true,
    ...overrides,
  });

  it('bloquea la tanda ANTES de leerla; parcial: conserva los pendientes y su fecha prevista', async () => {
    await createGardenTransplant(PABLO, BATCH, input(), META, NOW);
    const lock = db.$queryRaw.mock.calls[0]?.[0] as { strings: string[] };
    expect(lock.strings.join('?')).toMatch(/FROM "kitchen_garden_batches".*FOR UPDATE/);
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.kitchenGardenBatch.findUniqueOrThrow.mock.invocationCallOrder[0]!,
    );
    expect(db.kitchenGardenCropRecord.create.mock.calls[0]?.[0].data).toMatchObject({
      type: 'TRANSPLANT',
      performedByParticipantId: P,
      recordedByUserId: 'u-pablo',
      quantityUnit: 'SEEDLINGS',
    });
    // Lo previsto no cambió: ni la tanda ni su versión se tocan.
    expect(db.kitchenGardenBatch.update).not.toHaveBeenCalled();
    expect(actions()).toEqual(['kitchen_garden.transplant_recorded']);
  });

  it('«No quedan trasplantes pendientes»: se confirma explícitamente, con quién y cuándo', async () => {
    await createGardenTransplant(ADMIN, BATCH, input({ remainingPending: false }), META, NOW);
    expect(db.kitchenGardenBatch.update.mock.calls[0]?.[0].data).toMatchObject({
      transplantPending: false,
      expectedTransplantDate: null,
      transplantsClosedAt: NOW,
      transplantsClosedByUserId: 'u-admin',
      version: { increment: 1 },
    });
    expect(actions()).toEqual([
      'kitchen_garden.transplant_recorded',
      'kitchen_garden.transplant_plan_updated',
    ]);
  });

  it('quedan pendientes con otra fecha prevista; también sin haberlo programado', async () => {
    await createGardenTransplant(
      PABLO,
      BATCH,
      input({ expectedTransplantDate: '2026-11-15' }),
      META,
      NOW,
    );
    expect(db.kitchenGardenBatch.update.mock.calls[0]?.[0].data).toMatchObject({
      transplantPending: true,
      expectedTransplantDate: D('2026-11-15'),
    });
    // Siembra directa (nada pendiente): el trasplante se registra igual.
    db.kitchenGardenBatch.findUniqueOrThrow.mockResolvedValue(
      lockedBatch({ transplantPending: false, expectedTransplantDate: null }),
    );
    db.kitchenGardenBatch.update.mockClear();
    await createGardenTransplant(PABLO, BATCH, input({ remainingPending: false }), META, NOW);
    expect(db.kitchenGardenBatch.update).not.toHaveBeenCalled();
  });

  it.each([
    ['anterior a la siembra', input({ performedOn: '2026-10-19' }), 400],
    ['futuro en la zona del negocio', input({ performedOn: '2026-11-03' }), 400],
  ])('rechaza un trasplante %s sin escribir', async (_label, body, status) => {
    await expect(createGardenTransplant(PABLO, BATCH, body, META, NOW)).rejects.toMatchObject({
      statusCode: status,
    });
    expect(db.kitchenGardenCropRecord.create).not.toHaveBeenCalled();
  });

  it.each([
    ['archivada', lockedBatch({ archivedAt: NOW }), 'GARDEN_BATCH_ARCHIVED'],
    ['sin siembra vigente', lockedBatch({ records: [] }), 'GARDEN_BATCH_WITHOUT_SOWING'],
  ])('una tanda %s no admite trasplantes', async (_label, batch, code) => {
    db.kitchenGardenBatch.findUniqueOrThrow.mockResolvedValue(batch);
    await expect(createGardenTransplant(PABLO, BATCH, input(), META, NOW)).rejects.toMatchObject({
      code,
    });
    expect(db.kitchenGardenCropRecord.create).not.toHaveBeenCalled();
  });

  it('si cambia lo previsto, la tanda tiene que ser la que vio la pantalla (409 sin escribir)', async () => {
    await expect(
      createGardenTransplant(
        PABLO,
        BATCH,
        input({ batchVersion: 2, remainingPending: false }),
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'GARDEN_BATCH_CHANGED' });
    expect(db.kitchenGardenCropRecord.create).not.toHaveBeenCalled();
  });
});

describe('correcciones de registros', () => {
  /** Registro bloqueado (lo que lee `lockRecord`). */
  const stored = (overrides: Record<string, unknown> = {}) => ({
    id: SOWING,
    batchId: BATCH,
    type: 'SOWING',
    performedOn: D('2026-10-20'),
    performedByParticipantId: P,
    method: 'SEEDBED',
    location: 'Almácigo',
    quantity: new Prisma.Decimal('120'),
    quantityUnit: 'SEEDS',
    notes: null,
    version: 2,
    voidedAt: null,
    ...overrides,
  });
  const withTransplant = lockedBatch({
    records: [
      { id: SOWING, type: 'SOWING', performedOn: D('2026-10-20') },
      { id: TRANSPLANT, type: 'TRANSPLANT', performedOn: D('2026-10-28') },
    ],
  });

  beforeEach(() => {
    db.kitchenGardenCropRecord.findUnique.mockResolvedValue({ batchId: BATCH });
    db.kitchenGardenCropRecord.findUniqueOrThrow.mockResolvedValue(stored());
    db.kitchenGardenBatch.findUniqueOrThrow.mockResolvedValue(withTransplant);
  });

  it('corrige solo lo que cambió, conserva quién lo registró y audita antes/después', async () => {
    const result = await updateGardenCropRecord(
      PABLO,
      SOWING,
      { version: 2, location: 'Almácigo norte', quantity: '120.00' },
      META,
      NOW,
    );
    expect(result.changed).toBe(true);
    const data = db.kitchenGardenCropRecord.update.mock.calls[0]?.[0].data;
    expect(data).toEqual({ location: 'Almácigo norte', version: { increment: 1 } });
    expect(data).not.toHaveProperty('recordedByUserId');
    expect(db.auditLog.create.mock.calls[0]?.[0].data).toMatchObject({
      actorUserId: 'u-pablo',
      action: 'kitchen_garden.crop_record_corrected',
      previousState: { location: 'Almácigo' },
      newState: { location: 'Almácigo norte' },
    });
  });

  it('sin cambios: no escribe ni audita (aunque la versión ya sea otra)', async () => {
    const result = await updateGardenCropRecord(
      ADMIN,
      SOWING,
      { version: 1, location: 'Almácigo', performedOn: '2026-10-20' },
      META,
      NOW,
    );
    expect(result.changed).toBe(false);
    expect(db.kitchenGardenCropRecord.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('otra persona ya lo corrigió (versión distinta): 409 sin pisarlo', async () => {
    await expect(
      updateGardenCropRecord(PABLO, SOWING, { version: 1, location: 'Otro' }, META, NOW),
    ).rejects.toMatchObject({ statusCode: 409, code: 'GARDEN_CROP_RECORD_CHANGED' });
    expect(db.kitchenGardenCropRecord.update).not.toHaveBeenCalled();
  });

  it('fechas: la siembra no queda después de un trasplante; el trasplante no queda antes de la siembra', async () => {
    await expect(
      updateGardenCropRecord(PABLO, SOWING, { version: 2, performedOn: '2026-10-29' }, META, NOW),
    ).rejects.toMatchObject({ statusCode: 400 });
    db.kitchenGardenCropRecord.findUniqueOrThrow.mockResolvedValue(
      stored({
        id: TRANSPLANT,
        type: 'TRANSPLANT',
        method: null,
        quantity: null,
        quantityUnit: null,
        performedOn: D('2026-10-28'),
      }),
    );
    await expect(
      updateGardenCropRecord(
        PABLO,
        TRANSPLANT,
        { version: 2, performedOn: '2026-10-19' },
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      updateGardenCropRecord(PABLO, TRANSPLANT, { version: 2, method: 'DIRECT' }, META, NOW),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(db.kitchenGardenCropRecord.update).not.toHaveBeenCalled();
  });

  it('cambiar quién lo realizó exige un participante activo; un anulado o una tanda archivada no se corrigen', async () => {
    db.kitchenGardenParticipant.findUnique.mockResolvedValue({ active: false });
    await expect(
      updateGardenCropRecord(ADMIN, SOWING, { version: 2, performedByParticipantId: Q }, META, NOW),
    ).rejects.toMatchObject({ statusCode: 400 });
    db.kitchenGardenCropRecord.findUniqueOrThrow.mockResolvedValue(stored({ voidedAt: NOW }));
    await expect(
      updateGardenCropRecord(ADMIN, SOWING, { version: 2, location: 'X' }, META, NOW),
    ).rejects.toMatchObject({ code: 'GARDEN_CROP_RECORD_VOIDED' });
    db.kitchenGardenCropRecord.findUniqueOrThrow.mockResolvedValue(stored());
    db.kitchenGardenBatch.findUniqueOrThrow.mockResolvedValue(lockedBatch({ archivedAt: NOW }));
    await expect(
      updateGardenCropRecord(ADMIN, SOWING, { version: 2, location: 'X' }, META, NOW),
    ).rejects.toMatchObject({ code: 'GARDEN_BATCH_ARCHIVED' });
    expect(db.kitchenGardenCropRecord.update).not.toHaveBeenCalled();
  });
});

describe('anulación', () => {
  beforeEach(() => {
    db.kitchenGardenCropRecord.findUnique.mockResolvedValue({ batchId: BATCH });
    db.kitchenGardenCropRecord.findUniqueOrThrow.mockResolvedValue({
      id: TRANSPLANT,
      batchId: BATCH,
      type: 'TRANSPLANT',
      performedOn: D('2026-10-28'),
      performedByParticipantId: Q,
      method: null,
      location: 'Cantero 4',
      quantity: null,
      quantityUnit: null,
      notes: null,
      version: 1,
      voidedAt: null,
    });
  });

  it('lógica, con motivo y el usuario real; también lo de otra persona', async () => {
    db.kitchenGardenCropRecord.updateMany.mockResolvedValue({ count: 1 });
    await voidGardenCropRecord(PABLO, TRANSPLANT, 'Cargado dos veces', META, NOW);
    expect(db.kitchenGardenCropRecord.updateMany).toHaveBeenCalledWith({
      where: { id: TRANSPLANT, voidedAt: null },
      data: { voidedAt: NOW, voidedByUserId: 'u-pablo', voidReason: 'Cargado dos veces' },
    });
    expect(db.auditLog.create.mock.calls[0]?.[0].data).toMatchObject({
      action: 'kitchen_garden.crop_record_voided',
      newState: { voided: true, reason: 'Cargado dos veces' },
    });
  });

  it('doble clic o dos personas a la vez: una sola anulación (la otra, 409 sin auditoría)', async () => {
    db.kitchenGardenCropRecord.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      voidGardenCropRecord(PABLO, TRANSPLANT, 'Cargado dos veces', META, NOW),
    ).rejects.toMatchObject({ code: 'GARDEN_CROP_RECORD_VOIDED' });
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('la siembra no se anula mientras haya trasplantes vigentes', async () => {
    db.kitchenGardenCropRecord.findUniqueOrThrow.mockResolvedValue({
      id: SOWING,
      batchId: BATCH,
      type: 'SOWING',
      performedOn: D('2026-10-20'),
      performedByParticipantId: P,
      method: 'SEEDBED',
      location: 'Almácigo',
      quantity: null,
      quantityUnit: null,
      notes: null,
      version: 1,
      voidedAt: null,
    });
    db.kitchenGardenBatch.findUniqueOrThrow.mockResolvedValue(
      lockedBatch({
        records: [
          { id: SOWING, type: 'SOWING', performedOn: D('2026-10-20') },
          { id: TRANSPLANT, type: 'TRANSPLANT', performedOn: D('2026-10-28') },
        ],
      }),
    );
    await expect(
      voidGardenCropRecord(ADMIN, SOWING, 'Error de carga', META, NOW),
    ).rejects.toMatchObject({ statusCode: 409, code: 'GARDEN_SOWING_HAS_TRANSPLANTS' });
    expect(db.kitchenGardenCropRecord.updateMany).not.toHaveBeenCalled();
  });
});

describe('tanda: correcciones, lo previsto y archivo', () => {
  it('sin cambios no escribe; versión vieja → 409; sin pendientes no hay fecha prevista', async () => {
    const same = await updateGardenBatch(PABLO, BATCH, { version: 1, name: 'Tanda 1' }, META, NOW);
    expect(same.changed).toBe(false);
    expect(db.kitchenGardenBatch.update).not.toHaveBeenCalled();
    await expect(
      updateGardenBatch(PABLO, BATCH, { version: 1, name: 'Tanda 2' }, META, NOW),
    ).rejects.toMatchObject({ code: 'GARDEN_BATCH_CHANGED' });
    await expect(
      updateGardenBatch(
        PABLO,
        BATCH,
        { version: 3, transplantPending: false, expectedTransplantDate: '2026-11-12' },
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('«No quedan trasplantes pendientes» desde la ficha limpia la fecha prevista y lo audita', async () => {
    await updateGardenBatch(ADMIN, BATCH, { version: 3, transplantPending: false }, META, NOW);
    expect(db.kitchenGardenBatch.update.mock.calls[0]?.[0].data).toMatchObject({
      transplantPending: false,
      expectedTransplantDate: null,
      transplantsClosedByUserId: 'u-admin',
    });
    expect(actions()).toEqual(['kitchen_garden.transplant_plan_updated']);
  });

  it('archivar y reabrir: repetirlo no escribe ni audita', async () => {
    const first = await setGardenBatchArchived(PABLO, BATCH, true, META, NOW);
    expect(first.changed).toBe(true);
    expect(actions()).toEqual(['kitchen_garden.batch_archived']);
    db.kitchenGardenBatch.findUniqueOrThrow.mockResolvedValue(lockedBatch({ archivedAt: NOW }));
    const again = await setGardenBatchArchived(PABLO, BATCH, true, META, NOW);
    expect(again.changed).toBe(false);
    expect(db.kitchenGardenBatch.update).toHaveBeenCalledTimes(1);
    await setGardenBatchArchived(PABLO, BATCH, false, META, NOW);
    expect(actions()).toEqual(['kitchen_garden.batch_archived', 'kitchen_garden.batch_reopened']);
  });
});
