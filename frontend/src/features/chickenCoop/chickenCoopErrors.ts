import { ApiError } from '../../api/httpClient';

export const NETWORK_ERROR_MESSAGE = 'No se pudo conectar. Intentá de nuevo.';

const MESSAGES: Readonly<Record<string, string>> = {
  IDEMPOTENCY_KEY_CONFLICT:
    'El formulario cambió respecto del envío anterior. Revisá los datos y registralo de nuevo.',
  IDEMPOTENCY_RECORD_PENDING:
    'El registro anterior todavía se está resolviendo. Esperá unos segundos y tocá «Consultar estado»: no se registrará dos veces.',
  IDEMPOTENCY_KEY_INVALID: 'No pudimos identificar el envío. Recargá los datos y volvé a intentar.',
};

/** Mensaje humano: los errores del gallinero ya llegan con texto legible del backend. */
export function errorMessageOf(error: unknown): string {
  if (!(error instanceof ApiError)) return NETWORK_ERROR_MESSAGE;
  return (error.code && MESSAGES[error.code]) || error.message;
}

export function errorCodeOf(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

/** 401 que sobrevivió al refresh-y-reintento central: la sesión ya no es válida. */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
