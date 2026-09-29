import { ApiError } from '../../api/httpClient';

import { NETWORK_ERROR_MESSAGE, connectivityMessage } from '../../api/errorMessages';

export { NETWORK_ERROR_MESSAGE };

/** Mensaje humano del backend (`ApiError.message`) o de conectividad — nunca JSON crudo ni errores internos. */
export function errorMessageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : connectivityMessage(error);
}

/** 401 tras el refresh-y-reintento de `httpClient`: la sesión ya no es válida. */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
