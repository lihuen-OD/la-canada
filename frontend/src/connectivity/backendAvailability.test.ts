import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HEALTH_TIMEOUT_MS,
  LONG_WAIT_MS,
  WakeCancelledError,
  backoffDelay,
  ensureBackendAwake,
  getBackendAvailability,
  markBackendReachable,
  reportBackendUnavailable,
  reportSlowRequest,
  resetBackendAvailability,
  retryBackendNow,
  startConnectivityMonitoring,
} from './backendAvailability';

/**
 * Etapa 5R — coordinador único de disponibilidad. `fetch` simulado: cada
 * health check responde según `healthReplies` (503 = Render despertando).
 */
let healthCalls = 0;
let healthReplies: Array<number | 'network' | 'hang'> = [];
let stopMonitoring: (() => void) | null = null;

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  healthCalls = 0;
  healthReplies = [];
  resetBackendAvailability();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      expect(input).toBe('/api/v1/health');
      expect(init?.credentials).toBe('omit');
      healthCalls += 1;
      const reply = healthReplies.shift() ?? 200;
      if (reply === 'network') return Promise.reject(new TypeError('Failed to fetch'));
      if (reply === 'hang') {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      }
      return Promise.resolve(
        new Response(reply === 200 ? '{"status":"ok"}' : '', { status: reply }),
      );
    }),
  );
  stopMonitoring = startConnectivityMonitoring();
});

afterEach(() => {
  stopMonitoring?.();
  resetBackendAvailability();
  setOnline(true);
  setVisibility('visible');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('backoff', () => {
  it('2 s, 4 s, 8 s y luego 10 s como máximo, con jitter chico que nunca supera el tope', () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffDelay)).toEqual([2000, 4000, 8000, 10000, 10000, 10000]);
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    expect(backoffDelay(1)).toBeGreaterThan(2000);
    expect(backoffDelay(1)).toBeLessThanOrEqual(2400);
    expect(backoffDelay(6)).toBe(10000);
  });
});

