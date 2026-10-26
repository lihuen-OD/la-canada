import { z } from 'zod';
import {
  REVERT_REASON_MAX_LENGTH,
  descriptionSchema,
  frequencySchema,
  orderAndSuggestionFields,
  plainText,
  scheduledDateSchema,
  uuidSchema,
} from '../tasks/taskSchemas';

/**
 * 🥬 Huerta — validación de entrada con las MISMAS piezas que ✅ Tareas
 * (descripción, frecuencia, fecha de «Una vez», orden y sugerencia). Qué
 * combina con qué frecuencia lo decide el servicio. `.strict()` en todo: un
 * campo de más (p. ej. `completedByParticipantId`, `periodKey`) se rechaza.
 */

export const gardenIdParamSchema = uuidSchema;

export const addParticipantBodySchema = z.object({ userId: uuidSchema }).strict();

export const participantStatusBodySchema = z.object({ active: z.boolean() }).strict();

export const createGardenActivityBodySchema = z
  .object({
    description: descriptionSchema,
    participantId: uuidSchema,
    frequency: frequencySchema,
    scheduledDate: scheduledDateSchema.optional(),
    ...orderAndSuggestionFields,
  })
  .strict();

/** Omitidos = sin cambios; `null` = quitar (fecha, orden y sugerencia). */
export const updateGardenActivityBodySchema = z
  .object({
    description: descriptionSchema.optional(),
    participantId: uuidSchema.optional(),
    frequency: frequencySchema.optional(),
    scheduledDate: scheduledDateSchema.optional(),
    ...orderAndSuggestionFields,
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'No hay cambios para aplicar.',
  });

export const gardenActivityStatusBodySchema = z.object({ active: z.boolean() }).strict();

/** `participantId` = quién REALMENTE la realizó; solo lo decide un ADMIN. */
export const completeGardenActivityBodySchema = z
  .object({ participantId: uuidSchema.optional() })
  .strict();

export const revertGardenActivityBodySchema = z
  .object({
    executionId: uuidSchema,
    reason: plainText('El motivo', 3, REVERT_REASON_MAX_LENGTH).optional(),
  })
  .strict();

export const listGardenActivitiesQuerySchema = z
  .object({
    participantId: uuidSchema.optional(),
    frequency: frequencySchema.optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
  })
  .strict();

export const gardenHistoryQuerySchema = z
  .object({
    week: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'La semana debe tener formato YYYY-MM-DD.')
      .optional(),
    participantId: uuidSchema.optional(),
  })
  .strict();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD.');
export const gardenPerformanceRangeSchema = z.object({ from: date, to: date }).strict();
