/**
 * Intento de refresh en curso (Etapa 5R) — ver docs/ARCHITECTURE.md §32.
 *
 * El backend deriva la sucesora de una rotación del token presentado y de
 * este identificador: reenviar el MISMO intento después de una respuesta
 * perdida recupera la misma sucesora en lugar de disparar la detección de
 * reuso. Para que eso funcione también si la pestaña se recarga o se cierra
 * con el pedido en vuelo, el intento se guarda ANTES de enviar el refresh.
 *
 * Único dato persistido del frontend, y a propósito mínimo:
 * - qué: `{ id, startedAt }` — 128 bits aleatorios y la hora de creación.
 *   No es un token: solo, no autoriza nada (la cookie `HttpOnly` sigue
 *   siendo imprescindible) y no contiene datos de la persona;
 * - dónde: `localStorage`, porque tiene que sobrevivir a una recarga y
 *   compartirse entre pestañas (dos pestañas que restauran sesión a la vez
 *   usan el mismo intento y el backend les devuelve la misma sucesora);
 * - cuánto: hasta que se conoce el resultado (éxito o rechazo definitivo),
 *   un login o un logout confirmado; como máximo 24 h, el mismo plazo en el
 *   que el backend acepta reenvíos. Uno vencido se descarta al leerlo.
 * Si el navegador bloquea el storage, se usa un intento en memoria: cubre el
 * reintento dentro de la misma página, no la recarga.
 */
const STORAGE_KEY = 'lc.refresh-attempt.v1';
export const REFRESH_ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

interface StoredAttempt {
  id: string;
  startedAt: number;
}

let memoryAttempt: StoredAttempt | null = null;

function newAttemptId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isValid(value: unknown): value is StoredAttempt {
  if (typeof value !== 'object' || value === null) return false;
  const { id, startedAt } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    ID_PATTERN.test(id) &&
    typeof startedAt === 'number' &&
    Date.now() - startedAt < REFRESH_ATTEMPT_TTL_MS &&
    startedAt <= Date.now() + 60_000
  );
}

function read(): StoredAttempt | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return memoryAttempt && isValid(memoryAttempt) ? memoryAttempt : null;
    const parsed: unknown = JSON.parse(raw);
    if (isValid(parsed)) return parsed;
    localStorage.removeItem(STORAGE_KEY);
    return null;
  } catch {
    return memoryAttempt && isValid(memoryAttempt) ? memoryAttempt : null;
  }
}

function write(attempt: StoredAttempt): void {
  memoryAttempt = attempt;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    // Storage bloqueado: queda el intento en memoria.
  }
}

/** El intento pendiente, si hay uno vigente (para el logout). */
export function peekRefreshAttempt(): string | null {
  return read()?.id ?? null;
}

/** Reutiliza el intento pendiente o crea uno nuevo, y lo persiste antes de devolverlo. */
function getOrCreateSync(): string {
  const existing = read();
  if (existing) return existing.id;
  const attempt = { id: newAttemptId(), startedAt: Date.now() };
  write(attempt);
  return attempt.id;
}

/**
 * Con Web Locks (todos los navegadores actuales), leer-o-crear es atómico
 * entre pestañas; sin ellos, síncrono (la carrera entre pestañas queda
 * reducida a pestañas que arrancan en el mismo milisegundo).
 */
export function acquireRefreshAttempt(): string | Promise<string> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return getOrCreateSync();
  return locks.request('lc-refresh-attempt', () => getOrCreateSync());
}

/** Resultado conocido (éxito, rechazo definitivo), login o logout confirmado. */
export function clearRefreshAttempt(): void {
  memoryAttempt = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sin storage no hay nada persistido que borrar.
  }
}
