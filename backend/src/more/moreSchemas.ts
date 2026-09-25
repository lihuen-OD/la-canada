import { z } from 'zod';
import { normalizeStockText } from '../stock/stockSchemas';

/**
 * Contrato HTTP de ☰ Más (Etapa 5X): 📝 Novedades, 📅 Eventos, 📸 Fotos,
 * ⚙️ Configuración (personas y datos del equipo) y 👤 Mi perfil. Todo
 * `.strict()`: el cliente nunca envía el actor, el autor de sesión, estados
 * de anulación ni datos calculados (cumpleaños, conteos).
 */

export const NEWS_TEXT_MAX = 500;
export const EVENT_TITLE_MAX = 120;
export const EVENT_NOTE_MAX = 300;
export const PHOTO_TITLE_MAX = 80;
export const EMPLOYEE_NAME_MAX = 40;
/** Roles funcionales del `<select id="p-rol">` del prototipo. */
export const EMPLOYEE_ROLES = ['Doméstica', 'Parque', 'Otro'] as const;
/** Opciones del `<select id="mp-estado-civil">` del prototipo. */
export const MARITAL_STATUSES = [
  'Soltero/a',
  'Casado/a',
  'Divorciado/a',
  'Viudo/a',
  'Unión de hecho',
] as const;
export const EVENT_TYPES = ['VISIT', 'BIRTHDAY', 'MAINTENANCE', 'OTHER'] as const;
export const GALLERY_CATEGORIES = ['TASK_EVIDENCE', 'MEMORY'] as const;

const CONTROL_CHARACTERS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
);

/** Texto plano normalizado (espacios colapsados), sin HTML ni caracteres de control. */
function plainText(label: string, max: number) {
  return z
    .string({ message: `${label} debe ser texto.` })
    .transform(normalizeStockText)
    .pipe(
      z
        .string()
        .min(1, `${label} no puede estar vacío.`)
        .max(max, `${label} no puede superar ${max} caracteres.`)
        .refine((text) => !/[<>]/.test(text), `${label} no puede contener HTML.`)
        .refine(
          (text) => !CONTROL_CHARACTERS.test(text),
          `${label} contiene caracteres inválidos.`,
        ),
    );
}

/** Opcional en un formulario completo: `null` o texto vacío lo borra. */
function optionalText(label: string, max: number) {
  return z
    .union([z.null(), z.literal(''), plainText(label, max)])
    .transform((value) => (value ? value : null));
}

const uuidSchema = z.string().uuid('Identificador inválido.');
export const idParamSchema = uuidSchema;

