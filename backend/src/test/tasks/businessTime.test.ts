import { describe, expect, it } from 'vitest';
import {
  addDays,
  computePeriodKey,
  formatLocalDate,
  nextSemiMonthStart,
  parseLocalDate,
  semiMonthlyPeriodKey,
  startOfLocalDay,
  startOfWeek,
  toLocalDate,
} from '../../lib/businessTime';

const AR = 'America/Argentina/Buenos_Aires';
const at = (iso: string) => new Date(iso);

describe('businessTime — zona de negocio (Argentina)', () => {
  it('23:30 en Buenos Aires (02:30 UTC del día siguiente) sigue siendo el día local', () => {
    const instant = at('2026-09-25T02:30:00.000Z'); // 24/09 23:30 en AR
    expect(formatLocalDate(toLocalDate(instant, AR))).toBe('2026-09-24');
    expect(computePeriodKey('DAILY', instant, AR)).toBe('2026-09-24');
  });

  it('00:30 en Buenos Aires (03:30 UTC) ya es el día siguiente', () => {
    expect(computePeriodKey('DAILY', at('2026-09-25T03:30:00.000Z'), AR)).toBe('2026-09-25');
  });

  it('la misma instancia UTC da otro día en UTC — por eso nunca se usa la zona del proceso', () => {
    const instant = at('2026-09-25T02:30:00.000Z');
    expect(computePeriodKey('DAILY', instant, 'UTC')).toBe('2026-09-25');
    expect(computePeriodKey('DAILY', instant, AR)).toBe('2026-09-24');
  });
});

describe('computePeriodKey', () => {
  it('WEEKLY: la semana empieza el lunes', () => {
    expect(computePeriodKey('WEEKLY', at('2026-09-21T15:00:00.000Z'), AR)).toBe('2026-09-21'); // lunes
    expect(computePeriodKey('WEEKLY', at('2026-09-24T15:00:00.000Z'), AR)).toBe('2026-09-21'); // jueves
    expect(computePeriodKey('WEEKLY', at('2026-09-27T15:00:00.000Z'), AR)).toBe('2026-09-21'); // domingo
  });

  it('WEEKLY: domingo 23:30 local (lunes 02:30 UTC) sigue en la semana que termina', () => {
    expect(computePeriodKey('WEEKLY', at('2026-09-28T02:30:00.000Z'), AR)).toBe('2026-09-21');
    expect(computePeriodKey('WEEKLY', at('2026-09-28T03:30:00.000Z'), AR)).toBe('2026-09-28');
  });

  it('WEEKLY: semana que cruza cambio de mes y de año', () => {
    expect(computePeriodKey('WEEKLY', at('2026-10-02T15:00:00.000Z'), AR)).toBe('2026-09-28');
    expect(computePeriodKey('WEEKLY', at('2027-01-01T15:00:00.000Z'), AR)).toBe('2026-12-28');
  });

  it('MONTHLY: primer día del mes local, incluso a las 23:30 del último día', () => {
    expect(computePeriodKey('MONTHLY', at('2026-09-15T12:00:00.000Z'), AR)).toBe('2026-09-01');
    expect(computePeriodKey('MONTHLY', at('2026-10-01T02:30:00.000Z'), AR)).toBe('2026-09-01'); // 30/09 23:30 AR
    expect(computePeriodKey('MONTHLY', at('2026-10-01T03:30:00.000Z'), AR)).toBe('2026-10-01');
  });

  it('SEMI_MONTHLY: días 1 y 15 son la primera quincena; 16 y el último día, la segunda', () => {
    const key = (iso: string) => computePeriodKey('SEMI_MONTHLY', at(iso), AR);
    expect(key('2026-10-01T15:00:00.000Z')).toBe('2026-10-Q1');
    expect(key('2026-10-10T15:00:00.000Z')).toBe('2026-10-Q1');
    expect(key('2026-10-15T15:00:00.000Z')).toBe('2026-10-Q1');
    expect(key('2026-10-16T15:00:00.000Z')).toBe('2026-10-Q2');
    expect(key('2026-10-20T15:00:00.000Z')).toBe('2026-10-Q2');
    expect(key('2026-10-31T15:00:00.000Z')).toBe('2026-10-Q2');
    expect(key('2026-09-30T15:00:00.000Z')).toBe('2026-09-Q2'); // mes de 30 días
  });

  it('SEMI_MONTHLY: febrero normal (28) y bisiesto (29) terminan la segunda quincena', () => {
    const key = (iso: string) => computePeriodKey('SEMI_MONTHLY', at(iso), AR);
    expect(key('2027-02-15T15:00:00.000Z')).toBe('2027-02-Q1');
    expect(key('2027-02-16T15:00:00.000Z')).toBe('2027-02-Q2');
    expect(key('2027-02-28T15:00:00.000Z')).toBe('2027-02-Q2');
    expect(key('2027-03-01T15:00:00.000Z')).toBe('2027-03-Q1');
    expect(key('2028-02-28T15:00:00.000Z')).toBe('2028-02-Q2');
    expect(key('2028-02-29T15:00:00.000Z')).toBe('2028-02-Q2');
    expect(key('2028-03-01T15:00:00.000Z')).toBe('2028-03-Q1');
  });

  it('SEMI_MONTHLY: los límites son la medianoche de Buenos Aires, no la de UTC', () => {
    const key = (iso: string) => computePeriodKey('SEMI_MONTHLY', at(iso), AR);
    // 15/10 23:59:59 AR = 16/10 02:59:59 UTC → todavía primera quincena.
    expect(key('2026-10-16T02:59:59.999Z')).toBe('2026-10-Q1');
    expect(key('2026-10-16T03:00:00.000Z')).toBe('2026-10-Q2');
    // 31/10 23:59:59 AR → segunda quincena de octubre; 01/11 00:00 AR → primera de noviembre.
    expect(key('2026-11-01T02:59:59.999Z')).toBe('2026-10-Q2');
    expect(key('2026-11-01T03:00:00.000Z')).toBe('2026-11-Q1');
    // El mismo instante en UTC ya sería la otra quincena: nunca se usa la zona del proceso.
    expect(computePeriodKey('SEMI_MONTHLY', at('2026-10-16T02:30:00.000Z'), 'UTC')).toBe(
      '2026-10-Q2',
    );
  });

  it('SEMI_MONTHLY: cambio de año', () => {
    const key = (iso: string) => computePeriodKey('SEMI_MONTHLY', at(iso), AR);
    expect(key('2027-01-01T02:59:59.999Z')).toBe('2026-12-Q2'); // 31/12 23:59:59 AR
    expect(key('2027-01-01T03:00:00.000Z')).toBe('2027-01-Q1');
  });

  it('SEMI_MONTHLY: su clave nunca coincide con la de otra frecuencia del mismo día', () => {
    for (const iso of ['2026-10-01T15:00:00.000Z', '2026-10-16T15:00:00.000Z']) {
      const semiMonthly = computePeriodKey('SEMI_MONTHLY', at(iso), AR);
      for (const other of ['DAILY', 'WEEKLY', 'MONTHLY', 'URGENT', 'ONE_TIME'] as const) {
        expect(computePeriodKey(other, at(iso), AR)).not.toBe(semiMonthly);
      }
    }
  });

  it('URGENT y ONE_TIME: clave estable, independiente de la fecha', () => {
    for (const iso of ['2026-01-01T00:00:00.000Z', '2027-06-15T12:00:00.000Z']) {
      expect(computePeriodKey('URGENT', at(iso), AR)).toBe('URGENT');
      expect(computePeriodKey('ONE_TIME', at(iso), AR)).toBe('ONE_TIME');
    }
  });
});

