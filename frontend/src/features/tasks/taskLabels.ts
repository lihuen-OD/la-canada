import type { TaskFrequency } from '../../api/taskTypes';
import type { BadgeTone } from '../../components/ui/Badge';

/** Orden operativo del prototipo (mismo que el backend): urgente → única → diaria → semanal → mensual. */
export const FREQUENCY_ORDER: readonly TaskFrequency[] = [
  'URGENT',
  'ONE_TIME',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
];

export const FREQUENCY_LABEL: Record<TaskFrequency, string> = {
  URGENT: 'Urgente',
  ONE_TIME: 'Una vez',
  DAILY: 'Diaria',
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensual',
};

export const FREQUENCY_FILTER_LABEL: Record<TaskFrequency, string> = {
  URGENT: 'Urgentes',
  ONE_TIME: 'Una vez',
  DAILY: 'Diarias',
  WEEKLY: 'Semanales',
  MONTHLY: 'Mensuales',
};

/** Orden de los chips de frecuencia del prototipo: Diarias, Semanales, Mensuales, Urgentes, Una vez. */
export const FREQUENCY_FILTER_ORDER: readonly TaskFrequency[] = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'URGENT',
  'ONE_TIME',
];

/** Colores de etiqueta del prototipo (`td`/`ts`/`tm`/`tu`); "Una vez" usaba el verde por defecto. */
export const FREQUENCY_TONE: Record<TaskFrequency, BadgeTone> = {
  URGENT: 'danger',
  ONE_TIME: 'positive',
  DAILY: 'positive',
  WEEKLY: 'earth',
  MONTHLY: 'warning',
};

/**
 * Fecha y hora de una finalización para mostrar (nunca para decidir
 * períodos: eso es del backend). Usa la zona de negocio que devuelve la API.
 */
export function formatCompletedAt(iso: string, timeZone: string, today: string): string {
  const date = new Date(iso);
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
  const time = new Intl.DateTimeFormat('es-AR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  if (dayKey === today) return `hoy, ${time}`;
  const day = new Intl.DateTimeFormat('es-AR', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
  return `${day}, ${time}`;
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