describe('coordinador de disponibilidad del backend', () => {
  it('online: resuelve al instante y sin ningún request (navegar no genera health checks)', async () => {
    markBackendReachable();
    await ensureBackendAwake();
    await ensureBackendAwake();
    expect(healthCalls).toBe(0);
  });

  it('un único health check en vuelo aunque lo pidan muchos a la vez', async () => {
    healthReplies = ['hang'];
    const waits = [ensureBackendAwake(), ensureBackendAwake(), ensureBackendAwake()];
    reportBackendUnavailable();
    reportBackendUnavailable();
    reportSlowRequest();
    expect(healthCalls).toBe(1);
    expect(getBackendAvailability().status).toBe('checking');

    markBackendReachable();
    await Promise.all(waits);
    expect(getBackendAvailability().status).toBe('online');
  });

  it('503 varias veces y luego 200: reintenta con backoff y libera a todos los que esperaban', async () => {
    healthReplies = [503, 503, 503, 200];
    const done = vi.fn();
    void ensureBackendAwake().then(done);
    void ensureBackendAwake().then(done);

    await vi.advanceTimersByTimeAsync(0);
    expect(healthCalls).toBe(1);
    expect(getBackendAvailability().status).toBe('waking');
    expect(getBackendAvailability().nextAttemptAt).toBe(Date.now() + 2000);

    await vi.advanceTimersByTimeAsync(2000);
    expect(healthCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(healthCalls).toBe(3);
    await vi.advanceTimersByTimeAsync(8000);
    expect(healthCalls).toBe(4);
    expect(getBackendAvailability().status).toBe('online');
    expect(done).toHaveBeenCalledTimes(2);
  });

  it('un health que no responde se aborta por timeout y cuenta como intento fallido', async () => {
    healthReplies = ['hang', 200];
    const awake = ensureBackendAwake();
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS);
    expect(getBackendAvailability().status).toBe('waking');
    await vi.advanceTimersByTimeAsync(2000);
    await awake;
    expect(healthCalls).toBe(2);
  });

  it('un error de red también es un intento fallido (nunca rechaza a quien espera)', async () => {
    healthReplies = ['network', 200];
    const awake = ensureBackendAwake();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(awake).resolves.toBeUndefined();
  });

  it('pasado un minuto sin respuesta queda `degraded` (espera prolongada), y sigue intentando', async () => {
    healthReplies = Array.from({ length: 20 }, () => 503);
    void ensureBackendAwake();
    await vi.advanceTimersByTimeAsync(LONG_WAIT_MS + 10_000);
    expect(getBackendAvailability().status).toBe('degraded');
    const before = healthCalls;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(healthCalls).toBe(before + 1);
  });

  it('"Reintentar ahora" cancela el temporizador pendiente y ejecuta UN solo intento', async () => {
    healthReplies = [503, 503, 200];
    void ensureBackendAwake();
    await vi.advanceTimersByTimeAsync(0);
    expect(healthCalls).toBe(1);

    retryBackendNow();
    retryBackendNow(); // ya hay uno en vuelo: no se duplica
    expect(healthCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    // El timer anterior (2 s) se canceló: no hay un intento extra.
    await vi.advanceTimersByTimeAsync(1999);
    expect(healthCalls).toBe(2);
  });

  it('sin Internet no hay sondeo; al volver la conexión reanuda con un intento', async () => {
    healthReplies = [503, 200];
    void ensureBackendAwake();
    await vi.advanceTimersByTimeAsync(0);
    setOnline(false);
    expect(getBackendAvailability().status).toBe('offline');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(healthCalls).toBe(1);

    setOnline(true);
    expect(healthCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(getBackendAvailability().status).toBe('online');
  });

  it('arrancar sin Internet no dispara ningún health hasta el evento online', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    const awake = ensureBackendAwake();
    expect(getBackendAvailability().status).toBe('offline');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(healthCalls).toBe(0);
    setOnline(true);
    await awake;
    expect(healthCalls).toBe(1);
  });

  it('corte de Internet sin nada esperando: al volver no se afirma online sin haberlo comprobado antes', () => {
    setOnline(false);
    expect(getBackendAvailability().status).toBe('offline');
    setOnline(true);
    expect(getBackendAvailability().status).toBe('idle');
    expect(healthCalls).toBe(0);

    markBackendReachable();
    setOnline(false);
    setOnline(true);
    expect(getBackendAvailability().status).toBe('online');
    expect(healthCalls).toBe(0);
  });

  it('pestaña oculta: pausa los reintentos; al volver a verse, reanuda con un intento', async () => {
    healthReplies = [503, 200];
    void ensureBackendAwake();
    await vi.advanceTimersByTimeAsync(0);
    setVisibility('hidden');
    expect(getBackendAvailability().pausedHidden).toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(healthCalls).toBe(1);

    setVisibility('visible');
    expect(healthCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(getBackendAvailability().status).toBe('online');
  });

  it('un intento que falla con la pestaña oculta no programa otro', async () => {
    healthReplies = ['hang'];
    void ensureBackendAwake();
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS);
    expect(getBackendAvailability().pausedHidden).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(healthCalls).toBe(1);
  });

  it('reset (logout/login): cancela timers, aborta el intento en vuelo y rechaza a quien esperaba', async () => {
    healthReplies = [503];
    const awake = ensureBackendAwake();
    await vi.advanceTimersByTimeAsync(0);
    resetBackendAvailability();
    await expect(awake).rejects.toBeInstanceOf(WakeCancelledError);
    expect(getBackendAvailability().status).toBe('idle');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(healthCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('una respuesta de cualquier request cierra el episodio sin esperar al próximo intento', async () => {
    healthReplies = [503];
    const awake = ensureBackendAwake();
    await vi.advanceTimersByTimeAsync(0);
    markBackendReachable();
    await awake;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un 429 del health prueba que el proceso responde: cuenta como despierto', async () => {
    healthReplies = [429];
    await ensureBackendAwake();
    expect(getBackendAvailability().status).toBe('online');
  });

  it('no persiste nada en storage', async () => {
    healthReplies = [503, 200];
    const awake = ensureBackendAwake();
    await vi.advanceTimersByTimeAsync(2000);
    await awake;
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
