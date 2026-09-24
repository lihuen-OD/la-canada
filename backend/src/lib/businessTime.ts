import type { TaskFrequency } from '../generated/prisma/enums';

/**
 * Fechas de negocio — ÚNICA fuente de verdad para "qué día / semana / mes
 * es" en La Cañada. Todo cálculo de período de tareas pasa por acá, con una
 * zona horaria IANA explícita (`config.businessTimeZone`), nunca con la
 * zona del proceso ni con offsets fijos: una finalización a las 23:30 de
 * Buenos Aires (02:30 UTC del día siguiente) pertenece al día local, no al
 * día UTC. Funciones puras (reciben el instante y la zona) para poder
 * testearlas cerca de medianoche UTC y en cambios de semana/mes.
 */

/** Fecha de calendario local, sin hora. `month` va de 1 a 12. */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(
  instant: Date,
  timeZone: string,
): LocalDate & { hour: number; minute: number; second: number } {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Fecha local (en `timeZone`) del instante dado. */
export function toLocalDate(instant: Date, timeZone: string): LocalDate {
  const { year, month, day } = zonedParts(instant, timeZone);
  return { year, month, day };
}

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

export function formatLocalDate(date: LocalDate): string {
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

/** Parseo estricto de `YYYY-MM-DD` — rechaza fechas inexistentes (`2026-02-30`). */
export function parseLocalDate(value: string): LocalDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const check = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (
    check.getUTCFullYear() !== date.year ||
    check.getUTCMonth() !== date.month - 1 ||
    check.getUTCDate() !== date.day
  ) {
    return null;
  }
  return date;
}

/** Aritmética de calendario pura (sin zona horaria: una fecha local no tiene hora). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return formatLocalDate(a).localeCompare(formatLocalDate(b));
}

/** Lunes de la semana (lunes a domingo) que contiene `date`. */
export function startOfWeek(date: LocalDate): LocalDate {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay(); // 0 = domingo
  const daysSinceMonday = (weekday + 6) % 7;
  return addDays(date, -daysSinceMonday);
}

/** Primer instante (UTC) del día local `date` en `timeZone` — respeta cambios de horario si los hubiera. */
export function startOfLocalDay(date: LocalDate, timeZone: string): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day);
  const offsetAt = (instant: number): number => {
    const parts = zonedParts(new Date(instant), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    return asUtc - Math.floor(instant / 1000) * 1000;
  };
  const firstOffset = offsetAt(guess);
  let result = guess - firstOffset;
  const secondOffset = offsetAt(result);
  if (secondOffset !== firstOffset) result = guess - secondOffset;
  return new Date(result);
}

/** Claves fijas de las frecuencias no recurrentes (una sola ejecución vigente). */
export const URGENT_PERIOD_KEY = 'URGENT';
export const ONE_TIME_PERIOD_KEY = 'ONE_TIME';

/**
 * `periodKey` de una finalización — el backend es la única autoridad (el
 * navegador nunca lo envía):
 *  - DAILY:    fecha local del día          `YYYY-MM-DD`
 *  - WEEKLY:   lunes de la semana local     `YYYY-MM-DD`
 *  - MONTHLY:  primer día del mes local     `YYYY-MM-01`
 *  - URGENT:   `URGENT` (vigente hasta que se revierta)
 *  - ONE_TIME: `ONE_TIME` (vigente hasta que se revierta)
 */
export function computePeriodKey(
  frequency: TaskFrequency,
  instant: Date,
  timeZone: string,
): string {
  const today = toLocalDate(instant, timeZone);
  switch (frequency) {
    case 'DAILY':
      return formatLocalDate(today);
    case 'WEEKLY':
      return formatLocalDate(startOfWeek(today));
    case 'MONTHLY':
      return formatLocalDate({ ...today, day: 1 });
    case 'URGENT':
      return URGENT_PERIOD_KEY;
    case 'ONE_TIME':
      return ONE_TIME_PERIOD_KEY;
  }
}
