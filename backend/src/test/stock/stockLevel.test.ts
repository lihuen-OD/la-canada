import { describe, expect, it } from 'vitest';
import {
  buildStockLevelIdsSql,
  computeStockLevel,
  computeSuggestedPurchase,
  matchesStockLevel,
  STOCK_LEVEL_CASE_SQL,
  STOCK_LEVEL_IDS_SQL_PREFIX,
  STOCK_LEVELS,
} from '../../stock/stockLevel';

describe('computeStockLevel — mínimo y stock objetivo (docs/BUSINESS_RULES.md §7)', () => {
  it.each([
    // Ejemplo acordado: mínimo 20, objetivo 50 → punto medio 35.
    ['19', '20', '50', 'critical'],
    ['20', '20', '50', 'critical'], // exactamente el mínimo ya es crítico
    ['20.01', '20', '50', 'low'],
    ['35', '20', '50', 'low'], // el punto medio es bajo
    ['35.01', '20', '50', 'ok'],
    ['50', '20', '50', 'ok'],
    ['80', '20', '50', 'ok'], // por encima del objetivo: normal (no es un máximo)
    // Punto medio no entero: (3 + 8) / 2 = 5.5, sin redondear.
    ['5.5', '3', '8', 'low'],
    ['5.51', '3', '8', 'ok'],
    ['5.49', '3', '8', 'low'],
    ['3.01', '3', '8', 'low'],
    // Decimales con dos cifras: (0.25 + 0.5) / 2 = 0.375.
    ['0.37', '0.25', '0.5', 'low'],
    ['0.38', '0.25', '0.5', 'ok'],
    // Stock cero y mínimo cero.
    ['0', '0', '10', 'critical'],
    ['0.01', '0', '10', 'low'],
    ['5', '0', '10', 'low'],
    ['5.01', '0', '10', 'ok'],
    ['0', '5', '10', 'critical'],
  ] as const)('actual %s / mínimo %s / objetivo %s → %s', (current, minimum, target, expected) => {
    expect(computeStockLevel(current, minimum, target)).toBe(expected);
    expect(matchesStockLevel(current, minimum, target, expected)).toBe(true);
  });

  it.each([
    ['0', '0', 'critical'],
    ['20', '20', 'critical'],
    ['19', '20', 'critical'],
    ['20.01', '20', 'pending'],
    ['1000', '20', 'pending'],
  ] as const)(
    'sin objetivo (producto anterior): actual %s / mínimo %s → %s (nunca «bajo» inventado)',
    (current, minimum, expected) => {
      expect(computeStockLevel(current, minimum, null)).toBe(expected);
    },
  );

  it('el nivel es total: exactamente uno de los cuatro cumple el predicado', () => {
    for (const [current, minimum, target] of [
      ['2', '3', '8'],
      ['3', '3', '8'],
      ['5.5', '3', '8'],
      ['9', '3', '8'],
      ['0', '0', '1'],
      ['4', '3', null],
    ] as const) {
      const matches = STOCK_LEVELS.filter((level) =>
        matchesStockLevel(current, minimum, target, level),
      );
      expect(matches).toHaveLength(1);
    }
  });
});

describe('computeSuggestedPurchase — objetivo − actual, exacto', () => {
  it.each([
    ['19', '50', '31'], // ejemplo acordado: comprar 31 para llegar a 50
    ['20', '50', '30'],
    ['0', '12.5', '12.5'],
    ['3.25', '8', '4.75'],
    ['0.01', '0.5', '0.49'],
    ['60', '50', '0'], // por encima del objetivo no se sugiere nada negativo
  ] as const)('actual %s / objetivo %s → %s', (current, target, expected) => {
    expect(computeSuggestedPurchase(current, target)).toBe(expected);
  });

  it('sin objetivo no inventa una cantidad', () => {
    expect(computeSuggestedPurchase('3', null)).toBeNull();
  });
});

describe('SQL de niveles — la misma regla en Postgres', () => {
  it('el nivel viaja como único parámetro, nunca interpolado', () => {
    const query = buildStockLevelIdsSql('low');
    expect(query.strings[0]?.startsWith(STOCK_LEVEL_IDS_SQL_PREFIX)).toBe(true);
    expect(query.values).toEqual(['low']);
  });

  it('mismas ramas y orden que computeStockLevel, con el punto medio sin dividir', () => {
    for (const text of [buildStockLevelIdsSql('ok').strings.join(' '), STOCK_LEVEL_CASE_SQL.sql]) {
      const critical = text.indexOf('"current_quantity" <= ');
      const pending = text.indexOf('"target_quantity" IS NULL');
      const low = text.indexOf('"current_quantity" * 2 <= ');
      expect(critical).toBeGreaterThan(-1);
      expect(pending).toBeGreaterThan(critical);
      expect(low).toBeGreaterThan(pending);
      expect(text).not.toMatch(/\/\s*2|ROUND|FLOOR|CEIL/i);
    }
  });
});
