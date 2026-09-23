/**
 * Normaliza un nombre a un username estable: minúsculas, sin
 * acentos/diacríticos, solo [a-z0-9._-]. Fuente única de verdad — usada
 * tanto por el seed (`prisma/seed-data/normalize.ts`, que reexporta desde
 * acá) como por el login (misma regla para no crear dos formas distintas
 * de identificar al mismo usuario).
 */
export function normalizeUsername(displayName: string): string {
  return displayName
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]/g, '');
}
