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

describe('stockBarPercent — actual / objetivo', () => {
  it('representa actual / objetivo', () => {
    expect(stockBarPercent('25', '50')).toBe(50);
    expect(stockBarPercent('19', '50')).toBe(38);
    expect(stockBarPercent('0', '50')).toBe(0);
  });

  it('por encima del objetivo: el stock puede superarlo, la barra se limita a 100%', () => {
    expect(stockBarPercent('50', '50')).toBe(100);
    expect(stockBarPercent('80', '50')).toBe(100);
  });

  it('sin objetivo (producto anterior) → null: la UI oculta la barra', () => {
    expect(stockBarPercent('7', null)).toBeNull();
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
