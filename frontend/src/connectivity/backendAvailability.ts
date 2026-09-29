/**
 * Coordinador único de disponibilidad del backend (Etapa 5R) — ver
 * docs/ARCHITECTURE.md §32.
 *
 * Render (plan gratuito) detiene el backend tras un rato sin tráfico y el
 * primer request lo despierta, con demoras de hasta un minuto. Este módulo
 * es la ÚNICA pieza que decide si el backend está disponible y la única que
 * consulta `GET /api/v1/health` para averiguarlo:
 *
 * - un solo health check en vuelo y una sola secuencia de reintentos, por más
 *   requests, pantallas o componentes que la pidan (todos comparten la misma
 *   promesa);
 * - estado a nivel de módulo, como `accessTokenStore`: StrictMode y los
 *   cambios de ruta no lo reinician; solo `resetBackendAvailability()`
 *   (logout/login) lo vuelve a `idle`;
 * - nada en storage;
 * - con el backend disponible (`online`) no hace ningún request: navegar no
 *   genera health checks. No hay keep-alive ni sondeo periódico — solo se
 *   consulta mientras hay una falla real que resolver.
 */

export type BackendStatus = 'idle' | 'checking' | 'waking' | 'online' | 'offline' | 'degraded';

export interface BackendAvailabilitySnapshot {
  /**
   * - `idle`: todavía no se sabe nada (arranque, o recién reiniciado);
   * - `checking`: primer health check del episodio en vuelo;
   * - `waking`: al menos un intento falló; se reintenta con backoff;
   * - `degraded`: igual que `waking`, pero ya pasó más de un minuto;
   * - `offline`: el navegador informa que no hay Internet (sondeo pausado);
   * - `online`: el backend respondió.
   */
  status: BackendStatus;
  /** Inicio del episodio de indisponibilidad actual (ms epoch), o `null`. */
  since: number | null;
  /** Momento del próximo intento programado, o `null` (en vuelo, pausado o sin episodio). */
  nextAttemptAt: number | null;
  attemptInFlight: boolean;
  /** Intentos fallidos del episodio actual. */
  failedAttempts: number;
  /** Reintentos pausados porque la pestaña está oculta. */
  pausedHidden: boolean;
}

/** Demora antes de mostrar cualquier aviso: una respuesta rápida nunca produce un parpadeo. */
export const WAKE_NOTICE_DELAY_MS = 1_500;
/** Pasado este tiempo, el aviso reconoce que está tardando más de lo habitual. */
export const LONG_WAIT_MS = 60_000;
/** Un health check que no responde se aborta y cuenta como intento fallido. */
export const HEALTH_TIMEOUT_MS = 10_000;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 10_000;
const JITTER_MAX_MS = 400;

const HEALTH_PATH = '/api/v1/health';

/** El episodio se canceló (logout/login) — quien esperaba ya no necesita el resultado. */
export class WakeCancelledError extends Error {
  constructor() {
    super('Se canceló la espera del servidor.');
    this.name = 'WakeCancelledError';
  }
}

const INITIAL: BackendAvailabilitySnapshot = {
  status: 'idle',
  since: null,
  nextAttemptAt: null,
  attemptInFlight: false,
  failedAttempts: 0,
  pausedHidden: false,
};

let snapshot: BackendAvailabilitySnapshot = INITIAL;
const listeners = new Set<() => void>();
let wake: { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void } | null =
  null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: AbortController | null = null;
/** Se incrementa en cada reinicio: descarta resultados de un health check de un episodio viejo. */
let generation = 0;
/** Estado al que se vuelve si se corta y vuelve Internet sin ninguna request esperando. */
let statusBeforeOffline: 'online' | 'idle' = 'idle';

function update(patch: Partial<BackendAvailabilitySnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function wakePromise(): Promise<void> {
  if (!wake) {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Un reinicio sin nadie esperando no debe producir un rechazo no manejado.
    promise.catch(() => undefined);
    wake = { promise, resolve, reject };
  }
  return wake.promise;
}

/** 2 s, 4 s, 8 s y luego 10 s como máximo, con un jitter chico para no sincronizar pestañas. */
export function backoffDelay(failedAttempts: number): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, failedAttempts - 1), BACKOFF_MAX_MS);
  return Math.min(base + Math.round(Math.random() * JITTER_MAX_MS), BACKOFF_MAX_MS);
}

/**
 * Un único `GET /health`, sin credenciales y sin caché. "Despierto" es
 * cualquier respuesta que no sea un 5xx: el backend respondió (hasta un 429
 * de su rate limit prueba que el proceso está corriendo). El endpoint no
 * consulta la base: despierta Render, nunca Neon.
 */
