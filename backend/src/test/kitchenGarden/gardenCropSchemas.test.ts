import { describe, expect, it } from 'vitest';
import {
  createSowingBodySchema,
  createTransplantBodySchema,
  listCropRecordsQuerySchema,
  updateCropRecordBodySchema,
  voidCropRecordBodySchema,
} from '../../kitchenGarden/gardenCropSchemas';

const P = '00000000-0000-4000-8000-0000000000a1';
const SOWING = {
  cropName: 'Lechuga',
  batchName: 'Tanda 1',
  performedOn: '2026-11-02',
  performedByParticipantId: P,
  method: 'SEEDBED',
  location: 'Almácigo',
};
const TRANSPLANT = {
  batchVersion: 1,
  performedOn: '2026-11-02',
  performedByParticipantId: P,
  location: 'Cantero 2',
  remainingPending: true,
};
const message = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe('siembra', () => {
  it('cantidad opcional, siempre con su unidad (semillas enteras o gramos)', () => {
    expect(createSowingBodySchema.safeParse(SOWING).success).toBe(true);
    expect(
      createSowingBodySchema.safeParse({ ...SOWING, quantity: '120', quantityUnit: 'SEEDS' })
        .success,
    ).toBe(true);
    expect(
      createSowingBodySchema.safeParse({ ...SOWING, quantity: '120.00', quantityUnit: 'SEEDS' })
        .success,
    ).toBe(true);
    expect(
      createSowingBodySchema.safeParse({ ...SOWING, quantity: '2.5', quantityUnit: 'GRAMS' })
        .success,
    ).toBe(true);
    expect(message(createSowingBodySchema.safeParse({ ...SOWING, quantity: '120' }))).toMatch(
      /unidad/,
    );
    expect(
      message(
        createSowingBodySchema.safeParse({ ...SOWING, quantity: '2.5', quantityUnit: 'SEEDS' }),
      ),
    ).toBe('Las semillas se cuentan enteras.');
    // Los plantines no son una unidad de siembra.
    expect(
      createSowingBodySchema.safeParse({ ...SOWING, quantity: '10', quantityUnit: 'SEEDLINGS' })
        .success,
    ).toBe(false);
    expect(
      createSowingBodySchema.safeParse({ ...SOWING, quantity: '0', quantityUnit: 'SEEDS' }).success,
    ).toBe(false);
  });

  it('la siembra directa no lleva fecha prevista de trasplante; el almácigo sí puede', () => {
    expect(
      createSowingBodySchema.safeParse({ ...SOWING, expectedTransplantDate: '2026-11-20' }).success,
    ).toBe(true);
    expect(
      createSowingBodySchema.safeParse({
        ...SOWING,
        method: 'DIRECT',
        expectedTransplantDate: '2026-11-20',
      }).success,
    ).toBe(false);
  });

  it('fechas reales del calendario; nada que decida el servidor viaja en el cuerpo', () => {
    expect(createSowingBodySchema.safeParse({ ...SOWING, performedOn: '2026-02-30' }).success).toBe(
      false,
    );
    expect(createSowingBodySchema.safeParse({ ...SOWING, performedOn: '02/11/2026' }).success).toBe(
      false,
    );
    for (const extra of ['recordedByUserId', 'version', 'transplantPending', 'cropId']) {
      expect(createSowingBodySchema.safeParse({ ...SOWING, [extra]: 'x' }).success).toBe(false);
    }
    expect(createSowingBodySchema.safeParse({ ...SOWING, location: '<b>x</b>' }).success).toBe(
      false,
    );
  });
});

describe('trasplante', () => {
  it('la decisión sobre los pendientes es explícita; sin pendientes no hay fecha prevista', () => {
    expect(createTransplantBodySchema.safeParse(TRANSPLANT).success).toBe(true);
    expect(
      createTransplantBodySchema.safeParse({ ...TRANSPLANT, remainingPending: undefined }).success,
    ).toBe(false);
    expect(
      createTransplantBodySchema.safeParse({
        ...TRANSPLANT,
        remainingPending: false,
        expectedTransplantDate: '2026-11-20',
      }).success,
    ).toBe(false);
    expect(
      createTransplantBodySchema.safeParse({ ...TRANSPLANT, expectedTransplantDate: null }).success,
    ).toBe(true);
  });

  it('plantines enteros; la unidad no se elige (siempre plantines)', () => {
    expect(createTransplantBodySchema.safeParse({ ...TRANSPLANT, quantity: '30' }).success).toBe(
      true,
    );
    expect(message(createTransplantBodySchema.safeParse({ ...TRANSPLANT, quantity: '3.5' }))).toBe(
      'Los plantines se cuentan enteros.',
    );
    expect(
      createTransplantBodySchema.safeParse({ ...TRANSPLANT, quantityUnit: 'SEEDLINGS' }).success,
    ).toBe(false);
  });
});

describe('corrección, anulación y Registros', () => {
  it('corregir exige la versión que vio la pantalla; anular, un motivo', () => {
    expect(updateCropRecordBodySchema.safeParse({ location: 'X' }).success).toBe(false);
    expect(updateCropRecordBodySchema.safeParse({ version: 2, location: 'X' }).success).toBe(true);
    expect(voidCropRecordBodySchema.safeParse({}).success).toBe(false);
    expect(voidCropRecordBodySchema.safeParse({ reason: 'ok' }).success).toBe(false);
    expect(voidCropRecordBodySchema.safeParse({ reason: 'Cargado dos veces' }).success).toBe(true);
  });

  it('filtros: rango coherente, tipos conocidos y paginación acotada', () => {
    expect(listCropRecordsQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(
      listCropRecordsQuerySchema.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success,
    ).toBe(false);
    expect(listCropRecordsQuerySchema.safeParse({ type: 'HARVEST' }).success).toBe(false);
    expect(listCropRecordsQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });
});
