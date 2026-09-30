import { describe, expect, it } from 'vitest';
import {
  createPetBodySchema,
  createPetRecordBodySchema,
  listPetDueQuerySchema,
  updatePetRecordNextDueBodySchema,
  createPetTypeBodySchema,
  listPetsQuerySchema,
  updatePetBodySchema,
} from '../../pets/petSchemas';

const TYPE_ID = '11111111-1111-4111-8111-111111111111';
const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('registro clínico', () => {
  it('⚖️ Peso exige kg positivo; los demás tipos no aceptan peso', () => {
    expect(
      createPetRecordBodySchema.parse({
        type: 'WEIGHT',
        recordDate: '2026-09-25',
        weightKg: '12.5',
      }),
    ).toMatchObject({ weightKg: '12.5' });
    expect(ok(createPetRecordBodySchema, { type: 'WEIGHT', recordDate: '2026-09-25' })).toBe(false);
    expect(
      ok(createPetRecordBodySchema, { type: 'WEIGHT', recordDate: '2026-09-25', weightKg: '0' }),
    ).toBe(false);
    expect(
      ok(createPetRecordBodySchema, {
        type: 'WEIGHT',
        recordDate: '2026-09-25',
        weightKg: '10000',
      }),
    ).toBe(false);
    expect(
      ok(createPetRecordBodySchema, { type: 'VACCINE', recordDate: '2026-09-25', weightKg: '3' }),
    ).toBe(false);
  });
  it('los 5 tipos del prototipo; descripción opcional y normalizada; sin campos ajenos', () => {
    for (const type of ['VACCINE', 'DEWORMING', 'CHECKUP', 'CLINICAL_EVENT']) {
      expect(ok(createPetRecordBodySchema, { type, recordDate: '2026-09-25' })).toBe(true);
    }
    expect(
      createPetRecordBodySchema.parse({
        type: 'VACCINE',
        recordDate: '2026-09-25',
        description: '  Antirrábica   anual ',
      }).description,
    ).toBe('Antirrábica anual');
    expect(ok(createPetRecordBodySchema, { type: 'SURGERY', recordDate: '2026-09-25' })).toBe(
      false,
    );
    for (const extra of ['employeeId', 'recordedByUserId', 'voidedAt', 'animalId']) {
      expect(
        ok(createPetRecordBodySchema, { type: 'VACCINE', recordDate: '2026-09-25', [extra]: 'x' }),
      ).toBe(false);
    }
  });
});

describe('ficha y tipos', () => {
  it('mascota: nombre obligatorio, raza y nacimiento opcionales; sin foto por URL', () => {
    expect(ok(createPetBodySchema, { name: 'Sintética', animalTypeId: TYPE_ID })).toBe(true);
    expect(ok(createPetBodySchema, { name: ' ', animalTypeId: TYPE_ID })).toBe(false);
    expect(
      ok(createPetBodySchema, {
        name: 'X',
        animalTypeId: TYPE_ID,
        photoUrl: 'https://x.test/a.jpg',
      }),
    ).toBe(false);
    expect(ok(updatePetBodySchema, {})).toBe(false);
    expect(ok(updatePetBodySchema, { breed: null, birthDate: null })).toBe(true);
  });
  it('tipo: mayúscula inicial como el prototipo y solo símbolos del selector', () => {
    expect(createPetTypeBodySchema.parse({ name: 'ternero', icon: '🐂' }).name).toBe('Ternero');
    expect(ok(createPetTypeBodySchema, { name: 'Ternero', icon: '🦖' })).toBe(false);
  });
  it('listado paginado (máx. 50)', () => {
    expect(listPetsQuerySchema.parse({})).toEqual({ status: 'active', page: 1, pageSize: 24 });
    expect(ok(listPetsQuerySchema, { status: 'inactive' })).toBe(true);
    expect(ok(listPetsQuerySchema, { status: 'deleted' })).toBe(false);
    expect(ok(listPetsQuerySchema, { pageSize: '51' })).toBe(false);
  });
});

describe('próxima aplicación o control y Vencimientos', () => {
  const base = { type: 'VACCINE', recordDate: '2026-09-25' };

  it('la fecha programada y el pendiente a cumplir son opcionales', () => {
    expect(createPetRecordBodySchema.safeParse(base).success).toBe(true);
    expect(
      createPetRecordBodySchema.safeParse({
        ...base,
        nextDueDate: '2027-09-25',
        fulfillsRecordId: '33333333-3333-4333-8333-333333333333',
      }).success,
    ).toBe(true);
    expect(
      createPetRecordBodySchema.safeParse({ ...base, nextDueDate: '25/09/2027' }).success,
    ).toBe(false);
  });

  it('⚖️ Peso no lleva próxima fecha', () => {
    expect(
      createPetRecordBodySchema.safeParse({
        type: 'WEIGHT',
        recordDate: '2026-09-25',
        weightKg: '12.5',
        nextDueDate: '2026-12-01',
      }).success,
    ).toBe(false);
  });

  it('la corrección acepta solo la fecha; Vencimientos filtra por estados conocidos', () => {
    expect(updatePetRecordNextDueBodySchema.safeParse({ nextDueDate: '2026-12-01' }).success).toBe(
      true,
    );
    expect(
      updatePetRecordNextDueBodySchema.safeParse({ nextDueDate: '2026-12-01', type: 'VACCINE' })
        .success,
    ).toBe(false);
    expect(listPetDueQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(listPetDueQuerySchema.safeParse({ status: 'OVERDUE' }).success).toBe(true);
    expect(listPetDueQuerySchema.safeParse({ status: 'vencida' }).success).toBe(false);
  });
});
