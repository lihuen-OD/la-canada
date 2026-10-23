import type { TaskFrequency } from '../generated/prisma/enums';
import { ValidationError } from '../errors/AppError';
import {
  SECOND_HALF_FIRST_DAY,
  addDays,
  bimesterOf,
  compareLocalDates,
  daysInMonth,
  startOfWeek,
  type LocalDate,
} from '../lib/businessTime';

/**
 * Programación SUGERIDA de las tareas recurrentes — la ÚNICA definición de
 * qué campos admite cada frecuencia y de cómo se calcula la fecha sugerida
 * de un período. Es una sugerencia: no cambia cuándo empieza o termina el
 * período, no bloquea completar antes o después, no crea ejecuciones y no
 * toca estados, vencimientos ni métricas.
 *
 * - Semanal: día de la semana (1 = lunes … 7 = domingo).
 * - Quincenal: día de la 1.ª quincena (1–15) y de la 2.ª (16–31), cada uno
 *   opcional por separado.
 * - Mensual: día del mes (1–31).
 * - Bimestral: mes del bimestre (1 = primero, 2 = segundo) + día (1–31).
 * - Anual: mes (1–12) + día (1–31).
 * Bimestral y anual necesitan los dos datos o ninguno. Diaria, urgente y
 * «Una vez» no tienen sugerencia («Una vez» usa su fecha para realizar).
 * Un día que no existe en el mes se toma como el último (31 de abril → 30 de
 * abril; 29 de febrero en un año no bisiesto → 28).
 */

export const SUGGESTION_FIELDS = [
  'suggestedWeekday',
  'suggestedFirstHalfDay',
  'suggestedSecondHalfDay',
  'suggestedMonthDay',
  'suggestedMonth',
] as const;

export type SuggestionField = (typeof SUGGESTION_FIELDS)[number];
export type SuggestionValues = Record<SuggestionField, number | null>;

export const EMPTY_SUGGESTION: SuggestionValues = {
  suggestedWeekday: null,
  suggestedFirstHalfDay: null,
  suggestedSecondHalfDay: null,
  suggestedMonthDay: null,
  suggestedMonth: null,
};

/** Rango admitido de cada campo según la frecuencia; ausente = no corresponde. */
const RANGES: Record<TaskFrequency, Partial<Record<SuggestionField, [number, number]>>> = {
  DAILY: {},
  URGENT: {},
  ONE_TIME: {},
  WEEKLY: { suggestedWeekday: [1, 7] },
  SEMI_MONTHLY: {
    suggestedFirstHalfDay: [1, SECOND_HALF_FIRST_DAY - 1],
    suggestedSecondHalfDay: [SECOND_HALF_FIRST_DAY, 31],
  },
  MONTHLY: { suggestedMonthDay: [1, 31] },
  BIMONTHLY: { suggestedMonth: [1, 2], suggestedMonthDay: [1, 31] },
  ANNUAL: { suggestedMonth: [1, 12], suggestedMonthDay: [1, 31] },
};

const PAIRED: readonly TaskFrequency[] = ['BIMONTHLY', 'ANNUAL'];

const MESSAGES: Record<SuggestionField, string> = {
  suggestedWeekday:
    'El día de la semana sugerido solo aplica a tareas semanales (1 = lunes … 7 = domingo).',
  suggestedFirstHalfDay:
    'El día sugerido de la 1.ª quincena va del 1 al 15 y solo aplica a tareas quincenales.',
  suggestedSecondHalfDay:
    'El día sugerido de la 2.ª quincena va del 16 al 31 y solo aplica a tareas quincenales.',
  suggestedMonthDay:
    'El día sugerido va del 1 al 31 y solo aplica a tareas mensuales, bimestrales o anuales.',
  suggestedMonth:
    'El mes sugerido es 1 o 2 (mes del bimestre) en las bimestrales y del 1 al 12 en las anuales; no aplica a otras frecuencias.',
};

export const SUGGESTION_PAIR_MESSAGE =
  'Para una sugerencia bimestral o anual indicá el mes y el día, o dejala vacía.';

function fits(frequency: TaskFrequency, field: SuggestionField, value: number): boolean {
  const range = RANGES[frequency][field];
  return range !== undefined && Number.isInteger(value) && value >= range[0] && value <= range[1];
}

export function hasSuggestion(values: SuggestionValues): boolean {
  return SUGGESTION_FIELDS.some((field) => values[field] !== null);
}

/**
 * Programación resultante de crear o editar: parte de la vigente (`current`)
 * y aplica lo enviado — omitido = se conserva, `null` = se quita. Un valor
 * ENVIADO que no corresponde a la frecuencia (o a su rango) se rechaza; uno
 * CONSERVADO que dejó de valer por un cambio de frecuencia se limpia (solo
 * ese). Bimestral/anual incompletas: si se envió alguno de los dos datos se
 * rechaza; si quedó incompleta por la limpieza, se quita entera.
 */
