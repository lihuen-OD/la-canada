import { z } from 'zod';
import { normalizeStockText } from '../stock/stockSchemas';
import { MEDICAL_RECORD_TYPES, PET_TYPE_ICON_OPTIONS } from './petCatalog';
import { DUE_STATUSES } from './petDue';

/**
 * Contrato HTTP de 🐾 Mascotas (Etapa 5M). Todo `.strict()`: el cliente
 * nunca envía el actor, la persona, el estado de anulación ni datos
 * calculados (edad, KPIs, foto).
 */

export const PET_NAME_MAX = 60;
export const PET_BREED_MAX = 80;
export const PET_TYPE_NAME_MAX = 40;
export const PET_RECORD_DESCRIPTION_MAX = 300;
/** Decimal(6,2): hasta 9999.99 kg. */
const WEIGHT_PATTERN = /^(?:0\.\d{1,2}|[1-9]\d{0,3}(?:\.\d{1,2})?)$/;

const CONTROL_CHARACTERS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
);

function plainText(label: string, min: number, max: number) {
  return z
    .string({ message: `${label} debe ser texto.` })
    .transform(normalizeStockText)
    .pipe(
      z
        .string()
        .min(
          min,
          min === 1
            ? `${label} no puede estar vacío.`
            : `${label} debe tener al menos ${min} caracteres.`,
        )
        .max(max, `${label} no puede superar ${max} caracteres.`)
        .refine((text) => !/[<>]/.test(text), `${label} no puede contener HTML.`)
        .refine(
          (text) => !CONTROL_CHARACTERS.test(text),
          `${label} contiene caracteres inválidos.`,
        ),
    );
}

const uuidSchema = z.string().uuid('Identificador inválido.');
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD.');
const pageSchema = z.coerce.number().int('La página debe ser un número entero.').min(1).default(1);
const pageSizeSchema = (max: number, fallback: number) =>
  z.coerce
    .number()
    .int('El tamaño de página debe ser un número entero.')
    .min(1)
    .max(max)
    .default(fallback);

export const petIdParamSchema = uuidSchema;

export const listPetTypesQuerySchema = z
  .object({ status: z.enum(['active', 'all']).default('active') })
  .strict();

/** "Agregar nuevo tipo": nombre (con mayúscula inicial, como el prototipo) + símbolo del selector. */
export const createPetTypeBodySchema = z
  .object({
    name: plainText('El nombre', 2, PET_TYPE_NAME_MAX).transform(
      (name) => name.charAt(0).toLocaleUpperCase('es-AR') + name.slice(1),
    ),
    icon: z
      .string({ message: 'Elegí un símbolo.' })
      .refine(
        (icon) => PET_TYPE_ICON_OPTIONS.some((option) => option.icon === icon),
        'Elegí un símbolo de la lista.',
      ),
  })
  .strict();

/** Solo tipos agregados: desactivar (`false`) o reactivar (`true`). */
export const petTypeStatusBodySchema = z.object({ active: z.boolean() }).strict();

/** Mascota: desactivar (murió, se entregó, ya no está) o reactivar. */
export const petStatusBodySchema = z.object({ active: z.boolean() }).strict();

export const listPetsQuerySchema = z
  .object({
    typeId: uuidSchema.optional(),
    /** `inactive`/`all` solo ADMIN (el servicio lo impone). */
    status: z.enum(['active', 'inactive', 'all']).default('active'),
    page: pageSchema,
    pageSize: pageSizeSchema(50, 24),
  })
  .strict();

/** Ficha: nombre, tipo, raza y fecha de nacimiento (la foto va por su endpoint). */
const petFields = {
  name: plainText('El nombre', 1, PET_NAME_MAX),
  animalTypeId: uuidSchema,
  breed: plainText('La raza', 1, PET_BREED_MAX).nullable().optional(),
  birthDate: dateSchema.nullable().optional(),
};

export const createPetBodySchema = z.object(petFields).strict();

export const updatePetBodySchema = z
  .object({
    name: petFields.name.optional(),
    animalTypeId: petFields.animalTypeId.optional(),
    breed: petFields.breed,
    birthDate: petFields.birthDate,
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'No hay cambios para aplicar.',
  });

export const listPetRecordsQuerySchema = z
  .object({
    type: z.enum(MEDICAL_RECORD_TYPES, { message: 'Tipo de registro inválido.' }).optional(),
    page: pageSchema,
    pageSize: pageSizeSchema(50, 20),
  })
  .strict();

/**
 * "Nuevo registro": tipo, fecha (hoy o pasada: todos son hechos ya
 * ocurridos), peso en kg solo para ⚖️ Peso y descripción opcional. Opcionales:
 * «Fecha de próxima aplicación o control» (nunca en Peso; el servicio exige
 * que sea posterior a la atención) y `fulfillsRecordId`, el pendiente que esta
 * atención cumple («Registrar aplicación / control»).
 */
export const createPetRecordBodySchema = z
  .object({
    type: z.enum(MEDICAL_RECORD_TYPES, { message: 'Tipo de registro inválido.' }),
    recordDate: dateSchema,
    weightKg: z
      .string({ message: 'El peso debe ser un número.' })
      .regex(WEIGHT_PATTERN, 'El peso debe ser un número positivo de hasta 9999.99 kg.')
      .refine((value) => !/^0(\.0+)?$/.test(value), 'El peso debe ser mayor a cero.')
      .optional(),
    description: plainText('La descripción', 1, PET_RECORD_DESCRIPTION_MAX).optional(),
    nextDueDate: dateSchema.optional(),
    fulfillsRecordId: uuidSchema.optional(),
  })
  .strict()
  .superRefine((body, context) => {
    if (body.type === 'WEIGHT' && body.nextDueDate !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'El peso no lleva fecha de próxima aplicación o control.',
        path: ['nextDueDate'],
      });
    }
    if (body.type === 'WEIGHT' && body.weightKg === undefined) {
      context.addIssue({ code: 'custom', message: 'Ingresá el peso.', path: ['weightKg'] });
    }
    if (body.type !== 'WEIGHT' && body.weightKg !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'El peso solo se registra en el tipo ⚖️ Peso.',
        path: ['weightKg'],
      });
    }
  });

/** Completar o corregir la próxima fecha de un registro (ADMIN): solo ese dato. */
export const updatePetRecordNextDueBodySchema = z.object({ nextDueDate: dateSchema }).strict();

/** 📅 Vencimientos: filtros por mascota, tipo y estado, paginados en el backend. */
export const listPetDueQuerySchema = z
  .object({
    petId: uuidSchema.optional(),
    type: z.enum(MEDICAL_RECORD_TYPES, { message: 'Tipo de registro inválido.' }).optional(),
    status: z.enum(DUE_STATUSES, { message: 'Estado inválido.' }).optional(),
    page: pageSchema,
    pageSize: pageSizeSchema(50, 20),
  })
  .strict();
