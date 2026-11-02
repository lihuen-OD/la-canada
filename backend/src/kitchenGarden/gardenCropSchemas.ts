import { z } from 'zod';
import { parseLocalDate } from '../lib/businessTime';
import { plainText, uuidSchema } from '../tasks/taskSchemas';

/**
 * 🥬 Huerta — cultivos y registros: contrato HTTP (`.strict()` en todo: el
 * cliente nunca envía el usuario que registra, quién anuló, versiones
 * calculadas ni estados). Qué combina con qué (modalidad, unidad, fechas
 * contra la siembra y «hoy» de `BUSINESS_TIME_ZONE`) lo decide el servicio,
 * que conoce la tanda.
 */

export const CROP_NAME_MAX = 60;
export const BATCH_NAME_MAX = 80;
export const VARIETY_MAX = 80;
export const LOCATION_MAX = 120;
export const CROP_NOTES_MAX = 500;
export const VOID_REASON_MAX = 300;
/** `DECIMAL(10,2)`: hasta 99 999 999,99. */
/** `12.50` tiene fracción; `12.00`, no (es la cantidad 12). */
const hasFraction = (value: string) => /\.\d*[1-9]/.test(value);
const QUANTITY_PATTERN = /^(?:0\.\d{1,2}|[1-9]\d{0,7}(?:\.\d{1,2})?)$/;

export const SOWING_METHODS = ['DIRECT', 'SEEDBED'] as const;
export const SOWING_UNITS = ['SEEDS', 'GRAMS'] as const;
export const CROP_RECORD_TYPES = ['SOWING', 'TRANSPLANT'] as const;

