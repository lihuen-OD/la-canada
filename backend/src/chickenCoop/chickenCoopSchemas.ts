import { z } from 'zod';
import { normalizeStockText } from '../stock/stockSchemas';

/**
 * Contrato HTTP de 🐔 Gallinero (Etapa 5G) — ver docs/BUSINESS_RULES.md §9.
 * Todos los schemas son `.strict()`: el cliente nunca envía el actor, el
 * gallinero, la postura ni ningún dato calculado; solo lo que el prototipo
 * pedía en pantalla.
 */

/** Chips de "Análisis por período" del prototipo: 7 días, 30 días, 3 meses, 1 año. */
export const CHICKEN_COOP_PERIOD_DAYS = [7, 30, 90, 365] as const;
export type ChickenCoopPeriodDays = (typeof CHICKEN_COOP_PERIOD_DAYS)[number];

/** Techo operativo defensivo (el prototipo no tenía ninguno): evita errores de tipeo absurdos. */
export const MAX_EGGS_PER_COLLECTION = 10_000;
export const MAX_ACTIVE_HENS = 100_000;
export const EGG_NOTES_MAX_LENGTH = 300;

/** Caracteres de control (U+0000–U+001F y U+007F), sin literales para `no-control-regex`. */
const CONTROL_CHARACTERS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
);

const uuidSchema = z.string().uuid('Identificador inválido.');
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD.');

/** Enteros como el `parseInt` del prototipo, pero estrictos: nunca decimales, texto ni negativos. */
function countSchema(label: string, max: number) {
  return z
    .number({ message: `${label} debe ser un número entero.` })
    .int(`${label} debe ser un número entero.`)
    .min(0, `${label} no puede ser negativa.`)
    .max(max, `${label} no puede superar ${max.toLocaleString('es-AR')}.`);
}

export const chickenCoopIdParamSchema = uuidSchema;

export const chickenCoopSummaryQuerySchema = z
  .object({
    days: z
      .enum(['7', '30', '90', '365'], { message: 'Período inválido (7, 30, 90 o 365 días).' })
      .default('7')
      .transform((value) => Number(value) as ChickenCoopPeriodDays),
  })
  .strict();

/** Historial paginado por DÍAS (cada página trae días completos, nunca un día partido). */
export const eggCollectionHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int('La página debe ser un número entero.').min(1).default(1),
    pageSize: z.coerce
      .number()
      .int('El tamaño de página debe ser un número entero.')
      .min(1)
      .max(31)
      .default(10),
  })
  .strict();

export const createEggCollectionBodySchema = z
  .object({
    goodEggsCount: countSchema('La cantidad de huevos buenos', MAX_EGGS_PER_COLLECTION),
    brokenEggsCount: countSchema('La cantidad de huevos rotos', MAX_EGGS_PER_COLLECTION),
    /** Hoy o una fecha pasada de `BUSINESS_TIME_ZONE`; ausente = hoy. Nunca futura. */
    collectionDate: dateSchema.optional(),
    /**
     * "¿Quién juntó?": solo un ADMIN elige un empleado activo. Ausente = la
     * persona de la sesión. Un EMPLOYEE queda fijado a sí mismo (lo decide
     * el servicio); el actor real siempre sale de la sesión.
     */
    employeeId: uuidSchema.optional(),
    notes: z
      .string({ message: 'Las observaciones deben ser texto.' })
      .transform(normalizeStockText)
      .pipe(
        z
          .string()
          .min(1, 'Las observaciones no pueden estar vacías.')
          .max(
            EGG_NOTES_MAX_LENGTH,
            `Las observaciones no pueden superar ${EGG_NOTES_MAX_LENGTH} caracteres.`,
          )
          .refine((text) => !/[<>]/.test(text), 'Las observaciones no pueden contener HTML.')
          .refine(
            (text) => !CONTROL_CHARACTERS.test(text),
            'Las observaciones contienen caracteres inválidos.',
          ),
      )
      .optional(),
  })
  .strict()
  .refine((body) => body.goodEggsCount + body.brokenEggsCount > 0, {
    message: 'Ingresá al menos un huevo.',
  });

/** Configuración inicial real (una sola vez): la cantidad de gallinas la informa el ADMIN. */
export const configureChickenCoopBodySchema = z
  .object({ activeHensCount: countSchema('La cantidad de gallinas', MAX_ACTIVE_HENS) })
  .strict();

/**
 * "+ Alta" / "− Baja" del prototipo: de a una gallina, con la cantidad que
 * el ADMIN confirmó ("¿Cambiar gallinas activas de X a Y?"). Si la cantidad
 * real ya no es `expectedCount`, el backend no aplica nada (409).
 */
export const adjustChickenCoopHensBodySchema = z
  .object({
    delta: z.union([z.literal(1), z.literal(-1)], { message: 'El ajuste es de a una gallina.' }),
    expectedCount: countSchema('La cantidad actual', MAX_ACTIVE_HENS),
  })
  .strict();
