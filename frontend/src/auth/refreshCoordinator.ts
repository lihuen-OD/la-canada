import { refreshSession } from '../api/authApi';
import { ApiError } from '../api/httpClient';
import { isTransportFailure } from '../api/transportErrors';
import { ensureBackendAwake, getBackendAvailability } from '../connectivity/backendAvailability';
import { getEpoch, setAccessToken } from './accessTokenStore';
import { acquireRefreshAttempt, clearRefreshAttempt } from './refreshAttempt';
import {
  RefreshUncertainError,
  getRefreshRecovery,
  markRefreshUncertain,
  resetRefreshRecovery,
} from './refreshRecovery';

/**
 * Coordinador single-flight de `POST /auth/refresh` — un único mecanismo
 * cubre dos disparadores distintos que, sin esto, podrían mandar dos
 * refresh reales al mismo tiempo:
 *
 * 1. La restauración de sesión al montar la app. React StrictMode ejecuta
 *    efectos dos veces en desarrollo — sin single-flight, eso dispararía
 *    dos `POST /auth/refresh` con el mismo refresh token. El backend trata
 *    la rotación concurrente como posible robo (ver
 *    `backend/src/auth/authService.ts`, detección de reuso/rotación
 *    concurrente): el "perdedor" de esa carrera puede terminar revocando
 *    TODAS las sesiones del usuario, incluida la que "ganó" — un
 *    montaje doble rompería el login que se acababa de restaurar.
 * 2. Varias requests autenticadas que reciben 401 casi al mismo tiempo
 *    (`api/httpClient.ts`): deben compartir un solo refresh, no disparar
 *    uno cada una.
 *
 * Mientras haya un refresh en curso, cualquier llamada adicional recibe la
 * MISMA promesa (nunca dispara una request HTTP nueva) — se limpia sola al
 * terminar, resuelva o falle.
 *
 * **Refresh ambiguo (Etapa 5R).** Un refresh ya enviado que falla por red,
 * timeout o un 5xx pudo haber rotado la sesión en el servidor aunque la
 * respuesta (y su cookie nueva) no haya llegado. Cada refresh lleva un
 * intento (`refreshAttempt.ts`) persistido ANTES de enviarse: reenviar el
 * mismo intento con la cookie vieja recupera la misma sucesora en el backend,
 * en lugar de activar la detección de reuso. Aun así, tras un fallo ambiguo
 * este módulo queda en `uncertain` y no reintenta solo (`RefreshUncertainError`
 * sin tocar la red): el reenvío lo decide la persona (`retryUncertainRefresh`)
 * o ocurre al recargar, siempre con el MISMO intento. Nunca se convierte solo
 * en logout. El intento se borra al conocer el resultado.
 */
let inFlight: Promise<string> | null = null;

/**
 * ¿Pudo el servidor haber rotado la sesión sin que llegara la respuesta?
 * Un 4xx es definitivo (no rotó). El 503 `AUTH_REFRESH_UNAVAILABLE` lo
 * garantiza explícitamente el backend: no rotó ni revocó nada. Todo lo demás
 * (red, timeout, 5xx de proxy o del backend) queda en duda.
 */
function isAmbiguousRefreshFailure(error: unknown): boolean {
  if (isTransportFailure(error)) return true;
  if (!(error instanceof ApiError)) return false;
  return error.status >= 500 && error.code !== 'AUTH_REFRESH_UNAVAILABLE';
}

export function requestRefresh(): Promise<string> {
  if (getRefreshRecovery() === 'uncertain') return Promise.reject(new RefreshUncertainError());
  inFlight ??= runRefresh();
  return inFlight;
}

/**
 * Reintento manual de un refresh en duda: reenvía el MISMO intento, así que
 * si la rotación ya había ocurrido el backend devuelve la misma sucesora.
 */
export function retryUncertainRefresh(): Promise<string> {
  resetRefreshRecovery();
  return requestRefresh();
}

/** ¿El resultado ya se conoce? Éxito o un rechazo del backend que no sea un 5xx. */
function isDefinitiveRefreshFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status < 500;
}

/**
 * Espera a que termine el refresh en vuelo, si lo hay, sin propagar su
 * resultado (Etapa 5P). El logout lo usa ANTES de llamar a `/auth/logout`:
 * si un refresh rotó la sesión en el servidor mientras la persona cerraba
 * sesión, la cookie `HttpOnly` nueva ya quedó en el navegador y el logout la
 * envía y la revoca — nunca queda viva una sesión rotada a destiempo.
 */
export async function settleInFlightRefresh(): Promise<void> {
  if (!inFlight) return;
  await inFlight.then(
    () => undefined,
    () => undefined,
  );
}

async function runRefresh(): Promise<string> {
  try {
    // Capturada ANTES del round-trip de red: si un logout corre mientras
    // este refresh todavía está en vuelo, la época cambia, y el resultado
    // (aunque el backend lo haya aceptado) se descarta más abajo — nunca
    // se debe re-autenticar a alguien que ya cerró sesión deliberadamente.
    const startEpoch = getEpoch();
    // Etapa 5R: el refresh se envía recién con el backend despierto (sin
    // request extra si ya está `online`). Mandarlo a un Render dormido lo
    // expondría a quedar ambiguo por un timeout de proxy.
    // Sin `await` cuando ya está `online`: el POST sale en el mismo tick.
    if (getBackendAvailability().status !== 'online') await ensureBackendAwake();
    // Persistido antes del envío: una recarga en vuelo reenvía este mismo intento.
    const pending = acquireRefreshAttempt();
    const attemptId = typeof pending === 'string' ? pending : await pending;
    let result;
    try {
      result = await refreshSession(attemptId);
    } catch (error) {
      if (isAmbiguousRefreshFailure(error)) markRefreshUncertain();
      else if (isDefinitiveRefreshFailure(error)) clearRefreshAttempt();
      throw error;
    }
    clearRefreshAttempt();
    if (getEpoch() !== startEpoch) {
      throw new Error(
        'Se descartó un refresh tardío: la sesión se cerró mientras estaba en vuelo.',
      );
    }
    setAccessToken(result.accessToken);
    return result.accessToken;
  } finally {
    inFlight = null;
  }
}
