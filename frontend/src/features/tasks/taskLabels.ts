import type { TaskFrequency, TaskScheduleStatus, TaskSuggestionField } from '../../api/taskTypes';
import type { BadgeTone } from '../../components/ui/Badge';
import {
  NO_TASKS_LABEL,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDateWithWeekday,
} from '../../utils/dateFormat';

/**
 * Sustantivo de lo que muestran los componentes compartidos: «tarea» en ✅
 * Tareas (por defecto) y «actividad» en 🥬 Huerta. Solo cambia textos: las
 * dos son femeninas, así que el resto de la frase no cambia.
 */
export interface ItemNoun {
  singular: string;
  plural: string;
  /** Porcentaje sin obligaciones en el período (nunca un 0 % engañoso). */
  noObligations: string;
}

export const TASK_NOUN: ItemNoun = {
  singular: 'tarea',
  plural: 'tareas',
  noObligations: NO_TASKS_LABEL,
};

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

/** Ayuda del «Orden de realización». */
export const EXECUTION_ORDER_HINT = 'Los números menores aparecen primero. Es opcional';
export const EXECUTION_ORDER_MAX = 9999;

/** Ayudas de la programación sugerida (la fecha la calcula el backend). */
export const SUGGESTION_HINT =
  'Es una sugerencia: no cambia el período ni impide completarla antes o después.';
export const SUGGESTION_LAST_DAY_HINT =
  'Si el día no existe en ese mes, se usa el último: 31 de abril → 30 de abril; 29 de febrero → 28 en años no bisiestos.';
export const SUGGESTION_PAIR_ERROR =
  'Para una sugerencia bimestral o anual elegí el mes y el día, o dejá ambos vacíos.';
export const SUGGESTION_DROPPED_NOTICE =
  'La programación sugerida que no corresponde a la nueva frecuencia se quita al guardar.';

export interface SuggestionInput {
  field: TaskSuggestionField;
  label: string;
  options: { value: number; label: string }[];
}

const WEEKDAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
const days = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => ({
    value: from + index,
    label: String(from + index),
  }));
const named = (names: string[]) => names.map((label, index) => ({ value: index + 1, label }));

/**
 * Campos de programación sugerida que muestra el formulario para cada
 * frecuencia (Diaria, Urgente y «Una vez» no tienen). Solo presentación: el
 * backend valida la combinación y calcula la fecha sugerida.
 */
export const SUGGESTION_INPUTS: Record<TaskFrequency, readonly SuggestionInput[]> = {
  DAILY: [],
  URGENT: [],
  ONE_TIME: [],
  WEEKLY: [{ field: 'suggestedWeekday', label: 'Día sugerido', options: named(WEEKDAY_NAMES) }],
  SEMI_MONTHLY: [
    {
      field: 'suggestedFirstHalfDay',
      label: 'Día sugerido, primera quincena',
      options: days(1, 15),
    },
    {
      field: 'suggestedSecondHalfDay',
      label: 'Día sugerido, segunda quincena',
      options: days(16, 31),
    },
  ],
  MONTHLY: [{ field: 'suggestedMonthDay', label: 'Día sugerido del mes', options: days(1, 31) }],
  BIMONTHLY: [
    {
      field: 'suggestedMonth',
      label: 'Mes del bimestre',
      options: named(['Primer mes', 'Segundo mes']),
    },
    { field: 'suggestedMonthDay', label: 'Día sugerido', options: days(1, 31) },
  ],
  ANNUAL: [
    { field: 'suggestedMonth', label: 'Mes sugerido', options: named(MONTH_NAMES) },
    { field: 'suggestedMonthDay', label: 'Día sugerido', options: days(1, 31) },
  ],
};

/** Bimestral y anual: mes y día juntos, o ninguno. */
export const PAIRED_SUGGESTION: ReadonlySet<TaskFrequency> = new Set(['BIMONTHLY', 'ANNUAL']);

/** «Sugerida: miércoles 28/10/2026» — informativa, nunca un vencimiento. */
export function formatSuggestedDate(date: string): string {
  const text = formatDateWithWeekday(date);
  return text ? `Sugerida: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : '';
}

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
