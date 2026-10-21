import type { TaskFrequency } from '../../api/taskTypes';
import type { BadgeTone } from '../../components/ui/Badge';
import { formatDate, formatDateRange, formatDateTime } from '../../utils/dateFormat';

/** Orden operativo del prototipo (mismo que el backend): urgente → única → diaria → semanal → quincenal → mensual. */
export const FREQUENCY_ORDER: readonly TaskFrequency[] = [
  'URGENT',
  'ONE_TIME',
  'DAILY',
  'WEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
];

export const FREQUENCY_LABEL: Record<TaskFrequency, string> = {
  URGENT: 'Urgente',
  ONE_TIME: 'Una vez',
  DAILY: 'Diaria',
  WEEKLY: 'Semanal',
  SEMI_MONTHLY: 'Quincenal',
  MONTHLY: 'Mensual',
};

export const FREQUENCY_FILTER_LABEL: Record<TaskFrequency, string> = {
  URGENT: 'Urgentes',
  ONE_TIME: 'Una vez',
  DAILY: 'Diarias',
  WEEKLY: 'Semanales',
  SEMI_MONTHLY: 'Quincenales',
  MONTHLY: 'Mensuales',
};

/** Orden de los chips de frecuencia del prototipo: Diarias, Semanales, (Quincenales,) Mensuales, Urgentes, Una vez. */
export const FREQUENCY_FILTER_ORDER: readonly TaskFrequency[] = [
  'DAILY',
  'WEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'URGENT',
  'ONE_TIME',
];

/**
 * Colores de etiqueta del prototipo (`td`/`ts`/`tm`/`tu`); "Una vez" usaba el
 * verde por defecto. Quincenal no existía: usa el tono `info` ya existente
 * para distinguirse de semanal y mensual.
 */
export const FREQUENCY_TONE: Record<TaskFrequency, BadgeTone> = {
  URGENT: 'danger',
  ONE_TIME: 'positive',
  DAILY: 'positive',
  WEEKLY: 'earth',
  SEMI_MONTHLY: 'info',
  MONTHLY: 'warning',
};

/** Ayuda del formulario: quincenal es por mitades del mes calendario, no "cada 14 días". */
export const SEMI_MONTHLY_HINT = 'Una vez del 1 al 15 y otra del 16 al último día del mes';

const SEMI_MONTHLY_KEY = /^(\d{4})-(\d{2})-Q([12])$/;

/**
 * Período de una obligación para mostrar (la clave la decide el backend):
 * `YYYY-MM-DD` → `dd/mm/aaaa`; quincena `YYYY-MM-Q1/Q2` → `01/10/2026 al
 * 15/10/2026` o `16/10/2026 al 31/10/2026` (último día real del mes).
 */
export function formatPeriodKey(periodKey: string): string {
  const quincena = SEMI_MONTHLY_KEY.exec(periodKey);
  if (!quincena) return formatDate(periodKey);
  const [, year, month, half] = quincena;
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return half === '1'
    ? formatDateRange(`${year}-${month}-01`, `${year}-${month}-15`)
    : formatDateRange(`${year}-${month}-16`, `${year}-${month}-${lastDay}`);
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
