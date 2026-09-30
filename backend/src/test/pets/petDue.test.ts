import { describe, expect, it } from 'vitest';
import { addDays, formatLocalDate, parseLocalDate, toLocalDate } from '../../lib/businessTime';
import {
  computeDueStatus,
  daysUntil,
  DUE_STATUSES,
  dueStatusWhere,
  OPEN_DUE_WHERE,
  FULFILLED_DUE_WHERE,
  UPCOMING_WINDOW_DAYS,
  type DueStatus,
} from '../../pets/petDue';

const TZ = 'America/Argentina/Buenos_Aires';
const today = parseLocalDate('2026-09-30')!;
const plus = (days: number) => addDays(today, days);

describe('computeDueStatus — límites en días de calendario', () => {
  it.each([
    [31, 'SCHEDULED'],
    [30, 'UPCOMING'],
    [12, 'UPCOMING'],
    [1, 'UPCOMING'], // mañana
    [0, 'DUE_TODAY'], // hoy
    [-1, 'OVERDUE'], // ayer
    [-400, 'OVERDUE'],
  ] as const)('faltan %i días → %s', (days, expected) => {
    expect(daysUntil(plus(days), today)).toBe(days);
    expect(computeDueStatus(plus(days), today, false)).toBe(expected);
  });

  it('un pendiente cumplido es CUMPLIDA aunque su fecha haya vencido', () => {
    expect(computeDueStatus(plus(-3), today, true)).toBe('FULFILLED');
    expect(computeDueStatus(plus(40), today, true)).toBe('FULFILLED');
  });

  it('la ventana de «próxima» es de 30 días', () => {
    expect(UPCOMING_WINDOW_DAYS).toBe(30);
  });

  it('cruza meses y años bisiestos sin errores de horario', () => {
    const feb28 = parseLocalDate('2028-02-28')!;
    expect(daysUntil(parseLocalDate('2028-03-01')!, feb28)).toBe(2); // 29/02 existe
    expect(daysUntil(parseLocalDate('2027-01-01')!, parseLocalDate('2026-12-31')!)).toBe(1);
  });
});

describe('cambio de día en BUSINESS_TIME_ZONE (nunca la zona del servidor ni del navegador)', () => {
  const due = parseLocalDate('2026-10-01')!;

  it('23:59 del 30/09 en Buenos Aires (02:59 UTC del 01/10) todavía falta 1 día', () => {
    const local = toLocalDate(new Date('2026-10-01T02:59:00.000Z'), TZ);
    expect(formatLocalDate(local)).toBe('2026-09-30');
    expect(computeDueStatus(due, local, false)).toBe('UPCOMING');
  });

  it('00:00 del 01/10 en Buenos Aires (03:00 UTC) ya vence hoy, y al día siguiente vence', () => {
    const local = toLocalDate(new Date('2026-10-01T03:00:00.000Z'), TZ);
    expect(computeDueStatus(due, local, false)).toBe('DUE_TODAY');
    const nextDay = toLocalDate(new Date('2026-10-02T03:00:00.000Z'), TZ);
    expect(computeDueStatus(due, nextDay, false)).toBe('OVERDUE');
  });
});

/** Evalúa el filtro de fecha de Prisma que arma `dueStatusWhere` sobre una fecha concreta. */
function matchesDate(filter: Record<string, unknown>, value: Date): boolean {
  const time = value.getTime();
  const at = (key: string) => (filter[key] as Date | undefined)?.getTime();
  if (filter.equals !== undefined && time !== at('equals')) return false;
  if (filter.lt !== undefined && !(time < at('lt')!)) return false;
  if (filter.lte !== undefined && !(time <= at('lte')!)) return false;
  if (filter.gt !== undefined && !(time > at('gt')!)) return false;
  return true;
}

describe('dueStatusWhere — la misma regla que computeDueStatus, como filtro', () => {
  const pendingStatuses = DUE_STATUSES.filter((status) => status !== 'FULFILLED');

  it('cada fecha de los límites cae en exactamente el rango de su estado', () => {
    for (const days of [-30, -1, 0, 1, 29, 30, 31, 90]) {
      const date = plus(days);
      const dbDate = new Date(Date.UTC(date.year, date.month - 1, date.day));
      const expected = computeDueStatus(date, today, false);
      const matching = pendingStatuses.filter((status) =>
        matchesDate(
          (dueStatusWhere(status, today).nextDueDate ?? {}) as Record<string, unknown>,
          dbDate,
        ),
      );
      expect(matching).toEqual([expected as DueStatus]);
    }
  });

  it('sin estado: solo pendientes abiertos (vigentes, con fecha y sin cumplimiento vigente)', () => {
    expect(dueStatusWhere(undefined, today)).toEqual(OPEN_DUE_WHERE);
    expect(OPEN_DUE_WHERE).toMatchObject({
      voidedAt: null,
      nextDueDate: { not: null },
      fulfillments: { none: { voidedAt: null } },
    });
  });

  it('CUMPLIDA: registros vigentes con un cumplimiento vigente', () => {
    expect(dueStatusWhere('FULFILLED', today)).toEqual(FULFILLED_DUE_WHERE);
    expect(FULFILLED_DUE_WHERE.fulfillments).toEqual({ some: { voidedAt: null } });
  });
});
