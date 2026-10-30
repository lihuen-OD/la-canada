import { z } from 'zod';
import { personDisplayNameSchema } from '../lib/personName';
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

export const NEWS_REPLY_TEXT_MAX = 1000;

function containsDisallowedControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (
      code !== undefined &&
      ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f)
    ) {
      return true;
    }
  }
  return false;
}

const newsReplyTextSchema = z
  .string({ message: 'La respuesta debe ser texto.' })
  .transform((text) => text.trim().replace(/\r\n?/g, '\n'))
  .pipe(
    z
      .string()
      .min(1, 'La respuesta no puede estar vacía.')
      .max(NEWS_REPLY_TEXT_MAX, `La respuesta no puede superar ${NEWS_REPLY_TEXT_MAX} caracteres.`)
      .refine(
        (text) => !containsDisallowedControlCharacters(text),
        'La respuesta contiene caracteres inválidos.',
      ),
  );

export const createNewsReplyBodySchema = z
  .object({
    text: newsReplyTextSchema,
    quotedReplyId: uuidSchema.optional(),
  })
  .strict();

/**
 * Versión que el cliente vio al abrir la edición o la confirmación: si el
 * mensaje cambió desde entonces, el backend responde 409 en vez de pisarlo.
 */
const messageVersionSchema = z
  .number({ message: 'Falta la versión del mensaje.' })
  .int('La versión del mensaje es inválida.')
  .min(1, 'La versión del mensaje es inválida.')
  .max(2_147_483_647, 'La versión del mensaje es inválida.');

/** Editar el texto de una novedad: las mismas validaciones que el alta. */
export const updateNewsBodySchema = z
  .object({ text: plainText('La novedad', NEWS_TEXT_MAX), version: messageVersionSchema })
  .strict();

/** Editar una respuesta: las mismas validaciones que al enviarla. */
export const updateNewsReplyBodySchema = z
  .object({ text: newsReplyTextSchema, version: messageVersionSchema })
  .strict();

/** Eliminar (lógicamente) una novedad o una respuesta. */
export const deleteNewsMessageBodySchema = z.object({ version: messageVersionSchema }).strict();

export const listNewsRepliesQuerySchema = z
  .object({
    beforeCreatedAt: z.iso.datetime({ offset: true }).optional(),
    beforeId: uuidSchema.optional(),
  })
  .strict()
  .refine((query) => (query.beforeCreatedAt === undefined) === (query.beforeId === undefined), {
    message: 'El cursor de respuestas está incompleto.',
  });

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

/**
 * `folder`: sin valor = todas las fotos; `none` = «Sin carpeta»; un UUID =
 * esa carpeta. Combinable con el tipo y la página.
 */
export const listPhotosQuerySchema = z
  .object({
    category: z.enum(GALLERY_CATEGORIES, { message: 'Tipo de foto inválido.' }).optional(),
    folder: z
      .union([z.literal('none'), z.string().uuid()], { message: 'Carpeta inválida.' })
      .transform((value) => value.toLowerCase())
      .optional(),
    page: pageSchema,
    pageSize: pageSizeSchema(48, 24),
  })
  .strict();

/**
 * Metadatos de "Guardar foto" (viajan en la query: el cuerpo es la imagen).
 * Título vacío = "Sin título" (prototipo); persona opcional; carpeta
 * opcional (sin ella, «Sin carpeta», como toda foto anterior).
 */
export const uploadPhotoQuerySchema = z
  .object({
    title: z
      .union([z.literal(''), plainText('El título', PHOTO_TITLE_MAX)])
      .optional()
      .transform((value) => value || 'Sin título'),
    category: z.enum(GALLERY_CATEGORIES, { message: 'Elegí el tipo de foto.' }),
    employeeId: uuidSchema.optional(),
    folderId: uuidSchema.transform((value) => value.toLowerCase()).optional(),
  })
  .strict();

// ── 📸 Carpetas de Fotos ─────────────────────────────────────────────────

export const PHOTO_FOLDER_NAME_MAX = 80;
/** Nombres de los accesos especiales de la pantalla: no pueden ser carpetas. */
export const RESERVED_PHOTO_FOLDER_NAMES = ['Sin carpeta', 'Todas las fotos'] as const;

/**
 * Clave de unicidad de una carpeta: el nombre YA normalizado en minúsculas.
 * Dos nombres que solo difieren en mayúsculas o en espacios son el mismo.
 */
export const photoFolderNameKey = (name: string) => name.toLowerCase();
const RESERVED_KEYS = new Set(
  RESERVED_PHOTO_FOLDER_NAMES.map((name) => photoFolderNameKey(normalizeStockText(name))),
);

/**
 * Nombre de carpeta: texto plano (sin HTML ni caracteres de control),
 * Unicode NFC, extremos recortados y espacios internos colapsados, de 1 a
 * 80 caracteres y distinto de los accesos especiales.
 */
