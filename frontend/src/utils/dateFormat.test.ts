import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatDateRange, formatDateTime, formatPercentage } from './dateFormat';

describe('formatDate (dd/mm/aaaa)', () => {
  it.each([
    ['2026-09-28', '28/09/2026'],
    ['2026-01-05', '05/01/2026'], // ceros iniciales
    ['2025-12-31', '31/12/2025'], // fin de año
    ['2026-01-01', '01/01/2026'], // inicio de año
    ['2028-02-29', '29/02/2028'], // bisiesto
  ])('%s → %s', (input, expected) => expect(formatDate(input)).toBe(expected));

  it('una fecha sin hora nunca se corre por UTC, sea cual sea la zona del navegador', () => {
    // Si se usara new Date('2026-09-28') en una zona al oeste de UTC, saldría el 27.
    const spy = vi.spyOn(Date.prototype, 'getDate');
    expect(formatDate('2026-09-28')).toBe('28/09/2026');
    expect(spy).not.toHaveBeenCalled();
  });

  it('un timestamp se formatea en la zona de negocio', () => {
    // 02:30 UTC del 29/09 todavía es 28/09 en Buenos Aires (UTC−3).
    expect(formatDate('2026-09-29T02:30:00.000Z')).toBe('28/09/2026');
  });

  it.each([null, undefined, '', 'no-es-fecha'])('%s → vacío', (value) =>
    expect(formatDate(value)).toBe(''),
  );
});

describe('formatDateTime (dd/mm/aaaa HH:mm)', () => {
  afterEach(() => vi.restoreAllMocks());
  it('usa la zona de negocio y no muestra segundos', () => {
    expect(formatDateTime('2026-09-28T17:35:59.000Z')).toBe('28/09/2026 14:35');
  });
  it('medianoche en 24 h', () => {
    expect(formatDateTime('2026-01-05T03:00:00.000Z')).toBe('05/01/2026 00:00');
  });
  it('nulos → vacío', () => {
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime('x')).toBe('');
  });
});

describe('formatDateRange', () => {
  it('dos fechas', () =>
    expect(formatDateRange('2026-09-22', '2026-09-28')).toBe('22/09/2026 al 28/09/2026'));
  it('mismo día: una sola fecha', () =>
    expect(formatDateRange('2026-09-28', '2026-09-28')).toBe('28/09/2026'));
  it('con un extremo nulo muestra el otro', () =>
    expect(formatDateRange('2026-09-28', null)).toBe('28/09/2026'));
});

describe('formatPercentage', () => {
  it('coma decimal argentina y Sin datos', () => {
    expect(formatPercentage(66.7)).toBe('66,7%');
    expect(formatPercentage(80)).toBe('80%');
    expect(formatPercentage(null)).toBe('Sin datos');
  });
});