/** Fecha de calendario `YYYY-MM-DD` existente (que no sea futura lo valida el servicio). */
function calendarDate(label: string) {
  return z
    .string({ message: `${label} debe tener formato YYYY-MM-DD.` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} debe tener formato YYYY-MM-DD.`)
    .refine((value) => parseLocalDate(value) !== null, `${label} no existe.`)
    .refine((value) => Number(value.slice(0, 4)) >= 2000, `${label} no es válida.`);
}

const quantitySchema = z
  .string({ message: 'La cantidad debe ser un número.' })
  .regex(QUANTITY_PATTERN, 'La cantidad debe ser un número positivo de hasta 2 decimales.')
  .refine((value) => !/^0(\.0+)?$/.test(value), 'La cantidad debe ser mayor a cero.');

const optionalText = (label: string, max: number) => plainText(label, 1, max).nullable().optional();

const performedOn = calendarDate('La fecha');
const performer = uuidSchema;
const location = (label: string) => plainText(label, 1, LOCATION_MAX);

/**
 * «Registrar siembra»: la tanda y su siembra en una sola operación. La
 * cantidad, si se indica, va con su unidad (semillas o gramos); la fecha
 * prevista de trasplante, solo para almácigo.
 */
export const createSowingBodySchema = z
  .object({
    cropName: plainText('El cultivo', 1, CROP_NAME_MAX),
    batchName: plainText('El nombre de la tanda', 1, BATCH_NAME_MAX),
    variety: optionalText('La variedad', VARIETY_MAX),
    batchNotes: optionalText('Las observaciones de la tanda', CROP_NOTES_MAX),
    performedOn,
    performedByParticipantId: performer,
    method: z.enum(SOWING_METHODS, { message: 'Elegí la modalidad: directa o almácigo.' }),
    location: location('El lugar'),
    quantity: quantitySchema.optional(),
    quantityUnit: z
      .enum(SOWING_UNITS, { message: 'Elegí la unidad: semillas o gramos.' })
      .optional(),
    notes: optionalText('Las observaciones', CROP_NOTES_MAX),
    expectedTransplantDate: calendarDate('La fecha prevista de trasplante').optional(),
  })
  .strict()
  .superRefine((body, context) => {
    if ((body.quantity === undefined) !== (body.quantityUnit === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Indicá la cantidad junto con su unidad (semillas o gramos).',
        path: ['quantityUnit'],
      });
    }
    if (body.quantityUnit === 'SEEDS' && body.quantity && hasFraction(body.quantity)) {
      context.addIssue({
        code: 'custom',
        message: 'Las semillas se cuentan enteras.',
        path: ['quantity'],
      });
    }
    if (body.method === 'DIRECT' && body.expectedTransplantDate !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'La siembra directa no lleva fecha prevista de trasplante.',
        path: ['expectedTransplantDate'],
      });
    }
  });

/**
 * «Registrar trasplante» desde la ficha. `remainingPending` es la decisión
 * EXPLÍCITA sobre lo que queda: `false` con pendientes = «No quedan
 * trasplantes pendientes». Con pendientes, `expectedTransplantDate` omitida
 * conserva la fecha prevista, `null` la quita y una fecha la cambia.
 * `batchVersion`: la tanda que vio la pantalla (solo cuenta si cambia lo previsto).
 */
export const createTransplantBodySchema = z
  .object({
    batchVersion: z.number().int().min(1),
    performedOn,
    performedByParticipantId: performer,
    location: location('El lugar de destino'),
    quantity: quantitySchema
      .refine((value) => !hasFraction(value), 'Los plantines se cuentan enteros.')
      .optional(),
    notes: optionalText('Las observaciones', CROP_NOTES_MAX),
    remainingPending: z.boolean({
      message: 'Indicá si quedan trasplantes pendientes.',
    }),
    expectedTransplantDate: calendarDate('La fecha prevista de trasplante').nullable().optional(),
  })
  .strict()
  .superRefine((body, context) => {
    if (!body.remainingPending && body.expectedTransplantDate) {
      context.addIssue({
        code: 'custom',
        message: 'Sin trasplantes pendientes no hay fecha prevista.',
        path: ['expectedTransplantDate'],
      });
    }
  });

/**
 * Corregir una tanda (y lo previsto para sus trasplantes): omitido = sin
 * cambios; `null` = quitar. `version` = la que vio la pantalla.
 */
export const updateBatchBodySchema = z
  .object({
    version: z.number().int().min(1),
    cropName: plainText('El cultivo', 1, CROP_NAME_MAX).optional(),
    name: plainText('El nombre de la tanda', 1, BATCH_NAME_MAX).optional(),
    variety: optionalText('La variedad', VARIETY_MAX),
    notes: optionalText('Las observaciones de la tanda', CROP_NOTES_MAX),
    transplantPending: z.boolean().optional(),
    expectedTransplantDate: calendarDate('La fecha prevista de trasplante').nullable().optional(),
  })
  .strict();

/**
 * Corregir una siembra o un trasplante: omitido = sin cambios; `null` =
 * quitar (cantidad, observaciones). La unidad de un trasplante siempre es
 * plantines; la modalidad, solo de la siembra (lo valida el servicio).
 */
export const updateCropRecordBodySchema = z
  .object({
    version: z.number().int().min(1),
    performedOn: performedOn.optional(),
    performedByParticipantId: performer.optional(),
    location: location('El lugar').optional(),
    method: z.enum(SOWING_METHODS, { message: 'Modalidad inválida.' }).optional(),
    quantity: quantitySchema.nullable().optional(),
    quantityUnit: z.enum(SOWING_UNITS, { message: 'Unidad inválida.' }).nullable().optional(),
    notes: optionalText('Las observaciones', CROP_NOTES_MAX),
  })
  .strict();

/** Anular con motivo (confirmación en la pantalla). */
export const voidCropRecordBodySchema = z
  .object({ reason: plainText('El motivo', 3, VOID_REASON_MAX) })
  .strict();

const pageSchema = z.coerce.number().int().min(1).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(50).default(20);

export const listBatchesQuerySchema = z
  .object({
    status: z.enum(['active', 'archived', 'all']).default('active'),
    cropId: uuidSchema.optional(),
    page: pageSchema,
    pageSize: pageSizeSchema,
  })
  .strict();

export const listCropRecordsQuerySchema = z
  .object({
    from: calendarDate('La fecha «desde»').optional(),
    to: calendarDate('La fecha «hasta»').optional(),
    cropId: uuidSchema.optional(),
    batchId: uuidSchema.optional(),
    type: z.enum(CROP_RECORD_TYPES, { message: 'Tipo de registro inválido.' }).optional(),
    participantId: uuidSchema.optional(),
    page: pageSchema,
    pageSize: pageSizeSchema,
  })
  .strict()
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'La fecha «desde» no puede ser posterior a «hasta».',
  });
