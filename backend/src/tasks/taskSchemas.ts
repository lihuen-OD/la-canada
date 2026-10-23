import { z } from 'zod';
import { parseLocalDate } from '../lib/businessTime';

export const TASK_FREQUENCIES = [
  'DAILY',
  'WEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'BIMONTHLY',
  'ANNUAL',
  'URGENT',
  'ONE_TIME',
] as const;

/** Años aceptados en «Fecha para realizar»: atrasadas o futuras, pero fechas reales. */
export const SCHEDULED_DATE_MIN_YEAR = 2000;
export const SCHEDULED_DATE_MAX_YEAR = 2100;

export const TASK_DESCRIPTION_MAX_LENGTH = 200;
export const REVERT_REASON_MAX_LENGTH = 300;

/** Colapsa espacios (incluidos saltos de línea y tabs) y recorta extremos. */
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Texto plano de una línea. Rechaza `<`/`>` (nunca se acepta HTML — React
 * igual lo renderiza como texto, esto es defensa en profundidad) y
 * caracteres de control.
 */
function plainText(label: string, min: number, max: number) {
  return z
    .string({ message: `${label} es obligatoria.` })
    .transform(normalizeText)
    .pipe(
      z
        .string()
        .min(min, `${label} debe tener al menos ${min} caracteres.`)
        .max(max, `${label} no puede superar ${max} caracteres.`)
        .refine((text) => !/[<>]/.test(text), `${label} no puede contener HTML.`)
        .refine(
          (text) => !CONTROL_CHARACTERS.test(text),
          `${label} contiene caracteres inválidos.`,
        ),
    );
}

/** Caracteres de control (U+0000–U+001F y U+007F), armados sin literales para no disparar `no-control-regex`. */
const CONTROL_CHARACTERS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
);

const descriptionSchema = plainText('La descripción', 3, TASK_DESCRIPTION_MAX_LENGTH);
const frequencySchema = z.enum(TASK_FREQUENCIES, { message: 'Frecuencia inválida.' });
const uuidSchema = z.string().uuid('Identificador inválido.');

/**
 * «Fecha para realizar» (solo «Una vez»): fecha de calendario `YYYY-MM-DD`,
 * sin hora, en `BUSINESS_TIME_ZONE`. Puede ser pasada (una pendiente
 * atrasada). `null` = sin fecha; que la frecuencia la admita lo decide el
 * servicio (`assertScheduledDateFits`), que conoce la frecuencia resultante.
 */
const scheduledDateSchema = z
  .string({ message: 'La fecha para realizar debe tener formato YYYY-MM-DD.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha para realizar debe tener formato YYYY-MM-DD.')
  .refine((value) => parseLocalDate(value) !== null, 'La fecha para realizar no existe.')
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    return year >= SCHEDULED_DATE_MIN_YEAR && year <= SCHEDULED_DATE_MAX_YEAR;
  }, `La fecha para realizar debe estar entre ${SCHEDULED_DATE_MIN_YEAR} y ${SCHEDULED_DATE_MAX_YEAR}.`)
  .nullable();

/** Tope práctico del orden de realización (una tarea N.º 10 000 no ordena nada). */
export const EXECUTION_ORDER_MAX = 9999;

/** «Orden de realización»: entero de 1 a 9999 (repetidos permitidos); `null` = sin orden, nunca 0. */
const executionOrderSchema = z
  .number({ message: 'El orden de realización debe ser un número entero de 1 a 9999.' })
  .int('El orden de realización debe ser un número entero de 1 a 9999.')
  .min(1, 'El orden de realización debe ser un número entero de 1 a 9999.')
  .max(EXECUTION_ORDER_MAX, 'El orden de realización debe ser un número entero de 1 a 9999.')
  .nullable();

/**
 * Un dato de la programación sugerida: entero (rango grueso 1–31). Qué campo
 * admite cada frecuencia, y con qué rango, lo decide el servicio
 * (`taskSuggestion.resolveSuggestion`), que conoce la frecuencia resultante.
 */
const suggestionValueSchema = z
  .number({ message: 'La programación sugerida debe ser un número entero.' })
  .int('La programación sugerida debe ser un número entero.')
  .min(1, 'La programación sugerida está fuera de rango.')
  .max(31, 'La programación sugerida está fuera de rango.')
  .nullable()
  .optional();

const orderAndSuggestionFields = {
  executionOrder: executionOrderSchema.optional(),
  suggestedWeekday: suggestionValueSchema,
  suggestedFirstHalfDay: suggestionValueSchema,
  suggestedSecondHalfDay: suggestionValueSchema,
  suggestedMonthDay: suggestionValueSchema,
  suggestedMonth: suggestionValueSchema,
};

export const taskIdParamSchema = uuidSchema;

export const createTaskBodySchema = z
  .object({
    description: descriptionSchema,
    employeeId: uuidSchema,
    frequency: frequencySchema,
    scheduledDate: scheduledDateSchema.optional(),
    ...orderAndSuggestionFields,
  })
  .strict();

/** `scheduledDate`, orden y sugerencia: omitidos = sin cambios; `null` = quitar. */
export const updateTaskBodySchema = z
  .object({
    description: descriptionSchema.optional(),
    employeeId: uuidSchema.optional(),
    frequency: frequencySchema.optional(),
    scheduledDate: scheduledDateSchema.optional(),
    ...orderAndSuggestionFields,
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'No hay cambios para aplicar.',
  });

export const taskStatusBodySchema = z.object({ active: z.boolean() }).strict();

/**
 * `employeeId` = quién REALMENTE realizó la tarea. Solo lo decide un ADMIN;
 * para un EMPLOYEE el backend usa siempre su propio empleado (ver
 * `tasksService.completeTask`). `.strict()`: cualquier otro campo (p. ej.
 * `completedByEmployeeId`, `periodKey`) se rechaza en vez de ignorarse.
 */
export const completeTaskBodySchema = z.object({ employeeId: uuidSchema.optional() }).strict();

export const revertTaskBodySchema = z
  .object({
    executionId: uuidSchema,
    reason: plainText('El motivo', 3, REVERT_REASON_MAX_LENGTH).optional(),
  })
  .strict();

export const listTasksQuerySchema = z
  .object({
    employeeId: uuidSchema.optional(),
    frequency: frequencySchema.optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
  })
  .strict();

export const taskHistoryQuerySchema = z
  .object({
    week: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'La semana debe tener formato YYYY-MM-DD.')
      .optional(),
    employeeId: uuidSchema.optional(),
  })
  .strict();

/** Mes del calendario de Configuración (`YYYY-MM`, mes real). */
export const taskCalendarQuerySchema = z
  .object({
    month: z
      .string({ message: 'El mes debe tener formato YYYY-MM.' })
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'El mes debe tener formato YYYY-MM.'),
  })
  .strict();
