export interface AppEnv {
  /** Modo de Vite actual (development / production / test). */
  mode: string;
}

/**
 * Función pura para poder testearla sin depender de `import.meta.env` global
 * (que no es trivial de mockear en Vitest).
 *
 * Ya no expone ninguna URL de backend (`VITE_API_URL` se eliminó — Etapa
 * 3C): toda llamada a la API usa una ruta relativa bajo `/api` (ver
 * `src/api/httpClient.ts`), resuelta en desarrollo por el proxy de Vite y en
 * producción por el proxy de Netlify — nunca una variable `VITE_*` que
 * exponga configuración de backend al bundle del cliente.
 */
export function resolveEnv(rawEnv: ImportMetaEnv): AppEnv {
  return { mode: rawEnv.MODE };
}

let cachedEnv: AppEnv | undefined;

/**
 * Se evalúa recién en el primer uso real, no al importar el módulo.
 */
export function getAppEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = resolveEnv(import.meta.env);
  }
  return cachedEnv;
}
