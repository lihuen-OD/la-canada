import { z } from 'zod';

export const TASK_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'URGENT', 'ONE_TIME'] as const;

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

export const taskIdParamSchema = uuidSchema;

export const createTaskBodySchema = z
  .object({
    description: descriptionSchema,
    employeeId: uuidSchema,
    frequency: frequencySchema,
  })
  .strict();

export const updateTaskBodySchema = z
  .object({
    description: descriptionSchema.optional(),
    employeeId: uuidSchema.optional(),
    frequency: frequencySchema.optional(),
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
