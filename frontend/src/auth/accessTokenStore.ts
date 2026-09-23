/**
 * Fuente de verdad única y centralizada del access token — vive solo en
 * memoria del proceso de JS (una variable de módulo, no React state): nunca
 * `localStorage`, `sessionStorage`, `IndexedDB`, ni una cookie legible desde
 * JS. Se pierde a propósito al recargar la página — por diseño, la
 * restauración de sesión (`refreshCoordinator.ts`) es lo que la repone,
 * usando el refresh token opaco que el navegador nunca puede leer (cookie
 * `HttpOnly`).
 *
 * Deliberadamente NO es un módulo de React (sin Context, sin hooks): el
 * cliente HTTP (`api/httpClient.ts`) necesita leer el token de forma
 * síncrona en cada request, sin depender del árbol de componentes ni de
 * cuándo React decide re-renderizar. `AuthProvider` se suscribe acá para
 * reflejar los cambios en su propio estado — no al revés.
 */

export type AccessTokenListener = (token: string | null) => void;

let currentToken: string | null = null;
/**
 * Se incrementa en cada `clearAccessToken()` (logout, o un refresh que
 * falla). `refreshCoordinator` la usa para descartar el resultado de un
 * refresh que todavía estaba en vuelo cuando el logout ya se aplicó — sin
 * esto, un refresh tardío podría re-autenticar a alguien que ya cerró
 * sesión deliberadamente.
 */
let epoch = 0;
const listeners = new Set<AccessTokenListener>();

function notify(): void {
  for (const listener of listeners) {
    listener(currentToken);
  }
}

export function getAccessToken(): string | null {
  return currentToken;
}

export function getEpoch(): number {
  return epoch;
}

export function setAccessToken(token: string): void {
  currentToken = token;
  notify();
}

export function clearAccessToken(): void {
  currentToken = null;
  epoch += 1;
  notify();
}

/** @returns función para cancelar la suscripción. */
export function subscribeToAccessToken(listener: AccessTokenListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
