import { describe, expect, it } from 'vitest';
import { movementSignedPrefix, stockBarPercent, stockLevel } from './stockStatus';

describe('stockLevel (docs/BUSINESS_RULES.md §7)', () => {
  it('crítico si stock ≤ 0', () => {
    expect(stockLevel('0', '5')).toBe('crit');
    expect(stockLevel('0.00', '0')).toBe('crit');
  });

  it('bajo si stock < mínimo (excluyendo el crítico)', () => {
    expect(stockLevel('3', '10')).toBe('low');
    expect(stockLevel('9.99', '10')).toBe('low');
  });

  it('ok si stock ≥ mínimo (stock === mínimo cuenta como OK)', () => {
    expect(stockLevel('10', '10')).toBe('ok');
    expect(stockLevel('100', '10')).toBe('ok');
    expect(stockLevel('1', '0')).toBe('ok');
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
