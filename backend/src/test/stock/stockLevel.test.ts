import { describe, expect, it } from 'vitest';
import {
  buildStockLevelIdsSql,
  computeStockLevel,
  matchesStockLevel,
  STOCK_LEVEL_IDS_SQL_PREFIX,
} from '../../stock/stockLevel';

describe('computeStockLevel — regla histórica de la barra (docs/BUSINESS_RULES.md §7)', () => {
  it.each([
    ['0', '0', 'critical'],
    ['0', '5', 'critical'],
    ['0.01', '0', 'ok'],
    ['2', '3', 'low'],
    ['5', '10', 'low'],
    ['3', '3', 'ok'],
    ['24', '12', 'ok'],
    ['0.00', '10', 'critical'],
  ] as const)('saldo %s / mínimo %s → %s', (current, minimum, expected) => {
    expect(computeStockLevel(current, minimum)).toBe(expected);
    expect(matchesStockLevel(current, minimum, expected)).toBe(true);
  });

  it('el nivel es total: solo uno de los tres cumple el predicado', () => {
    for (const [current, minimum] of [
      ['2', '3'],
      ['3', '3'],
      ['0', '0'],
      ['10.5', '0.01'],
    ] as const) {
      const matches = (['ok', 'low', 'critical'] as const).filter((level) =>
        matchesStockLevel(current, minimum, level),
      );
      expect(matches).toHaveLength(1);
    }
  });
});

describe('buildStockLevelIdsSql — SQL parametrizado de Postgres', () => {
  it('el nivel viaja como único parámetro, nunca interpolado', () => {
    const query = buildStockLevelIdsSql('low');
    expect(query.strings[0]).toBe(`${STOCK_LEVEL_IDS_SQL_PREFIX} `);
    expect(query.values).toEqual(['low']);
  });

  it('expresa la comparación columna-vs-columna que Prisma no puede representar', () => {
    const text = buildStockLevelIdsSql('low').strings.join(' ');
    expect(text).toContain('"current_quantity" < "minimum_quantity"');
    expect(text).toContain('"current_quantity" <= 0');
    expect(text).toContain('"current_quantity" >= "minimum_quantity"');
  });

  it('el prefix es reconocible por el intérprete del fake', () => {
    expect(
      buildStockLevelIdsSql('critical').strings[0]?.startsWith(STOCK_LEVEL_IDS_SQL_PREFIX),
    ).toBe(true);
  });
});
