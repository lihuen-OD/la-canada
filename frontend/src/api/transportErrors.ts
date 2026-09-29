/**
 * Errores de transporte (Etapa 5R): la request no obtuvo una respuesta del
 * backend de La Cañada. Deliberadamente NO son `ApiError` — el código
 * existente trata "no es `ApiError`" como "problema de conexión" (mensaje de
 * conectividad, reintento manual), y estos tres casos son exactamente eso.
 * Nunca prueban que la sesión terminó.
 */

/** `fetch` rechazó: sin Internet, DNS, conexión cortada o rechazada. */
export class NetworkError extends Error {
  constructor() {
    super('No se pudo establecer la conexión con el servidor.');
    this.name = 'NetworkError';
  }
}

/** El servidor no respondió dentro del tiempo máximo de una lectura (`GET`). */
export class RequestTimeoutError extends Error {
  constructor() {
    super('El servidor no respondió a tiempo.');
    this.name = 'RequestTimeoutError';
  }
}

/**
 * 5xx que NO viene del backend: un proxy (Render mientras el servicio
 * despierta, Netlify, el proxy de Vite en desarrollo) respondió sin el cuerpo
 * JSON `{ error: { message } }` que el backend manda siempre. El backend
 * todavía no está disponible — distinto de un 5xx del propio backend, que
 * está despierto y falló (`ApiError` con `fromBackend: true`).
 */
export class BackendUnavailableError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('El servidor todavía no está disponible.');
    this.name = 'BackendUnavailableError';
    this.status = status;
  }
}

/**
 * Escritura intentada sin conexión (`navigator.onLine === false`): NO se
 * envió. A diferencia de `NetworkError`, no hay ambigüedad — el servidor
 * nunca la vio — y nunca se encola para mandarla sola al reconectar: la
 * persona la repite a mano (Etapa 5R). No abre la recuperación del backend
 * (la falta de Internet ya la informa el navegador).
 */
export class OfflineError extends Error {
  constructor() {
    super('Sin conexión a Internet: la operación no se envió.');
    this.name = 'OfflineError';
  }
}

/** Fallas que disparan la recuperación central (`connectivity/backendAvailability.ts`). */
export function isTransportFailure(
  error: unknown,
): error is NetworkError | RequestTimeoutError | BackendUnavailableError {
  return (
    error instanceof NetworkError ||
    error instanceof RequestTimeoutError ||
    error instanceof BackendUnavailableError
  );
}
