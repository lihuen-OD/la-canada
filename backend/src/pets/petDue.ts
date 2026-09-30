import type { Prisma } from '../generated/prisma/client';
import { addDays, parseLocalDate, type LocalDate } from '../lib/businessTime';

/**
 * Próximas aplicaciones o controles de los registros clínicos — la ÚNICA
 * definición de sus estados, compartida por las respuestas (`computeDueStatus`)
 * y por las consultas (`dueStatusWhere`). Todo con fechas de CALENDARIO de
 * `BUSINESS_TIME_ZONE` (`next_due_date` es `@db.Date`): nunca se comparan
 * instantes con hora, así que el día no cambia según la zona del servidor o
 * del navegador.
 *
 * Un registro tiene un PENDIENTE si está vigente (sin anular) y tiene fecha
 * programada. Está CUMPLIDO mientras exista un registro vigente vinculado
 * explícitamente con él (`fulfillsRecordId`); si ese registro se anula, el
 * pendiente se reabre solo. Estados, en días que faltan (fecha − hoy):
 *   - `FULFILLED` (cumplida): tiene un cumplimiento vigente;
 *   - `OVERDUE` (vencida): < 0;
 *   - `DUE_TODAY` (vence hoy): 0;
 *   - `UPCOMING` (próxima): de 1 a 30;
 *   - `SCHEDULED` (vigente): más de 30.
 */
export const UPCOMING_WINDOW_DAYS = 30;

export type DueStatus = 'SCHEDULED' | 'UPCOMING' | 'DUE_TODAY' | 'OVERDUE' | 'FULFILLED';
export type PendingDueStatus = Exclude<DueStatus, 'FULFILLED'>;

export const DUE_STATUSES: readonly DueStatus[] = [
  'OVERDUE',
  'DUE_TODAY',
  'UPCOMING',
  'SCHEDULED',
  'FULFILLED',
];

const utcDay = (date: LocalDate) => Date.UTC(date.year, date.month - 1, date.day);
const toDbDate = (date: LocalDate): Date => new Date(utcDay(date));

/** Días de calendario que faltan (negativo = transcurridos). */
export function daysUntil(due: LocalDate, today: LocalDate): number {
  return Math.round((utcDay(due) - utcDay(today)) / 86_400_000);
}

export function computeDueStatus(due: LocalDate, today: LocalDate, fulfilled: boolean): DueStatus {
  if (fulfilled) return 'FULFILLED';
  const days = daysUntil(due, today);
  if (days < 0) return 'OVERDUE';
  if (days === 0) return 'DUE_TODAY';
  if (days <= UPCOMING_WINDOW_DAYS) return 'UPCOMING';
  return 'SCHEDULED';
}

/** `next_due_date` de Prisma (medianoche UTC = la fecha de calendario) → LocalDate. */
export function dueDateOf(value: Date): LocalDate {
  return parseLocalDate(value.toISOString().slice(0, 10))!;
}

/** Condición de «tiene pendiente sin cumplir» (registro vigente con fecha y sin cumplimiento vigente). */
export const OPEN_DUE_WHERE = {
  voidedAt: null,
  nextDueDate: { not: null },
  fulfillments: { none: { voidedAt: null } },
} satisfies Prisma.AnimalMedicalRecordWhereInput;

/** Condición de «pendiente cumplido» (con un cumplimiento vigente). */
export const FULFILLED_DUE_WHERE = {
  voidedAt: null,
  nextDueDate: { not: null },
  fulfillments: { some: { voidedAt: null } },
} satisfies Prisma.AnimalMedicalRecordWhereInput;

/**
 * Misma regla que `computeDueStatus`, como filtro de Prisma: cada estado es un
 * rango de fechas relativo a `today` (los límites salen de las mismas
 * constantes). Sin estado: todos los pendientes abiertos.
 */
export function dueStatusWhere(
  status: DueStatus | undefined,
  today: LocalDate,
): Prisma.AnimalMedicalRecordWhereInput {
  if (status === 'FULFILLED') return FULFILLED_DUE_WHERE;
  const todayDb = toDbDate(today);
  const windowEnd = toDbDate(addDays(today, UPCOMING_WINDOW_DAYS));
  const range: Record<PendingDueStatus, Prisma.DateTimeFilter> = {
    OVERDUE: { lt: todayDb },
    DUE_TODAY: { equals: todayDb },
    UPCOMING: { gt: todayDb, lte: windowEnd },
    SCHEDULED: { gt: windowEnd },
  };
  return status
    ? { ...OPEN_DUE_WHERE, nextDueDate: { not: null, ...range[status] } }
    : OPEN_DUE_WHERE;
}

/** Fin del día de alerta de los indicadores del listado (vencidas, hoy y próximas). */
export function alertWindowEnd(today: LocalDate): Date {
  return toDbDate(addDays(today, UPCOMING_WINDOW_DAYS));
}

/** Vencida / hoy / próxima (1–30 días) para un indicador; `null` si es vigente (> 30). */
export function isAlertStatus(status: DueStatus): status is 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING' {
  return status === 'OVERDUE' || status === 'DUE_TODAY' || status === 'UPCOMING';
}
