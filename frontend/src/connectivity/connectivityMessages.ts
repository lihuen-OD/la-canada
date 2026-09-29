/**
 * Textos de disponibilidad (Etapa 5R) — todos en español y sin códigos
 * técnicos. Nunca prometen "unos minutos" antes de que pase ese tiempo ni
 * afirman que el servidor está caído definitivamente.
 */
export const WAKE_TITLE = 'Preparando La Cañada';
export const WAKE_MESSAGE =
  'Estamos iniciando el servidor y recuperando tu información. Esto puede demorar hasta un minuto.';
export const WAKE_RETRYING = 'Reintentando automáticamente…';
export const LONG_WAIT_MESSAGE =
  'El servidor está tardando más de lo habitual. Podés seguir esperando o reintentar ahora.';
export const OFFLINE_TITLE = 'Sin conexión a Internet.';
export const OFFLINE_WAKE_MESSAGE = 'Volveremos a intentar cuando se restablezca.';
export const OFFLINE_APP_MESSAGE =
  'Cuando vuelva la conexión, intentaremos actualizar automáticamente.';
export const RECONNECTING_MESSAGE = 'Reconectando con el servidor… Tus datos siguen visibles.';
export const RECOVERED_MESSAGE = 'Conexión restablecida.';
export const RETRY_NOW_LABEL = 'Reintentar ahora';
export const LOGIN_OFFLINE_MESSAGE =
  'Sin conexión a Internet: tu PIN no se envió. Volvé a ingresarlo cuando vuelva la conexión.';
export const LOGIN_WAKING_MESSAGE =
  'El servidor todavía está iniciando. Esperá un momento y volvé a ingresar tu PIN.';
export const SESSION_UNCERTAIN_TITLE = 'No pudimos confirmar tu sesión.';
export const SESSION_UNCERTAIN_MESSAGE =
  'La conexión se cortó mientras renovábamos tu sesión. Podés reintentar o volver a ingresar con tu PIN.';
export const SESSION_UNCERTAIN_RETRY = 'Reintentar';
export const SESSION_UNCERTAIN_ACTION = 'Volver a ingresar';

/** "12 s", "1 min 05 s" — tiempo real transcurrido, nunca un porcentaje inventado. */
export function formatWaitTime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes} min ${seconds} s`;
}
