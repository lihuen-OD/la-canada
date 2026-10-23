import type { TaskFrequency } from '../generated/prisma/enums';
import { ValidationError } from '../errors/AppError';
import { compareLocalDates, parseLocalDate, type LocalDate } from '../lib/businessTime';

/**
 * «Fecha para realizar» de las tareas «Una vez» (`ONE_TIME`) — la ÚNICA
 * definición de su estado. Es una fecha de CALENDARIO de `BUSINESS_TIME_ZONE`
 * (`@db.Date`, sin hora): nunca se compara un instante, así que el día no
 * depende de la zona del servidor ni del navegador.
 *
 * Una tarea con fecha y sin finalización vigente está:
 *   - `SCHEDULED` (programada): la fecha es posterior a hoy;
 *   - `DUE_TODAY` (para hoy): la fecha es hoy;
 *   - `OVERDUE` (vencida): la fecha ya pasó.
 * Sin fecha, ya completada o de otra frecuencia: `null` (se presenta como
 * siempre). La fecha no cambia el período: la clave sigue siendo `ONE_TIME`,
 * así que reprogramar nunca crea otra obligación ni permite completarla dos
 * veces.
 */
export type ScheduleStatus = 'SCHEDULED' | 'DUE_TODAY' | 'OVERDUE';

export const SCHEDULED_DATE_ONLY_ONE_TIME =
  'La fecha para realizar solo se puede indicar en tareas «Una vez».';

/** Valor de una columna `@db.Date` (medianoche UTC = la fecha de calendario) → `YYYY-MM-DD`. */
export function scheduledDateText(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** `YYYY-MM-DD` → valor para una columna `@db.Date`. */
export function scheduledDateValue(text: string | null): Date | null {
  return text ? new Date(`${text}T00:00:00.000Z`) : null;
}

export function scheduleStatusOf(
  scheduledDate: string | null,
  today: LocalDate,
  completed: boolean,
): ScheduleStatus | null {
  const due = scheduledDate ? parseLocalDate(scheduledDate) : null;
  if (!due || completed) return null;
  const order = compareLocalDates(due, today);
  return order > 0 ? 'SCHEDULED' : order === 0 ? 'DUE_TODAY' : 'OVERDUE';
}

/** Una fecha enviada para una frecuencia que no es «Una vez» se rechaza (nunca se ignora). */
export function assertScheduledDateFits(
  frequency: TaskFrequency,
  scheduledDate: string | null | undefined,
): void {
  if (scheduledDate != null && frequency !== 'ONE_TIME') {
    throw new ValidationError(SCHEDULED_DATE_ONLY_ONE_TIME);
  }
}
