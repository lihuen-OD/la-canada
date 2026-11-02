import { z } from 'zod';
import {
  REVERT_REASON_MAX_LENGTH,
  descriptionSchema,
  frequencySchema,
  normalizeText,
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

export const GARDEN_ACTIVITY_KINDS = ['SOWING', 'TRANSPLANT', 'OTHER'] as const;
export const GARDEN_NOTES_MAX_LENGTH = 500;

/** Tipo de un registro: siembra, trasplante u otra actividad (nunca se deduce de la descripción). */
const kindSchema = z.enum(GARDEN_ACTIVITY_KINDS, {
  message: 'Elegí el tipo: siembra, trasplante u otra actividad.',
});

/** Observaciones de una línea; vacías (o solo espacios) = sin observaciones (`null`). */
const notesSchema = z.preprocess(
  (value) => (typeof value === 'string' && normalizeText(value) === '' ? null : value),
  plainText('El campo «Observaciones»', 1, GARDEN_NOTES_MAX_LENGTH).nullable(),
);

/**
 * «Programar también el trasplante» al crear una siembra «Una vez»: otra
 * actividad independiente (tipo trasplante, «Una vez»), creada en la misma
 * transacción. Qué combina con qué lo valida el servicio.
 */
const transplantSchema = z
  .object({
    description: descriptionSchema,
    participantId: uuidSchema,
    scheduledDate: scheduledDateSchema.optional(),
  })
  .strict();

export const createGardenActivityBodySchema = z
  .object({
    kind: kindSchema,
    description: descriptionSchema,
    participantId: uuidSchema,
    frequency: frequencySchema,
    scheduledDate: scheduledDateSchema.optional(),
    notes: notesSchema.optional(),
    ...orderAndSuggestionFields,
    transplant: transplantSchema.optional(),
  })
  .strict();

/**
 * Omitidos = sin cambios; `null` = quitar (fecha, observaciones, orden y
 * sugerencia). `version` es la que vio la pantalla: si otra persona cambió
 * la actividad en el medio, 409 sin pisar nada. El tipo no se puede quitar.
 */
export const updateGardenActivityBodySchema = z
  .object({
    version: z
      .number({ message: 'Falta la versión del registro: recargá la página.' })
      .int('Versión inválida.')
      .min(1, 'Versión inválida.'),
    kind: kindSchema.optional(),
    description: descriptionSchema.optional(),
    participantId: uuidSchema.optional(),
    frequency: frequencySchema.optional(),
    scheduledDate: scheduledDateSchema.optional(),
    notes: notesSchema.optional(),
    ...orderAndSuggestionFields,
  })
  .strict()
  .refine(
    ({ version: _version, ...changes }) =>
      Object.values(changes).some((value) => value !== undefined),
    { message: 'No hay cambios para aplicar.' },
  );

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
