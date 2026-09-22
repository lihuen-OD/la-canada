export interface AppEnv {
  /** Base URL de la API del backend, ya con el prefijo de versión (ej: http://localhost:4000/api/v1). */
  apiUrl: string;
  /** Modo de Vite actual (development / production / test). */
  mode: string;
}

/**
 * Función pura para poder testearla sin depender de `import.meta.env` global
 * (que no es trivial de mockear en Vitest). Valida que VITE_API_URL exista
 * y solo lee lo que Vite ya decidió exponer al cliente (variables
 * prefijadas con VITE_) — nunca distribuye nada que no sea explícitamente
 * público.
 */
export function resolveEnv(rawEnv: ImportMetaEnv): AppEnv {
  const apiUrl = rawEnv.VITE_API_URL;
  if (!apiUrl) {
    throw new Error(
      'Falta la variable de entorno VITE_API_URL. Definila en el archivo .env de la raíz del ' +
        'proyecto (ver .env.example) — el frontend la necesita para saber a qué backend llamar.',
    );
  }
  return { apiUrl, mode: rawEnv.MODE };
}

let cachedEnv: AppEnv | undefined;

/**
 * Se evalúa recién en el primer uso real, no al importar el módulo — así
 * un archivo puede importar de acá sin verse obligado a tener VITE_API_URL
 * disponible si nunca termina usándola (por ejemplo, en tests enfocados en
 * otra cosa).
 */
export function getAppEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = resolveEnv(import.meta.env);
  }
  return cachedEnv;
}
