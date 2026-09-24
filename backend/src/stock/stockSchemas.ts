import { z } from 'zod';

export const STOCK_ITEM_AREAS = ['HOUSE', 'GARDEN'] as const;
export const STOCK_CATEGORY_AREAS = ['HOUSE', 'GARDEN', 'BOTH'] as const;
/** Tipos que la operación normal de la app puede crear (nunca OPENING_BALANCE — solo seed). */
export const OPERATIONAL_MOVEMENT_TYPES = [
  'INCOME',
  'CONSUMPTION',
  'ADJUSTMENT_INCREASE',
  'ADJUSTMENT_DECREASE',
] as const;
/** Los cinco tipos del enum, para filtros de historial (incluye los del seed). */
export const ALL_MOVEMENT_TYPES = [
  'OPENING_BALANCE',
  'INCOME',
  'CONSUMPTION',
  'ADJUSTMENT_INCREASE',
  'ADJUSTMENT_DECREASE',
] as const;

export const STOCK_NAME_MAX_LENGTH = 100;
export const STOCK_CATEGORY_NAME_MAX_LENGTH = 80;
export const STOCK_UNIT_MAX_LENGTH = 30;
export const STOCK_REASON_MAX_LENGTH = 300;

/** Colapsa espacios (incluidos saltos de línea y tabs) y recorta extremos. */
export function normalizeStockText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Caracteres de control (U+0000–U+001F y U+007F), armados sin literales para no disparar `no-control-regex`. */
const CONTROL_CHARACTERS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
);

/** Texto plano de una línea. Rechaza `<`/`>` (nunca se acepta HTML) y caracteres de control. */
function plainText(label: string, min: number, max: number) {
  return z
    .string({ message: `${label} es obligatoria.` })
    .transform(normalizeStockText)
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

/**
 * Cantidad decimal **como texto**: nunca un `number` de JavaScript (float).
 * Hasta 2 decimales y 8 dígitos enteros, compatibles con `Decimal(10,2)`;
 * `NaN`/`Infinity`/notación exponencial quedan fuera por el propio patrón.
 * Cero explícito ("0", "0.0", "0.00") se rechaza: el saldo nunca es negativo
 * y un movimiento de valor nulo no existe en el modelo.
 */
const QUANTITY_PATTERN = /^(?:0\.\d{1,2}|[1-9]\d{0,7}(?:\.\d{1,2})?)$/;
export const stockQuantityTextSchema = z
  .string({ message: 'La cantidad es obligatoria.' })
  .regex(QUANTITY_PATTERN, 'La cantidad debe ser un número positivo con hasta 2 decimales.')
  .refine((value) => !/^0+(\.0+)?$/.test(value), 'La cantidad debe ser mayor a cero.');

/**
 * El mínimo es un umbral, no un movimiento: `0` es válido y está contemplado
 * explícitamente por la regla histórica de estado/barra de Stock. Mantiene la
 * misma representación decimal estricta y el mismo límite de Decimal(10,2).
 */
export const stockMinimumQuantityTextSchema = z
  .string({ message: 'El stock mínimo es obligatorio.' })
  .regex(
    /^(?:0(?:\.\d{1,2})?|[1-9]\d{0,7}(?:\.\d{1,2})?)$/,
    'El stock mínimo debe ser un número no negativo con hasta 2 decimales.',
  );

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD.');
const uuidSchema = z.string().uuid('Identificador inválido.');
const pageSchema = z.coerce.number().int('La página debe ser un número entero.').min(1).default(1);
const pageSizeSchema = z.coerce
  .number()
  .int('El tamaño de página debe ser un número entero.')
  .min(1)
  .max(100)
  .default(50);

export const stockIdParamSchema = uuidSchema;

export const listStockCategoriesQuerySchema = z
  .object({
    status: z.enum(['active', 'all']).default('active'),
  })
  .strict();

export const createStockCategoryBodySchema = z
  .object({
    name: plainText('El nombre', 2, STOCK_CATEGORY_NAME_MAX_LENGTH),
    area: z.enum(STOCK_CATEGORY_AREAS, { message: 'Área inválida.' }),
  })
  .strict();

/** `area` no se edita: mover una categoría de área rompería la compatibilidad con sus productos. */
export const updateStockCategoryBodySchema = z
  .object({
    name: plainText('El nombre', 2, STOCK_CATEGORY_NAME_MAX_LENGTH).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'No hay cambios para aplicar.',
  });

export const stockStatusBodySchema = z.object({ active: z.boolean() }).strict();

export const listStockItemsQuerySchema = z
  .object({
    area: z.enum(STOCK_ITEM_AREAS, { message: 'Área inválida.' }).optional(),
    categoryId: uuidSchema.optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
    q: z.string().min(1).max(100).optional(),
    page: pageSchema,
    pageSize: pageSizeSchema,
  })
  .strict();

export const createStockItemBodySchema = z
  .object({
    name: plainText('El nombre', 2, STOCK_NAME_MAX_LENGTH),
    // BOTH es solo para categorías; un producto individual es de un área física.
    area: z.enum(STOCK_ITEM_AREAS, { message: 'Área inválida.' }),
    categoryId: uuidSchema,
    unit: plainText('La unidad', 1, STOCK_UNIT_MAX_LENGTH),
    minimumQuantity: stockMinimumQuantityTextSchema,
  })
  .strict();

/**
 * `.strict()` + sin `currentQuantity`/`area`/`active`: las cantidades solo
 * cambian vía `POST /stock/items/:id/movements` (cada movimiento deja
 * `StockMovement`); el área es inmutable y el estado usa `/status`.
 */
export const updateStockItemBodySchema = z
  .object({
    name: plainText('El nombre', 2, STOCK_NAME_MAX_LENGTH).optional(),
    categoryId: uuidSchema.optional(),
    unit: plainText('La unidad', 1, STOCK_UNIT_MAX_LENGTH).optional(),
    minimumQuantity: stockMinimumQuantityTextSchema.optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'No hay cambios para aplicar.',
  });

export const createStockMovementBodySchema = z
  .object({
    type: z.enum(OPERATIONAL_MOVEMENT_TYPES, {
      message:
        'Tipo de movimiento inválido (solo ingresos, consumos y ajustes; el saldo inicial lo carga el seed).',
    }),
    quantity: stockQuantityTextSchema,
    effectiveDate: dateSchema.optional(),
    destinationId: uuidSchema.optional(),
    reason: plainText('El motivo', 3, STOCK_REASON_MAX_LENGTH).optional(),
  })
  .strict()
  .refine((body) => body.destinationId === undefined || body.type === 'CONSUMPTION', {
    message: 'El destino solo aplica a consumos.',
  });

export const listStockMovementsQuerySchema = z
  .object({
    type: z.enum(ALL_MOVEMENT_TYPES, { message: 'Tipo de movimiento inválido.' }).optional(),
    page: pageSchema,
    pageSize: pageSizeSchema,
  })
  .strict();
