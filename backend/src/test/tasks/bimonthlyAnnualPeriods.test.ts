import { describe, expect, it } from 'vitest';
import {
  annualPeriodKey,
  bimesterOf,
  bimonthlyPeriodKey,
  computePeriodKey,
  formatLocalDate,
  isBimesterStart,
  nextBimesterStart,
  parseLocalDate,
} from '../../lib/businessTime';

const AR = 'America/Argentina/Buenos_Aires';
const at = (iso: string) => new Date(iso);
const day = (value: string) => parseLocalDate(value)!;

describe('BIMONTHLY — bimestres de calendario en la zona de negocio', () => {
  it.each([
    ['2026-01-01', '2026-B1'],
    ['2026-02-28', '2026-B1'],
    ['2026-03-01', '2026-B2'],
    ['2026-04-30', '2026-B2'],
    ['2026-05-01', '2026-B3'],
    ['2026-06-30', '2026-B3'],
    ['2026-07-01', '2026-B4'],
    ['2026-08-31', '2026-B4'],
    ['2026-09-01', '2026-B5'],
    ['2026-10-31', '2026-B5'],
    ['2026-11-01', '2026-B6'],
    ['2026-12-31', '2026-B6'],
  ])('%s → %s', (value, key) => {
    expect(bimonthlyPeriodKey(day(value))).toBe(key);
  });

  it('el bimestre empieza el 1 de cada mes impar y termina el último día del mes par', () => {
    expect(isBimesterStart(day('2026-09-01'))).toBe(true);
    expect(isBimesterStart(day('2026-10-01'))).toBe(false);
    expect(isBimesterStart(day('2026-09-02'))).toBe(false);
    expect(bimesterOf(day('2026-10-15'))).toBe(5);
    const next = (value: string) => formatLocalDate(nextBimesterStart(day(value)));
    expect(next('2026-09-01')).toBe('2026-11-01');
    expect(next('2026-10-31')).toBe('2026-11-01');
    expect(next('2026-11-01')).toBe('2027-01-01');
    expect(next('2026-12-31')).toBe('2027-01-01');
  });

  it('año bisiesto: el 29/02 es parte de ene–feb y el 01/03 ya es otro bimestre', () => {
    const key = (iso: string) => computePeriodKey('BIMONTHLY', at(iso), AR);
    expect(key('2028-03-01T02:59:59.999Z')).toBe('2028-B1'); // 29/02 23:59:59 AR
    expect(key('2028-03-01T03:00:00.000Z')).toBe('2028-B2'); // 01/03 00:00 AR
    expect(key('2027-03-01T02:59:59.999Z')).toBe('2027-B1'); // 28/02 23:59:59 AR (no bisiesto)
  });

  it('medianoche de Buenos Aires, no de UTC: 31/10 23:59 AR sigue en sep–oct', () => {
    const instant = at('2026-11-01T02:30:00.000Z'); // 31/10 23:30 AR, ya 01/11 en UTC
    expect(computePeriodKey('BIMONTHLY', instant, AR)).toBe('2026-B5');
    expect(computePeriodKey('BIMONTHLY', instant, 'UTC')).toBe('2026-B6');
  });

  it('cambio de año: 31/12 → 01/01', () => {
    const key = (iso: string) => computePeriodKey('BIMONTHLY', at(iso), AR);
    expect(key('2027-01-01T02:59:59.999Z')).toBe('2026-B6');
    expect(key('2027-01-01T03:00:00.000Z')).toBe('2027-B1');
  });
});

describe('ANNUAL — año calendario en la zona de negocio', () => {
  it('del 1 de enero al 31 de diciembre, con su propia clave', () => {
    expect(annualPeriodKey(day('2026-01-01'))).toBe('2026-A');
    expect(annualPeriodKey(day('2026-12-31'))).toBe('2026-A');
    expect(annualPeriodKey(day('2028-02-29'))).toBe('2028-A');
  });

  it('31/12 23:59 en Buenos Aires sigue siendo el año anterior aunque en UTC ya sea enero', () => {
    const key = (iso: string, zone = AR) => computePeriodKey('ANNUAL', at(iso), zone);
    expect(key('2027-01-01T02:59:59.999Z')).toBe('2026-A');
    expect(key('2027-01-01T03:00:00.000Z')).toBe('2027-A');
    expect(key('2027-01-01T02:30:00.000Z', 'UTC')).toBe('2027-A');
  });
});

describe('claves explícitas: nunca coinciden con las de otra frecuencia', () => {
  it.each([
    '2026-01-01T15:00:00.000Z',
    '2026-09-01T15:00:00.000Z',
    '2026-10-16T15:00:00.000Z',
    '2026-12-31T15:00:00.000Z',
  ])('el %s cada frecuencia tiene una clave distinta', (iso) => {
    const keys = (
      [
        'DAILY',
        'WEEKLY',
        'SEMI_MONTHLY',
        'MONTHLY',
        'BIMONTHLY',
        'ANNUAL',
        'URGENT',
        'ONE_TIME',
      ] as const
    ).map((frequency) => computePeriodKey(frequency, at(iso), AR));
    // DAILY, WEEKLY y MONTHLY pueden coincidir entre sí el 1 de un mes que
    // empieza en lunes (comportamiento previo); las nuevas nunca coinciden con nada.
    for (const key of keys.slice(4)) expect(keys.filter((other) => other === key)).toHaveLength(1);
    expect(keys[4]).toMatch(/^\d{4}-B[1-6]$/);
    expect(keys[5]).toMatch(/^\d{4}-A$/);
  });
});
