/**
 * Normaliza un nombre a display a un username estable: minúsculas, sin
 * acentos/diacríticos, solo [a-z0-9._-]. Usado para derivar el username de
 * cada Employee sembrado desde su `displayName` — ver docs/ARCHITECTURE.md,
 * "Usuarios pendientes de activación".
 */
export function normalizeUsername(displayName: string): string {
  return displayName
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]/g, '');
}
