import { z } from 'zod';

/**
 * Nombre visible de una persona (Etapa 5F) — la ÚNICA validación, compartida
 * por Mi perfil (ADMIN → `UserProfile.displayName`, EMPLOYEE →
 * `Employee.displayName`) y por la administración de personas (alta y
 * edición). Es solo el nombre humano que muestra la interfaz: nunca toca
 * `username`, `code`, ids, rol ni relaciones. Sin unicidad (dos personas
 * pueden llamarse igual).
 *
 * Reglas: trim + espacios internos colapsados; 2–100 caracteres; letras de
 * cualquier idioma (tildes, ñ, ü…), espacio, apóstrofe (' o ’), guion y punto
 * (iniciales: "María J."); al menos dos letras; sin dígitos, símbolos ni
 * caracteres de control. Mensajes en español.
 */
export const PERSON_NAME_MIN = 2;
export const PERSON_NAME_MAX = 100;

const ALLOWED = /^[\p{L}\p{M} '’.-]+$/u;
const LETTER = /\p{L}/gu;

export const normalizePersonName = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const personDisplayNameSchema = z
  .string({ message: 'Ingresá el nombre.' })
  .transform(normalizePersonName)
  .pipe(
    z
      .string()
      .min(1, 'Ingresá el nombre.')
      .max(PERSON_NAME_MAX, `El nombre no puede superar ${PERSON_NAME_MAX} caracteres.`)
      .refine(
        (text) => ALLOWED.test(text),
        'El nombre solo puede tener letras, espacios, apóstrofes, guiones y puntos.',
      )
      .refine(
        (text) => (text.match(LETTER) ?? []).length >= PERSON_NAME_MIN,
        `El nombre debe tener al menos ${PERSON_NAME_MIN} letras.`,
      ),
  );
