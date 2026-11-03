import { config as loadDotenvFile } from 'dotenv';
import { resolve } from 'node:path';

/** Solo `.env.<nombre>` de la raíz del monorepo (nunca una ruta arbitraria). */
const ALTERNATIVE_FILE = /^\.env\.[A-Za-z0-9_-]+$/;

/**
 * Archivos de entorno LOCALES, en orden: el alternativo que indique
 * `LA_CANADA_ENV_FILE` (p. ej. `.env.huerta-cultivos`, con las conexiones de
 * una rama de Neon aislada) y después `.env`. dotenv nunca sobrescribe, así
 * que lo del alternativo gana y lo que no define sale de `.env`. Sin la
 * variable, exactamente el comportamiento de siempre. En Render no hay
 * archivos: es un no-op.
 */
export function loadLocalEnvFiles(rootDir: string): void {
  const alternative = process.env.LA_CANADA_ENV_FILE;
  if (alternative) {
    if (!ALTERNATIVE_FILE.test(alternative)) {
      throw new Error(
        'LA_CANADA_ENV_FILE debe ser un archivo `.env.<nombre>` de la raíz del repo.',
      );
    }
    loadDotenvFile({ path: resolve(rootDir, alternative) });
  }
  loadDotenvFile({ path: resolve(rootDir, '.env') });
}
