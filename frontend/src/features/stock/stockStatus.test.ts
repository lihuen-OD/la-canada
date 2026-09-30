import { describe, expect, it } from 'vitest';
import { movementSignedPrefix, stockBarPercent } from './stockStatus';

describe('nivel de stock: responsabilidad exclusiva del backend', () => {
  it('el módulo visual ya no exporta una regla de nivel propia', async () => {
    const module = await import('./stockStatus');
    expect(module).not.toHaveProperty('stockLevel');
  });
});

describe('cantidad sugerida de Compras: responsabilidad exclusiva del backend', () => {
  it('el módulo visual ya no calcula faltantes propios (usa suggestedPurchaseQuantity)', async () => {
    const module = await import('./stockStatus');
    expect(module).not.toHaveProperty('purchaseShortfall');
  });
});

describe('stockBarPercent', () => {
  it('con objetivo: actual / objetivo', () => {
    expect(stockBarPercent('25', '20', '50')).toBe(50);
    expect(stockBarPercent('19', '20', '50')).toBe(38);
    expect(stockBarPercent('0', '20', '50')).toBe(0);
  });

  it('por encima del objetivo: el stock puede superarlo, la barra se limita a 100%', () => {
    expect(stockBarPercent('50', '20', '50')).toBe(100);
    expect(stockBarPercent('80', '20', '50')).toBe(100);
  });

  it('sin objetivo (producto anterior): la fórmula previa, min(100, round(stock / (min*2) * 100))', () => {
    expect(stockBarPercent('10', '10', null)).toBe(50);
    expect(stockBarPercent('30', '10', null)).toBe(100);
    expect(stockBarPercent('7', '0', null)).toBeNull(); // mínimo 0: sin barra
  });

  it('cantidad no numérica → null', () => {
    expect(stockBarPercent('abc', '10', '20')).toBeNull();
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