const photoFolderNameSchema = z
  .string({ message: 'El nombre de la carpeta debe ser texto.' })
  .transform((value) => value.normalize('NFC'))
  .pipe(plainText('El nombre de la carpeta', PHOTO_FOLDER_NAME_MAX))
  .refine(
    (name) => !RESERVED_KEYS.has(photoFolderNameKey(name)),
    '«Sin carpeta» y «Todas las fotos» son accesos de Fotos: elegí otro nombre.',
  );

/** Versión que se vio al abrir el renombre o la confirmación (409 si cambió). */
const photoFolderVersionSchema = z
  .number({ message: 'Falta la versión de la carpeta.' })
  .int('La versión de la carpeta es inválida.')
  .min(1, 'La versión de la carpeta es inválida.')
  .max(2_147_483_647, 'La versión de la carpeta es inválida.');

export const createPhotoFolderBodySchema = z.object({ name: photoFolderNameSchema }).strict();

export const renamePhotoFolderBodySchema = z
  .object({ name: photoFolderNameSchema, version: photoFolderVersionSchema })
  .strict();

export const deletePhotoFolderBodySchema = z.object({ version: photoFolderVersionSchema }).strict();

const folderRefSchema = (message: string) =>
  z.union(
    [
      z.null(),
      z
        .string()
        .uuid()
        .transform((value) => value.toLowerCase()),
    ],
    { message },
  );

/**
 * "Mover a carpeta": destino (`null` = «Sin carpeta») y la carpeta en la que
 * quien mueve VIO la foto (`fromFolderId`). Si ya no está ahí, 409 en lugar
 * de pisar el movimiento de otra persona.
 */
export const movePhotoBodySchema = z
  .object({
    folderId: folderRefSchema('Elegí una carpeta.'),
    fromFolderId: folderRefSchema('Falta la carpeta en la que estaba la foto.'),
  })
  .strict();

// ── 🌳 Jardín: versiones del plano (Etapa 5Y) ───────────────────────────

/**
 * Historial de versiones. No hay filtros: el prototipo no tenía esta pantalla
 * (módulo nuevo), así que el contrato es el mínimo que la UI necesita — página
 * y tamaño (tope 50, como el resto de listas de Más).
 */
export const listGardenVersionsQuerySchema = z
  .object({ page: pageSchema, pageSize: pageSizeSchema(50, 20) })
  .strict();

// ── ⚙️ Configuración: personas y datos del equipo (ADMIN) ────────────────

const colorSchema = z
  .string({ message: 'Elegí un color.' })
  .regex(/^#[0-9a-fA-F]{6}$/, 'El color debe ser hexadecimal (#rrggbb).')
  .transform((value) => value.toLowerCase());

export const createEmployeeBodySchema = z
  .object({
    /** Etapa 5F: la validación única del nombre visible (antes texto libre de 40). */
    displayName: personDisplayNameSchema,
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
    /** Etapa 5F: nombre visible propio → `Employee.displayName` (nunca `code`/`username`). */
    displayName: personDisplayNameSchema,
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

// ── 👤 Mi perfil personal y 👨‍👩‍👧‍👦 Mi familia (usuario sin Employee, Etapa 5F) ──

export const FAMILY_RELATIONS = ['PARTNER', 'CHILD', 'FAMILY', 'OTHER'] as const;
export const FAMILY_NAME_MAX = 60;

/** "🎂 Mi cumpleaños" + nombre visible propio (obligatorio al guardar; fecha vacía = sin dato). */
export const updatePersonalProfileBodySchema = z
  .object({
    displayName: personDisplayNameSchema,
    birthDate: z.union([z.null(), z.literal(''), dateSchema]).transform((value) => value || null),
  })
  .strict();

/**
 * Fecha de nacimiento de un familiar: `YYYY-MM-DD` (año conocido, lo que envía
 * `<input type="date">`) o `--MM-DD` (ISO 8601 sin año, cuando no se conoce —
 * nunca un año de relleno). El servicio valida que sea una fecha real.
 */
export const familyBirthDateSchema = z
  .string({ message: 'Ingresá la fecha de nacimiento.' })
  .regex(/^(\d{4}|-)-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD o --MM-DD.');

const familyRelationSchema = z.enum(FAMILY_RELATIONS, { message: 'Elegí una relación.' });

export const createFamilyMemberBodySchema = z
  .object({
    name: plainText('El nombre', FAMILY_NAME_MAX),
    relation: familyRelationSchema,
    birthDate: familyBirthDateSchema,
  })
  .strict();

export const updateFamilyMemberBodySchema = z
  .object({
    name: createFamilyMemberBodySchema.shape.name.optional(),
    relation: familyRelationSchema.optional(),
    birthDate: familyBirthDateSchema.optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'No hay cambios para aplicar.',
  });

export const familyStatusBodySchema = z.object({ active: z.boolean() }).strict();

export const createChildBodySchema = z
  .object({
    name: plainText('El nombre', 60),
    birthDate: z
      .union([z.null(), z.literal(''), dateSchema])
      .optional()
      .transform((value) => value || null),
  })
  .strict();