async function checkHealth(controller: AbortController): Promise<boolean> {
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(HEALTH_PATH, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function runAttempt(): void {
  if (inFlight || isBrowserOffline()) return;
  clearTimer();
  const attemptGeneration = generation;
  const controller = new AbortController();
  inFlight = controller;
  update({ attemptInFlight: true, nextAttemptAt: null, pausedHidden: false });
  void checkHealth(controller).then((awake) => {
    if (attemptGeneration !== generation || inFlight !== controller) return;
    inFlight = null;
    if (awake) {
      markBackendReachable();
    } else {
      handleFailedAttempt();
    }
  });
}

function handleFailedAttempt(): void {
  const failedAttempts = snapshot.failedAttempts + 1;
  const elapsed = Date.now() - (snapshot.since ?? Date.now());
  const status: BackendStatus = elapsed >= LONG_WAIT_MS ? 'degraded' : 'waking';
  if (isBrowserOffline()) {
    update({ status: 'offline', failedAttempts, attemptInFlight: false, nextAttemptAt: null });
    return;
  }
  if (isHidden()) {
    update({
      status,
      failedAttempts,
      attemptInFlight: false,
      nextAttemptAt: null,
      pausedHidden: true,
    });
    return;
  }
  const delay = backoffDelay(failedAttempts);
  timer = setTimeout(() => {
    timer = null;
    runAttempt();
  }, delay);
  update({ status, failedAttempts, attemptInFlight: false, nextAttemptAt: Date.now() + delay });
}

/** Abre un episodio de indisponibilidad si no hay uno en curso. */
function beginEpisode(): void {
  const { status } = snapshot;
  if (status !== 'online' && status !== 'idle') return;
  if (isBrowserOffline()) {
    update({ ...INITIAL, status: 'offline', since: Date.now() });
    return;
  }
  update({ ...INITIAL, status: 'checking', since: Date.now() });
  runAttempt();
}

// ── API pública ─────────────────────────────────────────────────────────────

export function getBackendAvailability(): BackendAvailabilitySnapshot {
  return snapshot;
}

export function subscribeToBackendAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Resuelve cuando el backend está disponible. Con `online` resuelve al
 * instante y sin requests; si no, se suma al episodio en curso (o abre uno).
 * Nunca rechaza por "tarda mucho": solo `WakeCancelledError` al reiniciar.
 */
export function ensureBackendAwake(): Promise<void> {
  if (snapshot.status === 'online') return Promise.resolve();
  const promise = wakePromise();
  beginEpisode();
  return promise;
}

/** Una request no obtuvo respuesta del backend (red, timeout, 5xx de proxy): abre el episodio. */
export function reportBackendUnavailable(): void {
  wakePromise();
  beginEpisode();
}

/**
 * Una request lleva varios segundos sin respuesta: se verifica en paralelo
 * con un health check (un solo intento; si responde rápido, no hay aviso).
 * Sin `wakePromise`: nadie espera por esto.
 */
export function reportSlowRequest(): void {
  beginEpisode();
}

/** El backend respondió (health o cualquier request): cierra el episodio y libera a quien esperaba. */
export function markBackendReachable(): void {
  if (snapshot.status === 'online') return;
  clearTimer();
  if (inFlight) {
    inFlight.abort();
    inFlight = null;
  }
  update({ ...INITIAL, status: 'online' });
  const pending = wake;
  wake = null;
  pending?.resolve();
}

/** "Reintentar ahora": cancela el temporizador pendiente y ejecuta UN intento (nunca dos en paralelo). */
export function retryBackendNow(): void {
  const { status } = snapshot;
  if (status === 'online' || status === 'idle' || status === 'offline') return;
  runAttempt();
}

/** Logout/login: cancela timers y el intento en vuelo, libera a quien esperaba y vuelve a `idle`. */
export function resetBackendAvailability(): void {
  generation += 1;
  clearTimer();
  if (inFlight) {
    inFlight.abort();
    inFlight = null;
  }
  const pending = wake;
  wake = null;
  pending?.reject(new WakeCancelledError());
  statusBeforeOffline = 'idle';
  if (snapshot !== INITIAL) update({ ...INITIAL });
}

// ── Eventos del navegador ───────────────────────────────────────────────────

function handleOffline(): void {
  clearTimer();
  const { status, since, failedAttempts } = snapshot;
  if (status === 'offline') return;
  statusBeforeOffline = status === 'online' ? 'online' : 'idle';
  // El intento en vuelo, si hay, termina solo y encuentra el estado `offline`.
  update({
    status: 'offline',
    since: status === 'online' || status === 'idle' ? Date.now() : since,
    failedAttempts,
    nextAttemptAt: null,
    pausedHidden: false,
  });
}

function handleOnline(): void {
  if (snapshot.status !== 'offline') return;
  if (!wake) {
    // Solo se había cortado Internet, sin ninguna request esperando: TanStack
    // Query revalida lo visible al reconectar (`refetchOnReconnect`); si el
    // backend no responde, esa request abrirá un episodio. Nunca se afirma
    // `online` sin haberlo comprobado antes del corte.
    update({ ...INITIAL, status: statusBeforeOffline });
    return;
  }
  update({ status: snapshot.failedAttempts > 0 ? 'waking' : 'checking' });
  runAttempt();
}

function handleVisibilityChange(): void {
  if (isHidden()) {
    if (timer !== null) {
      clearTimer();
      update({ nextAttemptAt: null, pausedHidden: true });
    }
    return;
  }
  if (snapshot.pausedHidden) runAttempt();
}

let monitors = 0;

/**
 * Escucha `online`/`offline`/`visibilitychange` mientras haya al menos un
 * monitor montado (`ConnectionStatusProvider`). Contado por referencia: el
 * doble montaje de StrictMode no duplica ni pierde listeners.
 */
export function startConnectivityMonitoring(): () => void {
  monitors += 1;
  if (monitors === 1) {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (isBrowserOffline() && (snapshot.status === 'online' || snapshot.status === 'idle')) {
      handleOffline();
    }
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    monitors -= 1;
    if (monitors === 0) {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  };
}
