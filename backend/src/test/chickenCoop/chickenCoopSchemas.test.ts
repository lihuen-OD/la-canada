import { describe, expect, it } from 'vitest';
import {
  adjustChickenCoopHensBodySchema,
  chickenCoopSummaryQuerySchema,
  configureChickenCoopBodySchema,
  createEggCollectionBodySchema,
  eggCollectionHistoryQuerySchema,
} from '../../chickenCoop/chickenCoopSchemas';

const firstMessage = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe('createEggCollectionBodySchema', () => {
  it('acepta el formulario del prototipo y normaliza las observaciones', () => {
    const parsed = createEggCollectionBodySchema.parse({
      goodEggsCount: 12,
      brokenEggsCount: 1,
      collectionDate: '2026-09-25',
      notes: '  2 rotos   en nido 3 ',
    });
    expect(parsed).toEqual({
      goodEggsCount: 12,
      brokenEggsCount: 1,
      collectionDate: '2026-09-25',
      notes: '2 rotos en nido 3',
    });
  });

  it('"Ingresá al menos un huevo." con 0 buenos y 0 rotos', () => {
    const result = createEggCollectionBodySchema.safeParse({
      goodEggsCount: 0,
      brokenEggsCount: 0,
    });
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe('Ingresá al menos un huevo.');
  });

  it.each([
    [{ goodEggsCount: -1, brokenEggsCount: 2 }],
    [{ goodEggsCount: 1.5, brokenEggsCount: 0 }],
    [{ goodEggsCount: '3', brokenEggsCount: 0 }],
    [{ goodEggsCount: 10_001, brokenEggsCount: 0 }],
    [{ goodEggsCount: 1 }],
    [{ goodEggsCount: 1, brokenEggsCount: 0, collectionDate: '25/09/2026' }],
    [{ goodEggsCount: 1, brokenEggsCount: 0, employeeId: 'no-uuid' }],
    [{ goodEggsCount: 1, brokenEggsCount: 0, notes: '<b>hola</b>' }],
    [{ goodEggsCount: 1, brokenEggsCount: 0, notes: '   ' }],
    [{ goodEggsCount: 1, brokenEggsCount: 0, notes: 'x'.repeat(301) }],
  ])('rechaza %j', (body) => {
    expect(createEggCollectionBodySchema.safeParse(body).success).toBe(false);
  });

  it('rechaza campos que el cliente nunca decide (mass assignment)', () => {
    for (const extra of ['recordedByUserId', 'chickenCoopId', 'voidedAt', 'layingRate', 'id']) {
      expect(
        createEggCollectionBodySchema.safeParse({
          goodEggsCount: 1,
          brokenEggsCount: 0,
          [extra]: 'x',
        }).success,
      ).toBe(false);
    }
  });
});

describe('otros schemas', () => {
  it('período: solo los chips del prototipo (7/30/90/365), 7 por defecto', () => {
    expect(chickenCoopSummaryQuerySchema.parse({})).toEqual({ days: 7 });
    expect(chickenCoopSummaryQuerySchema.parse({ days: '365' })).toEqual({ days: 365 });
    expect(chickenCoopSummaryQuerySchema.safeParse({ days: '14' }).success).toBe(false);
  });

  it('historial: paginado por días, máximo 31 por página', () => {
    expect(eggCollectionHistoryQuerySchema.parse({})).toEqual({ page: 1, pageSize: 10 });
    expect(eggCollectionHistoryQuerySchema.safeParse({ pageSize: '32' }).success).toBe(false);
    expect(eggCollectionHistoryQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('configuración: entero no negativo, estricto', () => {
    expect(configureChickenCoopBodySchema.parse({ activeHensCount: 0 })).toEqual({
      activeHensCount: 0,
    });
    expect(configureChickenCoopBodySchema.safeParse({ activeHensCount: -1 }).success).toBe(false);
    expect(configureChickenCoopBodySchema.safeParse({ activeHensCount: 2.5 }).success).toBe(false);
    expect(
      configureChickenCoopBodySchema.safeParse({ activeHensCount: 3, code: 'otro' }).success,
    ).toBe(false);
  });

  it('alta/baja: de a una gallina, con la cantidad confirmada', () => {
    expect(adjustChickenCoopHensBodySchema.parse({ delta: -1, expectedCount: 4 })).toEqual({
      delta: -1,
      expectedCount: 4,
    });
    expect(adjustChickenCoopHensBodySchema.safeParse({ delta: 2, expectedCount: 4 }).success).toBe(
      false,
    );
    expect(adjustChickenCoopHensBodySchema.safeParse({ delta: 1 }).success).toBe(false);
  });
});
