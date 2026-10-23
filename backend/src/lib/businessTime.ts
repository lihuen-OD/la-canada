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

/**
 * Quincenas: dos por mes calendario, del 1 al 15 y del 16 al último día
 * (28, 29, 30 o 31). No es "cada 14 días": no depende de la creación de la
 * tarea ni de su última ejecución.
 */
export const SECOND_HALF_FIRST_DAY = 16;

/** Primer día de la quincena siguiente: el 16 del mismo mes o el 1 del mes siguiente. */
export function nextSemiMonthStart(date: LocalDate): LocalDate {
  if (date.day < SECOND_HALF_FIRST_DAY) return { ...date, day: SECOND_HALF_FIRST_DAY };
  return date.month === 12
    ? { year: date.year + 1, month: 1, day: 1 }
    : { year: date.year, month: date.month + 1, day: 1 };
}

/**
 * `YYYY-MM-Q1` (días 1–15) o `YYYY-MM-Q2` (16–último día). Deliberadamente
 * NO es una fecha: si una tarea cambia de frecuencia dentro del período, una
 * ejecución diaria, semanal o mensual anterior (`YYYY-MM-DD`) nunca coincide
 * con la clave quincenal ni se reinterpreta como cumplimiento de la quincena.
 */
export function semiMonthlyPeriodKey(date: LocalDate): string {
  const half = date.day < SECOND_HALF_FIRST_DAY ? 1 : 2;
  return `${pad(date.year, 4)}-${pad(date.month)}-Q${half}`;
}

/**
 * Bimestres: seis por año calendario — ene–feb (1), mar–abr (2), may–jun (3),
 * jul–ago (4), sep–oct (5) y nov–dic (6). No es "cada dos meses" desde la
 * creación ni desde la última ejecución.
 */
export function bimesterOf(date: LocalDate): number {
  return Math.ceil(date.month / 2);
}

/** El 1 de un mes impar (ene, mar, may, jul, sep, nov) empieza un bimestre. */
export function isBimesterStart(date: LocalDate): boolean {
  return date.day === 1 && date.month % 2 === 1;
}

/** Primer día del bimestre siguiente (el 1 de enero del año siguiente después de nov–dic). */
export function nextBimesterStart(date: LocalDate): LocalDate {
  const bimester = bimesterOf(date);
  return bimester === 6
    ? { year: date.year + 1, month: 1, day: 1 }
    : { year: date.year, month: bimester * 2 + 1, day: 1 };
}

/**
 * `YYYY-B1` (ene–feb) … `YYYY-B6` (nov–dic). Como la quincenal, NO es una
 * fecha: una ejecución de otra frecuencia nunca coincide con la clave
 * bimestral ni la "cumple" si la tarea cambia de frecuencia.
 */
export function bimonthlyPeriodKey(date: LocalDate): string {
  return `${pad(date.year, 4)}-B${bimesterOf(date)}`;
}

/** Año calendario: del 1 de enero al 31 de diciembre. Clave `YYYY-A` (tampoco es una fecha). */
export function annualPeriodKey(date: LocalDate): string {
  return `${pad(date.year, 4)}-A`;
}

/** Claves fijas de las frecuencias no recurrentes (una sola ejecución vigente). */
export const URGENT_PERIOD_KEY = 'URGENT';
export const ONE_TIME_PERIOD_KEY = 'ONE_TIME';

/**
 * `periodKey` de una finalización — el backend es la única autoridad (el
 * navegador nunca lo envía):
 *  - DAILY:        fecha local del día          `YYYY-MM-DD`
 *  - WEEKLY:       lunes de la semana local     `YYYY-MM-DD`
 *  - SEMI_MONTHLY: quincena del mes local       `YYYY-MM-Q1` / `YYYY-MM-Q2`
 *  - MONTHLY:      primer día del mes local     `YYYY-MM-01`
 *  - BIMONTHLY:    bimestre del año local       `YYYY-B1` … `YYYY-B6`
 *  - ANNUAL:       año local                    `YYYY-A`
 *  - URGENT:       `URGENT` (vigente hasta que se revierta)
 *  - ONE_TIME:     `ONE_TIME` (vigente hasta que se revierta)
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
    case 'SEMI_MONTHLY':
      return semiMonthlyPeriodKey(today);
    case 'MONTHLY':
      return formatLocalDate({ ...today, day: 1 });
    case 'BIMONTHLY':
      return bimonthlyPeriodKey(today);
    case 'ANNUAL':
      return annualPeriodKey(today);
    case 'URGENT':
      return URGENT_PERIOD_KEY;
    case 'ONE_TIME':
      return ONE_TIME_PERIOD_KEY;
  }
}