export function resolveSuggestion(
  frequency: TaskFrequency,
  current: SuggestionValues,
  input: Partial<Record<SuggestionField, number | null>>,
): SuggestionValues {
  const next = { ...current };
  for (const field of SUGGESTION_FIELDS) {
    const value = input[field];
    if (value === undefined) {
      const kept = next[field];
      if (kept !== null && !fits(frequency, field, kept)) next[field] = null;
    } else if (value === null) {
      next[field] = null;
    } else {
      if (!fits(frequency, field, value)) throw new ValidationError(MESSAGES[field]);
      next[field] = value;
    }
  }
  if (
    PAIRED.includes(frequency) &&
    (next.suggestedMonth === null) !== (next.suggestedMonthDay === null)
  ) {
    if (input.suggestedMonth !== undefined || input.suggestedMonthDay !== undefined) {
      throw new ValidationError(SUGGESTION_PAIR_MESSAGE);
    }
    next.suggestedMonth = null;
    next.suggestedMonthDay = null;
  }
  return next;
}

const clampedDay = (year: number, month: number, day: number): LocalDate => ({
  year,
  month,
  day: Math.min(day, daysInMonth(year, month)),
});

/** Primer día del período de `frequency` que contiene `day` (solo recurrentes con sugerencia). */
function periodStart(frequency: TaskFrequency, day: LocalDate): LocalDate | null {
  switch (frequency) {
    case 'WEEKLY':
      return startOfWeek(day);
    case 'SEMI_MONTHLY':
      return { ...day, day: day.day < SECOND_HALF_FIRST_DAY ? 1 : SECOND_HALF_FIRST_DAY };
    case 'MONTHLY':
      return { ...day, day: 1 };
    case 'BIMONTHLY':
      return { year: day.year, month: bimesterOf(day) * 2 - 1, day: 1 };
    case 'ANNUAL':
      return { year: day.year, month: 1, day: 1 };
    default:
      return null;
  }
}

/**
 * Fecha sugerida dentro del período de `frequency` que contiene `day`, o
 * `null` si ese período no tiene sugerencia (p. ej. quincenal con solo la
 * 2.ª quincena cargada, vista en la 1.ª).
 */
export function suggestedDateIn(
  frequency: TaskFrequency,
  values: SuggestionValues,
  day: LocalDate,
): LocalDate | null {
  switch (frequency) {
    case 'WEEKLY':
      return values.suggestedWeekday === null
        ? null
        : addDays(startOfWeek(day), values.suggestedWeekday - 1);
    case 'SEMI_MONTHLY': {
      const half =
        day.day < SECOND_HALF_FIRST_DAY
          ? values.suggestedFirstHalfDay
          : values.suggestedSecondHalfDay;
      return half === null ? null : clampedDay(day.year, day.month, half);
    }
    case 'MONTHLY':
      return values.suggestedMonthDay === null
        ? null
        : clampedDay(day.year, day.month, values.suggestedMonthDay);
    case 'BIMONTHLY':
      return values.suggestedMonth === null || values.suggestedMonthDay === null
        ? null
        : clampedDay(
            day.year,
            bimesterOf(day) * 2 - 2 + values.suggestedMonth,
            values.suggestedMonthDay,
          );
    case 'ANNUAL':
      return values.suggestedMonth === null || values.suggestedMonthDay === null
        ? null
        : clampedDay(day.year, values.suggestedMonth, values.suggestedMonthDay);
    default:
      return null;
  }
}

/**
 * Ubicación de una tarea con sugerencia en el calendario de un mes: las
 * fechas sugeridas de los períodos del mes desde el período vigente (`from`)
 * en adelante — una por período, nunca duplicada. Los períodos anteriores no
 * se atribuyen a la configuración actual: el calendario los sigue marcando
 * como siempre.
 */
export function suggestedDatesInMonth(
  frequency: TaskFrequency,
  values: SuggestionValues,
  year: number,
  month: number,
  today: LocalDate,
): { from: LocalDate; dates: LocalDate[] } | null {
  const from = periodStart(frequency, today);
  if (!from || !hasSuggestion(values)) return null;
  const dates: LocalDate[] = [];
  for (let dayOfMonth = 1; dayOfMonth <= daysInMonth(year, month); dayOfMonth += 1) {
    const day = { year, month, day: dayOfMonth };
    if (compareLocalDates(periodStart(frequency, day)!, from) < 0) continue;
    const suggested = suggestedDateIn(frequency, values, day);
    if (suggested && compareLocalDates(suggested, day) === 0) dates.push(day);
  }
  return { from, dates };
}