describe('fechas locales', () => {
  it('parseLocalDate rechaza fechas inexistentes o mal formadas', () => {
    expect(parseLocalDate('2026-02-29')).toBeNull();
    expect(parseLocalDate('2026-13-01')).toBeNull();
    expect(parseLocalDate('24/09/2026')).toBeNull();
    expect(parseLocalDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it('startOfWeek y addDays operan sobre el calendario', () => {
    expect(formatLocalDate(startOfWeek({ year: 2026, month: 9, day: 27 }))).toBe('2026-09-21');
    expect(formatLocalDate(addDays({ year: 2026, month: 2, day: 28 }, 1))).toBe('2026-03-01');
  });

  it('nextSemiMonthStart: del 1–15 al 16; del 16 en adelante al 1 del mes (y año) siguiente', () => {
    const next = (value: string) => formatLocalDate(nextSemiMonthStart(parseLocalDate(value)!));
    expect(next('2026-10-01')).toBe('2026-10-16');
    expect(next('2026-10-15')).toBe('2026-10-16');
    expect(next('2026-10-16')).toBe('2026-11-01');
    expect(next('2028-02-29')).toBe('2028-03-01');
    expect(next('2026-12-16')).toBe('2027-01-01');
    expect(semiMonthlyPeriodKey(parseLocalDate('2027-01-15')!)).toBe('2027-01-Q1');
  });

  it('startOfLocalDay devuelve la medianoche local expresada en UTC', () => {
    expect(startOfLocalDay({ year: 2026, month: 9, day: 24 }, AR).toISOString()).toBe(
      '2026-09-24T03:00:00.000Z',
    );
    expect(startOfLocalDay({ year: 2026, month: 9, day: 24 }, 'UTC').toISOString()).toBe(
      '2026-09-24T00:00:00.000Z',
    );
  });
});
