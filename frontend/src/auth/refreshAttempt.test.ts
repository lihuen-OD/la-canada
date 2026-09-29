import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccessToken, getAccessToken, setAccessToken } from './accessTokenStore';
import { REFRESH_ATTEMPT_TTL_MS, clearRefreshAttempt, peekRefreshAttempt } from './refreshAttempt';
import { requestRefresh, retryUncertainRefresh } from './refreshCoordinator';
import { getRefreshRecovery } from './refreshRecovery';

/**
 * Etapa 5R — el intento de refresh: lo único que el frontend persiste. Se
 * simula la red (`fetch`) y se inspeccionan los bodies enviados y el
 * `localStorage` real de jsdom.
 */
const STORAGE_KEY = 'lc.refresh-attempt.v1';
type Reply = 'network' | { status: number; body: unknown };

let replies: Reply[] = [];
let bodies: Array<{ path: string; body: unknown }> = [];

beforeEach(() => {
  replies = [];
  bodies = [];
  localStorage.clear();
  clearRefreshAttempt();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const path = String(input).replace('/api/v1', '');
      bodies.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const next = replies.shift() ?? {
        status: 200,
        body: { accessToken: 'nuevo', expiresIn: 900 },
      };
      if (next === 'network') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(Response.json(next.body, { status: next.status }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearAccessToken();
  localStorage.clear();
});

/** Página nueva (recarga u otra pestaña): módulos nuevos, mismo localStorage, backend ya comprobado. */
async function freshTab() {
  vi.resetModules();
  const availability = await import('../connectivity/backendAvailability');
  availability.markBackendReachable();
  return import('./refreshCoordinator');
}

const sentAttempts = () =>
  bodies
    .filter((b) => b.path === '/auth/refresh')
    .map((b) => (b.body as { attemptId: string }).attemptId);

describe('intento de refresh persistido', () => {
  it('se guarda ANTES de enviar y solo contiene { id, startedAt }: ningún token', async () => {
    let storedDuringRequest: string | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        storedDuringRequest = localStorage.getItem(STORAGE_KEY);
        return Promise.resolve(Response.json({ accessToken: 'secreto-access', expiresIn: 900 }));
      }),
    );
    await requestRefresh();

    const stored = JSON.parse(storedDuringRequest!) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['id', 'startedAt']);
    expect(stored.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(storedDuringRequest).not.toContain('secreto-access');
    // Resultado conocido: se borra.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getAccessToken()).toBe('secreto-access');
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it('respuesta perdida: el intento queda guardado y el reintento manual reenvía el MISMO', async () => {
    replies = ['network'];
    await requestRefresh().catch(() => undefined);
    expect(getRefreshRecovery()).toBe('uncertain');
    const pending = peekRefreshAttempt();
    expect(pending).not.toBeNull();

    // Nunca automático: un refresh disparado por un 401 no toca la red.
    await requestRefresh().catch(() => undefined);
    expect(sentAttempts()).toHaveLength(1);

    await retryUncertainRefresh();
    expect(sentAttempts()).toEqual([pending, pending]);
    expect(peekRefreshAttempt()).toBeNull();
  });

  it('recarga después de una respuesta perdida: la página nueva reenvía el mismo intento', async () => {
    replies = ['network'];
    await requestRefresh().catch(() => undefined);
    const pending = peekRefreshAttempt();

    const fresh = await freshTab();
    await fresh.requestRefresh();
    expect(sentAttempts()).toEqual([pending, pending]);
  });

  it('recarga con el pedido en vuelo (antes de saber el resultado): el intento ya estaba guardado', async () => {
    let releaseFirst!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (releaseFirst = resolve))),
    );
    const first = requestRefresh().catch(() => undefined);
    await Promise.resolve();
    const pending = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as { id: string };

    vi.stubGlobal(
      'fetch',
      vi.fn((_: string, init?: RequestInit) => {
        bodies.push({ path: '/auth/refresh', body: JSON.parse(String(init?.body)) });
        return Promise.resolve(Response.json({ accessToken: 'ok', expiresIn: 900 }));
      }),
    );
    const fresh = await freshTab();
    await fresh.requestRefresh();
    expect(sentAttempts()).toEqual([pending.id]);
    // La pestaña vieja ya no existe; se libera su pedido para no dejarlo colgado.
    releaseFirst(new Response(null, { status: 499 }));
    await first;
  });

  it('dos pestañas que restauran a la vez comparten el intento (mismo localStorage)', async () => {
    replies = ['network'];
    await requestRefresh().catch(() => undefined);
    const pending = peekRefreshAttempt();
    const tabA = await freshTab();
    const tabB = await freshTab();
    await Promise.all([tabA.requestRefresh(), tabB.requestRefresh()]);
    expect(sentAttempts().slice(1)).toEqual([pending, pending]);
  });

  it('llamadas simultáneas en la misma pestaña: un solo POST (single-flight)', async () => {
    await Promise.all([requestRefresh(), requestRefresh(), requestRefresh()]);
    expect(sentAttempts()).toHaveLength(1);
  });

  it('un 401 es definitivo: borra el intento (la próxima sesión arranca con uno nuevo)', async () => {
    replies = [{ status: 401, body: { error: { message: 'x', code: 'AUTH_SESSION_INVALID' } } }];
    await requestRefresh().catch(() => undefined);
    expect(peekRefreshAttempt()).toBeNull();
    expect(getRefreshRecovery()).toBe('none');
  });

  it('503 AUTH_REFRESH_UNAVAILABLE: no rotó nada, sin duda; el siguiente intento es seguro', async () => {
    replies = [
      { status: 503, body: { error: { message: 'x', code: 'AUTH_REFRESH_UNAVAILABLE' } } },
    ];
    await requestRefresh().catch(() => undefined);
    expect(getRefreshRecovery()).toBe('none');
    await requestRefresh();
    expect(sentAttempts()).toHaveLength(2);
    expect(peekRefreshAttempt()).toBeNull();
  });

  it('un intento vencido (más de 24 h) se descarta y se crea otro', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        id: 'intento-viejo-000000000000',
        startedAt: Date.now() - REFRESH_ATTEMPT_TTL_MS - 1,
      }),
    );
    await requestRefresh();
    expect(sentAttempts()[0]).not.toBe('intento-viejo-000000000000');
  });

  it('un valor corrupto en storage se ignora sin romper', async () => {
    localStorage.setItem(STORAGE_KEY, '{no es json');
    await expect(requestRefresh()).resolves.toBe('nuevo');
  });

  it('storage bloqueado: funciona con un intento en memoria', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    replies = ['network'];
    await requestRefresh().catch(() => undefined);
    const pending = peekRefreshAttempt();
    expect(pending).not.toBeNull();
    await retryUncertainRefresh();
    expect(sentAttempts()).toEqual([pending, pending]);
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('el token de acceso nunca llega al storage en ningún momento del flujo', async () => {
    setAccessToken('token-previo');
    replies = ['network'];
    await requestRefresh().catch(() => undefined);
    await retryUncertainRefresh();
    const dump = JSON.stringify({ ...localStorage });
    expect(dump).not.toMatch(/token|nuevo/);
  });
});
