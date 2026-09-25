import { compareLocalDates, type LocalDate } from '../lib/businessTime';

/**
 * Edad y próximo cumpleaños de una mascota (`calcEdad`/`calcProxCumple` del
 * prototipo), calculados en el backend con fechas de `BUSINESS_TIME_ZONE`.
 * Corrección menor: los meses se ajustan por día (el prototipo contaba un
 * mes completo aunque todavía no hubiera llegado el día).
 */

export interface PetAge {
  years: number;
  /** Meses cumplidos en total (para mascotas de menos de un año). */
  months: number;
}

export function computePetAge(birth: LocalDate, today: LocalDate): PetAge | null {
  if (compareLocalDates(birth, today) > 0) return null;
  let months = (today.year - birth.year) * 12 + (today.month - birth.month);
  if (today.day < birth.day) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months };
}

const utcDay = (date: LocalDate) => Date.UTC(date.year, date.month - 1, date.day);

/**
 * Días hasta el próximo cumpleaños (0 = hoy). Un 29/02 se festeja el 01/03
 * en años no bisiestos, igual que el `new Date(año, 1, 29)` del prototipo.
 */
export function daysToNextBirthday(birth: LocalDate, today: LocalDate): number {
  const candidate = (year: number) => {
    const date = new Date(Date.UTC(year, birth.month - 1, birth.day));
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  };
  let next = candidate(today.year);
  if (next < utcDay(today)) next = candidate(today.year + 1);
  return Math.round((next - utcDay(today)) / 86_400_000);
}
