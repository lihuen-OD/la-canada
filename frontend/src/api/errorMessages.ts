/**
 * Textos de error visibles, en español claro. El backend ya responde un
 * mensaje humano (`{ error: { code, message } }`); esto cubre lo que no llega
 * de él: sin conexión, una respuesta que no es JSON (proxy, caída) y el
 * límite de intentos. Nunca se muestra "Failed to fetch", "Unauthorized" ni
 * un código solo.
 */
export const NETWORK_ERROR_MESSAGE =
  'No pudimos conectar con el servidor. Revisá tu conexión e intentá nuevamente.';
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
