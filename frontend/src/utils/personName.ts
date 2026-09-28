/**
 * Espejo en el cliente de la validación única del nombre visible
 * (`backend/src/lib/personName.ts`), solo para avisar antes de enviar. El
 * backend vuelve a validar y es la autoridad; los mensajes son los mismos.
 */
export const PERSON_NAME_MAX = 100;
const ALLOWED = /^[\p{L}\p{M} '’.-]+$/u;
const LETTER = /\p{L}/gu;

export const normalizePersonName = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Mensaje en español si el nombre no es válido; null si está bien. */
export function personNameError(value: string): string | null {
  const name = normalizePersonName(value);
  if (!name) return 'Ingresá el nombre.';
  if (name.length > PERSON_NAME_MAX) {
    return `El nombre no puede superar ${PERSON_NAME_MAX} caracteres.`;
  }
  if (!ALLOWED.test(name)) {
    return 'El nombre solo puede tener letras, espacios, apóstrofes, guiones y puntos.';
  }
  if ((name.match(LETTER) ?? []).length < 2) return 'El nombre debe tener al menos 2 letras.';
  return null;
}
