/**
 * Estado "refresh en duda" (Etapa 5R) — ver `refreshCoordinator.ts`. Módulo
 * aparte y sin dependencias: lo leen la UI (`ConnectionBanner`,
 * `AuthProvider`) y la clasificación de errores sin arrastrar el cliente HTTP.
 * Solo en memoria: se pierde al recargar, igual que el access token.
 */
export type RefreshRecovery = 'none' | 'uncertain';

let recovery: RefreshRecovery = 'none';
const listeners = new Set<() => void>();

/** No se intentó el refresh: uno anterior quedó sin confirmar y repetirlo podría revocar todas las sesiones. */
export class RefreshUncertainError extends Error {
  constructor() {
    super('No pudimos confirmar tu sesión.');
    this.name = 'RefreshUncertainError';
  }
}

function setRecovery(next: RefreshRecovery): void {
  if (recovery === next) return;
  recovery = next;
  for (const listener of listeners) listener();
}

export function getRefreshRecovery(): RefreshRecovery {
  return recovery;
}

export function subscribeToRefreshRecovery(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Un refresh enviado falló de forma ambigua: se bloquean los refresh automáticos. */
export function markRefreshUncertain(): void {
  setRecovery('uncertain');
}

/** Login exitoso o logout: la cookie en duda ya no se va a volver a presentar. */
export function resetRefreshRecovery(): void {
  setRecovery('none');
}
