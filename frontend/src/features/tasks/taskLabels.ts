import type { TaskFrequency, TaskScheduleStatus } from '../../api/taskTypes';
import type { BadgeTone } from '../../components/ui/Badge';
import { formatDate, formatDateRange, formatDateTime } from '../../utils/dateFormat';

/** Orden operativo del prototipo (mismo que el backend): urgente → única → diaria → semanal → quincenal → mensual → bimestral → anual. */
export const FREQUENCY_ORDER: readonly TaskFrequency[] = [
  'URGENT',
  'ONE_TIME',
  'DAILY',
  'WEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'BIMONTHLY',
  'ANNUAL',
];

export const FREQUENCY_LABEL: Record<TaskFrequency, string> = {
  URGENT: 'Urgente',
  ONE_TIME: 'Una vez',
  DAILY: 'Diaria',
  WEEKLY: 'Semanal',
  SEMI_MONTHLY: 'Quincenal',
  MONTHLY: 'Mensual',
  BIMONTHLY: 'Bimestral',
  ANNUAL: 'Anual',
};

export const FREQUENCY_FILTER_LABEL: Record<TaskFrequency, string> = {
  URGENT: 'Urgentes',
  ONE_TIME: 'Una vez',
  DAILY: 'Diarias',
  WEEKLY: 'Semanales',
  SEMI_MONTHLY: 'Quincenales',
  MONTHLY: 'Mensuales',
  BIMONTHLY: 'Bimestrales',
  ANNUAL: 'Anuales',
};

/** Orden de los chips de frecuencia del prototipo: Diarias, Semanales, (Quincenales,) Mensuales, (Bimestrales, Anuales,) Urgentes, Una vez. */
export const FREQUENCY_FILTER_ORDER: readonly TaskFrequency[] = [
  'DAILY',
  'WEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'BIMONTHLY',
  'ANNUAL',
  'URGENT',
  'ONE_TIME',
];

/**
 * Colores de etiqueta del prototipo (`td`/`ts`/`tm`/`tu`); "Una vez" usaba el
 * verde por defecto. Quincenal no existía: usa el tono `info` ya existente
 * para distinguirse de semanal y mensual. Bimestral y anual son, como la
 * mensual, períodos largos de calendario: comparten su tono `warning` y se
 * distinguen por el texto.
 */
export const FREQUENCY_TONE: Record<TaskFrequency, BadgeTone> = {
  URGENT: 'danger',
  ONE_TIME: 'positive',
  DAILY: 'positive',
  WEEKLY: 'earth',
  SEMI_MONTHLY: 'info',
  MONTHLY: 'warning',
  BIMONTHLY: 'warning',
  ANNUAL: 'warning',
};

/** Ayuda del formulario: quincenal es por mitades del mes calendario, no "cada 14 días". */
export const SEMI_MONTHLY_HINT = 'Una vez del 1 al 15 y otra del 16 al último día del mes';

/** Ayudas breves de las frecuencias de calendario (no son "desde la última vez"). */
export const FREQUENCY_HINT: Partial<Record<TaskFrequency, string>> = {
  SEMI_MONTHLY: SEMI_MONTHLY_HINT,
  BIMONTHLY: 'Una vez por bimestre calendario: ene–feb, mar–abr…',
  ANNUAL: 'Una vez por año calendario',
};

/** «Una vez» con fecha y sin completar: estado que decide el backend. */
export const SCHEDULE_STATUS_LABEL: Record<TaskScheduleStatus, string> = {
  SCHEDULED: 'Programada',
  DUE_TODAY: 'Para hoy',
  OVERDUE: 'Vencida',
};

export const SCHEDULE_STATUS_TONE: Record<TaskScheduleStatus, BadgeTone> = {
  SCHEDULED: 'neutral',
  DUE_TODAY: 'warning',
  OVERDUE: 'danger',
};

const SEMI_MONTHLY_KEY = /^(\d{4})-(\d{2})-Q([12])$/;
const BIMONTHLY_KEY = /^(\d{4})-B([1-6])$/;
const ANNUAL_KEY = /^(\d{4})-A$/;
const pad = (value: number) => String(value).padStart(2, '0');
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Período de una obligación para mostrar (la clave la decide el backend):
 * `YYYY-MM-DD` → `dd/mm/aaaa`; quincena `YYYY-MM-Q1/Q2` → `01/10/2026 al
 * 15/10/2026` o `16/10/2026 al 31/10/2026` (último día real del mes);
 * bimestre `YYYY-B5` → `01/09/2026 al 31/10/2026`; año `YYYY-A` →
 * `01/01/2026 al 31/12/2026`.
 */
export function formatPeriodKey(periodKey: string): string {
  const quincena = SEMI_MONTHLY_KEY.exec(periodKey);
  if (quincena) {
    const [, year, month, half] = quincena;
    const lastDay = lastDayOf(Number(year), Number(month));
    return half === '1'
      ? formatDateRange(`${year}-${month}-01`, `${year}-${month}-15`)
      : formatDateRange(`${year}-${month}-16`, `${year}-${month}-${lastDay}`);
  }
  const bimester = BIMONTHLY_KEY.exec(periodKey);
  if (bimester) {
    const [, year, index] = bimester;
    const endMonth = Number(index) * 2;
    return formatDateRange(
      `${year}-${pad(endMonth - 1)}-01`,
      `${year}-${pad(endMonth)}-${lastDayOf(Number(year), endMonth)}`,
    );
  }
  const annual = ANNUAL_KEY.exec(periodKey);
  if (annual) return formatDateRange(`${annual[1]}-01-01`, `${annual[1]}-12-31`);
  return formatDate(periodKey);
}

/**
 * Fecha y hora de una finalización para mostrar (nunca para decidir
 * períodos: eso es del backend), en la zona de negocio que devuelve la API:
 * "hoy, 14:35" o, si no es hoy, `dd/mm/aaaa HH:mm`.
 */
export function formatCompletedAt(iso: string, timeZone: string, today: string): string {
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
  const full = formatDateTime(iso, timeZone);
  return dayKey === today ? `hoy, ${full.slice(11)}` : full;
}

/** `YYYY-MM-DD` → "lun 22 sep" (la fecha ya es local; se formatea en UTC para no desplazarla). */
export function formatLocalDay(key: string, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...options,
  }).format(new Date(`${key}T00:00:00Z`));
}
