import { refreshSession } from '../api/authApi';
import { getEpoch, setAccessToken } from './accessTokenStore';

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
 */
let inFlight: Promise<string> | null = null;

export function requestRefresh(): Promise<string> {
  inFlight ??= runRefresh();
  return inFlight;
}

async function runRefresh(): Promise<string> {
  try {
    // Capturada ANTES del round-trip de red: si un logout corre mientras
    // este refresh todavía está en vuelo, la época cambia, y el resultado
    // (aunque el backend lo haya aceptado) se descarta más abajo — nunca
    // se debe re-autenticar a alguien que ya cerró sesión deliberadamente.
    const startEpoch = getEpoch();
    const result = await refreshSession();
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
