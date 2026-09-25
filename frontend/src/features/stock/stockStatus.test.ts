import { describe, expect, it } from 'vitest';
import { movementSignedPrefix, purchaseShortfall, stockBarPercent } from './stockStatus';

describe('nivel de stock: responsabilidad exclusiva del backend', () => {
  it('el módulo visual ya no exporta una regla de nivel propia', async () => {
    const module = await import('./stockStatus');
    expect(module).not.toHaveProperty('stockLevel');
  });
});

describe('purchaseShortfall (Compras: máximo(mínimo − actual, 0))', () => {
  it('aritmética exacta en centésimos, sin errores de float', () => {
    expect(purchaseShortfall('3', '10')).toBe('7');
    expect(purchaseShortfall('0.1', '0.3')).toBe('0.2');
    expect(purchaseShortfall('2.35', '10')).toBe('7.65');
    expect(purchaseShortfall('9.5', '10')).toBe('0.5');
  });

  it('nunca negativa: con saldo ≥ mínimo la referencia es 0', () => {
    expect(purchaseShortfall('25', '10')).toBe('0');
    expect(purchaseShortfall('0', '0')).toBe('0');
  });

  it('formato inesperado → null (no inventa una cantidad)', () => {
    expect(purchaseShortfall('1e3', '10')).toBeNull();
  });
});

describe('stockBarPercent', () => {
  it('fórmula del prototipo: min(100, round(stock / (min*2) * 100))', () => {
    expect(stockBarPercent('10', '10')).toBe(50);
    expect(stockBarPercent('20', '10')).toBe(100);
    expect(stockBarPercent('30', '10')).toBe(100);
    expect(stockBarPercent('5', '10')).toBe(25);
  });

  it('mínimo 0 → null: la UI oculta la barra (nunca un 100% engañoso)', () => {
    expect(stockBarPercent('7', '0')).toBeNull();
    expect(stockBarPercent('0', '0')).toBeNull();
  });

  it('cantidad no numérica → null', () => {
    expect(stockBarPercent('abc', '10')).toBeNull();
  });
});

describe('movementSignedPrefix', () => {
  it('prefijos de display', () => {
    expect(movementSignedPrefix('INCOME')).toBe('+');
    expect(movementSignedPrefix('ADJUSTMENT_INCREASE')).toBe('+');
    expect(movementSignedPrefix('CONSUMPTION')).toBe('−');
    expect(movementSignedPrefix('ADJUSTMENT_DECREASE')).toBe('−');
    expect(movementSignedPrefix('OPENING_BALANCE')).toBe('');
  });
});