export const dateSchema = z
  .string({ message: 'La fecha debe tener formato YYYY-MM-DD.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD.');
const pageSchema = z.coerce.number().int('La página debe ser un número entero.').min(1).default(1);
const pageSizeSchema = (max: number, fallback: number) =>
  z.coerce
    .number()
    .int('El tamaño de página debe ser un número entero.')
    .min(1)
    .max(max)
    .default(fallback);

// ── 📝 Novedades ─────────────────────────────────────────────────────────

export const listNewsQuerySchema = z
  .object({ page: pageSchema, pageSize: pageSizeSchema(50, 20) })
  .strict();

/** "¿Quién reporta?" + texto. `employeeId` solo lo elige un ADMIN (el backend decide). */
export const createNewsBodySchema = z
  .object({
    text: plainText('La novedad', NEWS_TEXT_MAX),
    employeeId: uuidSchema.optional(),
  })
  .strict();

// ── 📅 Eventos ───────────────────────────────────────────────────────────

export const listEventsQuerySchema = z
  .object({
    type: z.enum(EVENT_TYPES, { message: 'Tipo de evento inválido.' }).optional(),
    pastPage: pageSchema,
    pastPageSize: pageSizeSchema(50, 20),
  })
  .strict();

const eventFields = {
  title: plainText('El título', EVENT_TITLE_MAX),
  date: dateSchema,
  type: z.enum(EVENT_TYPES, { message: 'Tipo de evento inválido.' }),
  note: optionalText('La nota', EVENT_NOTE_MAX).optional(),
};

export const createEventBodySchema = z.object(eventFields).strict();

export const updateEventBodySchema = z
  .object({
    title: eventFields.title.optional(),
    date: eventFields.date.optional(),
    type: eventFields.type.optional(),
    note: eventFields.note,
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'No hay cambios para aplicar.',
  });

// ── 📸 Fotos ─────────────────────────────────────────────────────────────

export const listPhotosQuerySchema = z
  .object({
    category: z.enum(GALLERY_CATEGORIES, { message: 'Tipo de foto inválido.' }).optional(),
    page: pageSchema,
    pageSize: pageSizeSchema(48, 24),
  })
  .strict();

/**
 * Metadatos de "Guardar foto" (viajan en la query: el cuerpo es la imagen).
 * Título vacío = "Sin título" (prototipo); persona opcional.
 */
export const uploadPhotoQuerySchema = z
  .object({
    title: z
      .union([z.literal(''), plainText('El título', PHOTO_TITLE_MAX)])
      .optional()
      .transform((value) => value || 'Sin título'),
    category: z.enum(GALLERY_CATEGORIES, { message: 'Elegí el tipo de foto.' }),
    employeeId: uuidSchema.optional(),
  })
  .strict();

// ── ⚙️ Configuración: personas y datos del equipo (ADMIN) ────────────────

const colorSchema = z
  .string({ message: 'Elegí un color.' })
  .regex(/^#[0-9a-fA-F]{6}$/, 'El color debe ser hexadecimal (#rrggbb).')
  .transform((value) => value.toLowerCase());

export const createEmployeeBodySchema = z
  .object({
    displayName: plainText('El nombre', EMPLOYEE_NAME_MAX),
    role: z.enum(EMPLOYEE_ROLES, { message: 'Elegí un rol de la lista.' }),
    colorHex: colorSchema,
  })
  .strict();

export const updateEmployeeBodySchema = z
  .object({
    displayName: createEmployeeBodySchema.shape.displayName.optional(),
    role: createEmployeeBodySchema.shape.role.optional(),
    colorHex: colorSchema.optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'No hay cambios para aplicar.',
  });

export const employeeStatusBodySchema = z.object({ active: z.boolean() }).strict();

export const teamProfilesQuerySchema = z
  .object({ filter: z.enum(['all', 'complete', 'incomplete']).default('all') })
  .strict();

// ── 👤 Mi perfil ─────────────────────────────────────────────────────────

const phoneSchema = (label: string) =>
  z
    .union([z.null(), z.literal(''), plainText(label, 30)])
    .transform((value) => (value ? value : null))
    .refine(
      (value) => value === null || /^[0-9+()\s-]{6,30}$/.test(value),
      `${label}: usá solo números, espacios, +, - o paréntesis.`,
    );

/** "Guardar mis datos": el formulario completo (cada campo vacío se guarda como vacío). */
export const updateProfileBodySchema = z
  .object({
    fullLegalName: optionalText('El nombre completo', 120),
    birthDate: z.union([z.null(), z.literal(''), dateSchema]).transform((value) => value || null),
    maritalStatus: z
      .union([
        z.null(),
        z.literal(''),
        z.enum(MARITAL_STATUSES, { message: 'Estado civil inválido.' }),
      ])
      .transform((value) => value || null),
    phone: phoneSchema('El teléfono'),
    taxId: z
      .union([z.null(), z.literal(''), plainText('El CUIL', 20)])
      .transform((value) => (value ? value : null))
      .refine(
        (value) => value === null || /^[0-9-]{8,20}$/.test(value),
        'El CUIL solo admite números y guiones.',
      ),
    healthInsurance: optionalText('La obra social', 80),
    emergencyContactName: optionalText('El contacto de emergencia', 80),
    emergencyContactPhone: phoneSchema('El teléfono de emergencia'),
  })
  .strict();

export const createChildBodySchema = z
  .object({
    name: plainText('El nombre', 60),
    birthDate: z
      .union([z.null(), z.literal(''), dateSchema])
      .optional()
      .transform((value) => value || null),
  })
  .strict();
