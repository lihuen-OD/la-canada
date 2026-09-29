import { OfflineError } from './transportErrors';

/**
 * Textos de error visibles, en español claro. El backend ya responde un
 * mensaje humano (`{ error: { code, message } }`); esto cubre lo que no llega
 * de él: sin conexión, una respuesta que no es JSON (proxy, caída) y el
 * límite de intentos. Nunca se muestra "Failed to fetch", "Unauthorized" ni
 * un código solo.
 */
/**
 * Falla de transporte (sin respuesta del backend). La usan sobre todo los
 * formularios: una escritura sin respuesta es ambigua (pudo haberse
 * guardado), así que el texto pide revisar antes de repetirla — nunca se
 * repite sola (Etapa 5R).
 */
export const NETWORK_ERROR_MESSAGE =
  'No pudimos comunicarnos con el servidor. Si estabas guardando cambios, revisá si quedaron registrados antes de volver a intentar.';
/**
 * Escritura intentada sin Internet (`OfflineError`): se sabe que NO se envió,
 * así que no hay nada que revisar — solo repetirla a mano (Etapa 5R).
 */
export const OFFLINE_WRITE_MESSAGE =
  'Sin conexión a Internet: no se guardó ningún cambio. Cuando vuelva la conexión, volvé a intentarlo.';

/** Texto para una falla sin respuesta del backend: segura si no se envió, ambigua si sí. */
export function connectivityMessage(error: unknown): string {
  return error instanceof OfflineError ? OFFLINE_WRITE_MESSAGE : NETWORK_ERROR_MESSAGE;
}

/** 5xx del propio backend: está disponible pero falló — nunca se dice que "está despertando". */
export const TEMPORARY_ERROR_MESSAGE =
  'No pudimos comunicarnos con el servidor. Intentá nuevamente.';
export const UNEXPECTED_ERROR_MESSAGE = 'Ocurrió un error inesperado. Intentá nuevamente.';
export const RATE_LIMITED_MESSAGE =
  'Realizaste demasiados intentos. Esperá unos minutos antes de volver a intentar.';

const STATUS_FALLBACK: Readonly<Record<number, string>> = {
  400: 'Revisá los datos ingresados.',
  401: 'Tu sesión venció. Volvé a ingresar.',
  403: 'No tenés permiso para realizar esta acción.',
  404: 'No encontramos lo que buscás.',
  409: 'Los datos cambiaron mientras tanto. Actualizá la pantalla e intentá nuevamente.',
  413: 'El archivo es demasiado grande.',
  415: 'Los datos enviados no tienen un formato válido. Revisalos e intentá nuevamente.',
  429: RATE_LIMITED_MESSAGE,
};

/** Mensaje por código HTTP cuando la respuesta no trae un mensaje utilizable. */
export function fallbackMessageForStatus(status: number): string {
  return STATUS_FALLBACK[status] ?? UNEXPECTED_ERROR_MESSAGE;
}
