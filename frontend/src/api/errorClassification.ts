import { RefreshUncertainError } from '../auth/refreshRecovery';
import { WakeCancelledError } from '../connectivity/backendAvailability';
import {
  connectivityMessage,
  NETWORK_ERROR_MESSAGE,
  RATE_LIMITED_MESSAGE,
  TEMPORARY_ERROR_MESSAGE,
  UNEXPECTED_ERROR_MESSAGE,
} from './errorMessages';
import { ApiError } from './httpClient';
import {
  BackendUnavailableError,
  NetworkError,
  OfflineError,
  RequestTimeoutError,
} from './transportErrors';

/**
 * Clasificación explícita de errores (Etapa 5R) — ver docs/ARCHITECTURE.md
 * §32. Solo `backendUnavailable`, `network`, `offline` y `timeout` abren la
 * recuperación automática; ninguno de ellos cierra la sesión. Solo
 * `authentication` (401 que sobrevivió al refresh) la da por vencida.
 */
export type ErrorKind =
  | 'authentication'
  | 'authorization'
  | 'validation'
  | 'rateLimit'
  | 'server'
  | 'backendUnavailable'
  | 'network'
  | 'offline'
  | 'timeout'
  | 'sessionUncertain'
  | 'cancelled'
  | 'unexpected';

export function classifyError(error: unknown): ErrorKind {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'authentication';
    if (error.status === 403) return 'authorization';
    if (error.status === 429) return 'rateLimit';
    if (error.status >= 500) return error.fromBackend ? 'server' : 'backendUnavailable';
    return 'validation';
  }
  if (error instanceof OfflineError) return 'offline';
  if (error instanceof BackendUnavailableError) return 'backendUnavailable';
  if (error instanceof RequestTimeoutError) return 'timeout';
  if (error instanceof NetworkError) {
    return typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'network';
  }
  if (error instanceof RefreshUncertainError) return 'sessionUncertain';
  if (error instanceof WakeCancelledError) return 'cancelled';
  return 'unexpected';
}

/** Fallas temporales de disponibilidad: se recuperan solas, nunca prueban que la sesión terminó. */
export function isTemporaryUnavailability(error: unknown): boolean {
  const kind = classifyError(error);
  return (
    kind === 'backendUnavailable' || kind === 'network' || kind === 'offline' || kind === 'timeout'
  );
}

/** Texto visible para cualquier error: nunca códigos técnicos ni el crudo. */
export function userMessageForError(error: unknown): string {
  switch (classifyError(error)) {
    case 'rateLimit':
      return error instanceof ApiError ? error.message : RATE_LIMITED_MESSAGE;
    case 'authentication':
    case 'authorization':
    case 'validation':
      return (error as ApiError).message;
    case 'server':
      return TEMPORARY_ERROR_MESSAGE;
    case 'offline':
      return connectivityMessage(error);
    case 'backendUnavailable':
    case 'network':
    case 'timeout':
      return NETWORK_ERROR_MESSAGE;
    case 'sessionUncertain':
      return 'No pudimos confirmar tu sesión. Volvé a ingresar para continuar.';
    default:
      return UNEXPECTED_ERROR_MESSAGE;
  }
}
