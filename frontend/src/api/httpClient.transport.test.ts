import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError, GET_TIMEOUT_MS } from './httpClient';
import {
  classifyError,
  isTemporaryUnavailability,
  userMessageForError,
} from './errorClassification';
import { BackendUnavailableError, NetworkError, RequestTimeoutError } from './transportErrors';
import { clearAccessToken, getAccessToken, setAccessToken } from '../auth/accessTokenStore';
import { requestRefresh } from '../auth/refreshCoordinator';
import { RefreshUncertainError, getRefreshRecovery } from '../auth/refreshRecovery';
import {
  getBackendAvailability,
  resetBackendAvailability,
} from '../connectivity/backendAvailability';

/**
 * Etapa 5R — cliente HTTP ante un backend que no responde. `fetch` simulado
 * por ruta: `routes[path]` es una cola de respuestas (la última se repite).
 * Cuenta cada request para probar que nada se duplica ni se repite solo.
 */
type Reply = number | 'network' | 'hang' | { status: number; body: unknown };

let calls: string[] = [];
let routes: Record<string, Reply[]> = {};

function reply(r: Reply, init?: RequestInit): Promise<Response> {
  if (r === 'network') return Promise.reject(new TypeError('Failed to fetch'));
  if (r === 'hang') {
    return new Promise((_, reject) =>
      init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))),
    );
  }
  if (typeof r === 'number') {
    // Sin cuerpo JSON del backend: lo que devuelve un proxy (Render, Netlify, Vite).
    return Promise.resolve(new Response(r < 400 ? '{}' : '<html>Proxy</html>', { status: r }));
  }
  return Promise.resolve(Response.json(r.body, { status: r.status }));
}

const count = (path: string) => calls.filter((call) => call.endsWith(` ${path}`)).length;

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const path = String(input).replace('/api/v1', '');
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      const queue = routes[path] ?? [200];
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      return reply(next, init);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearAccessToken();
});

describe('clasificación de errores', () => {
  it.each([
    [new ApiError(401, 'x', 'AUTH_REQUIRED'), 'authentication'],
    [new ApiError(403, 'x', 'AUTH_FORBIDDEN'), 'authorization'],
    [new ApiError(400, 'x', 'VALIDATION_ERROR'), 'validation'],
    [new ApiError(409, 'x', 'TASK_DUPLICATE'), 'validation'],
    [new ApiError(429, 'x', 'RATE_LIMITED'), 'rateLimit'],
    [new ApiError(500, 'x', undefined), 'server'],
    [new ApiError(503, 'x', 'AUTH_REFRESH_UNAVAILABLE'), 'server'],
    [new BackendUnavailableError(503), 'backendUnavailable'],
    [new NetworkError(), 'network'],
    [new RequestTimeoutError(), 'timeout'],
    [new RefreshUncertainError(), 'sessionUncertain'],
    [new Error('otra cosa'), 'unexpected'],
  ])('%s → %s', (error, kind) => {
    expect(classifyError(error)).toBe(kind);
  });

  it('403 y 429 nunca se tratan como backend dormido', () => {
    expect(isTemporaryUnavailability(new ApiError(403, 'x', undefined))).toBe(false);
    expect(isTemporaryUnavailability(new ApiError(429, 'x', undefined))).toBe(false);
  });

  it('los mensajes visibles nunca muestran códigos técnicos', () => {
    for (const error of [
      new BackendUnavailableError(502),
      new NetworkError(),
      new RequestTimeoutError(),
      new ApiError(500, 'Ocurrió un error inesperado. Intentá nuevamente.', undefined),
      new RefreshUncertainError(),
    ]) {
      expect(userMessageForError(error)).not.toMatch(/\b\d{3}\b|fetch|gateway|abort|error:/i);
    }
    expect(userMessageForError(new ApiError(429, 'Esperá unos minutos.', 'RATE_LIMITED'))).toBe(
      'Esperá unos minutos.',
    );
  });
});

describe('GET: espera el despertar compartido y reintenta una sola vez', () => {
  it.each([502, 503, 504])(
    '%i de proxy → inicia la recuperación y reintenta al despertar',
    async (status) => {
      routes['/tasks'] = [status, { status: 200, body: { tasks: ['ok'] } }];
      routes['/health'] = [200];

      await expect(apiRequest('/tasks')).resolves.toEqual({ tasks: ['ok'] });
      expect(count('/health')).toBe(1);
      expect(count('/tasks')).toBe(2);
      expect(getBackendAvailability().status).toBe('online');
    },
  );

  it('un error de red inicia la recuperación', async () => {
    routes['/tasks'] = ['network', { status: 200, body: { ok: true } }];
    await expect(apiRequest('/tasks')).resolves.toEqual({ ok: true });
    expect(count('/health')).toBe(1);
  });

  it('un timeout de lectura inicia la recuperación', async () => {
    vi.useFakeTimers();
    routes['/tasks'] = ['hang', { status: 200, body: { ok: true } }];
    const result = apiRequest('/tasks');
    await vi.advanceTimersByTimeAsync(GET_TIMEOUT_MS);
    await expect(result).resolves.toEqual({ ok: true });
    expect(count('/tasks')).toBe(2);
    // Uno por la sonda de request lenta (a los 4 s) y otro tras el timeout.
    expect(count('/health')).toBe(2);
  });

  it('nunca más de un reintento: si vuelve a fallar, se propaga', async () => {
    routes['/tasks'] = [503];
    routes['/health'] = [200];
    const error = await apiRequest('/tasks').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackendUnavailableError);
    expect(count('/tasks')).toBe(2);
  });

  it('varios GET fallidos a la vez comparten UN solo despertar', async () => {
    vi.useFakeTimers();
    routes['/tasks'] = [503, { status: 200, body: {} }];
    routes['/stock/items'] = [503, { status: 200, body: {} }];
    routes['/dashboard'] = [503, { status: 200, body: {} }];
    routes['/health'] = [503, 503, 200];

    const all = Promise.all([
      apiRequest('/tasks'),
      apiRequest('/stock/items'),
      apiRequest('/dashboard'),
    ]);
    await vi.advanceTimersByTimeAsync(2000 + 400);
    await vi.advanceTimersByTimeAsync(4000 + 400);
    await all;
    expect(count('/health')).toBe(3);
    expect(count('/tasks') + count('/stock/items') + count('/dashboard')).toBe(6);
  });

  it('con un episodio abierto, un GET nuevo espera al backend antes de enviarse', async () => {
    vi.useFakeTimers();
    routes['/health'] = [503, 200];
    routes['/tasks'] = [503];
    routes['/news'] = [{ status: 200, body: { news: [] } }];
    void apiRequest('/tasks').catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(getBackendAvailability().status).toBe('waking');

    const news = apiRequest('/news');
    await vi.advanceTimersByTimeAsync(0);
    expect(count('/news')).toBe(0);
    await vi.advanceTimersByTimeAsync(2400);
    await expect(news).resolves.toEqual({ news: [] });
    expect(count('/news')).toBe(1);
  });

  it('403, 429, 404 y el 5xx del propio backend no inician recuperación ni se reintentan', async () => {
    routes['/a'] = [{ status: 403, body: { error: { message: 'No.', code: 'AUTH_FORBIDDEN' } } }];
    routes['/b'] = [{ status: 429, body: { error: { message: 'Esperá.', code: 'RATE_LIMITED' } } }];
    routes['/c'] = [{ status: 404, body: { error: { message: 'No está.' } } }];
    routes['/d'] = [{ status: 500, body: { error: { message: 'Ocurrió un error inesperado.' } } }];
    for (const path of ['/a', '/b', '/c', '/d']) {
      const error = await apiRequest(path).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(count(path)).toBe(1);
    }
    const limited = (await apiRequest('/b').catch((e: unknown) => e)) as ApiError;
    expect(limited.message).toBe('Esperá.');
    expect(count('/health')).toBe(0);
    expect(getBackendAvailability().status).toBe('online');
  });
});

describe('POST/PATCH/DELETE: nunca se repiten', () => {
  it.each(['POST', 'PATCH', 'DELETE'] as const)(
    '%s con 503 de proxy: un solo envío, abre la recuperación y propaga el error',
    async (method) => {
      routes['/tasks/1'] = [503, { status: 200, body: {} }];
      routes['/health'] = ['hang'];
      const error = await apiRequest('/tasks/1', { method, body: {} }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BackendUnavailableError);
      expect(count('/tasks/1')).toBe(1);
      expect(getBackendAvailability().status).toBe('checking');
    },
  );

  it('un movimiento con Idempotency-Key tampoco se reenvía solo', async () => {
    routes['/stock/items/i1/movements'] = ['network'];
    await apiRequest('/stock/items/i1/movements', {
      method: 'POST',
      body: {},
      headers: { 'Idempotency-Key': 'clave-1' },
    }).catch(() => undefined);
    expect(count('/stock/items/i1/movements')).toBe(1);
  });

  it('POST /auth/login con falla de red: un solo intento', async () => {
    routes['/auth/login'] = ['network'];
    const error = await apiRequest('/auth/login', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(NetworkError);
    expect(count('/auth/login')).toBe(1);
  });

  it('una mutación no espera al despertar aunque haya un episodio abierto', async () => {
    resetBackendAvailability();
    routes['/health'] = ['hang'];
    void apiRequest('/x').catch(() => undefined);
    await apiRequest('/tasks', { method: 'POST', body: {} });
    expect(count('/tasks')).toBe(1);
  });
});

describe('refresh ambiguo: nunca se repite automáticamente', () => {
  it('un refresh sin respuesta queda en duda; los 401 siguientes no mandan otro refresh', async () => {
    setAccessToken('vencido');
    routes['/tasks'] = [
      { status: 401, body: { error: { message: 'x', code: 'AUTH_TOKEN_EXPIRED' } } },
    ];
    routes['/auth/refresh'] = ['network'];
    routes['/health'] = [200];

    const first = await apiRequest('/tasks', { authenticated: true }).catch((e: unknown) => e);
    expect(count('/auth/refresh')).toBe(1);
    expect(getRefreshRecovery()).toBe('uncertain');
    // El GET esperó al backend y se reintentó una vez, pero SIN un segundo refresh.
    expect(first).toBeInstanceOf(RefreshUncertainError);

    await apiRequest('/stock/items', { authenticated: true }).catch(() => undefined);
    routes['/stock/items'] = [{ status: 401, body: { error: { message: 'x' } } }];
    await apiRequest('/stock/items', { authenticated: true }).catch(() => undefined);
    await expect(requestRefresh()).rejects.toBeInstanceOf(RefreshUncertainError);
    expect(count('/auth/refresh')).toBe(1);
    // La falla no se convirtió en logout: el token local no se tocó.
    expect(getAccessToken()).toBe('vencido');
  });

  it.each([
    ['504 de proxy', 504 as Reply],
    ['500 del backend', { status: 500, body: { error: { message: 'x' } } } as Reply],
  ])('%s en el refresh también queda en duda', async (_, failure) => {
    routes['/auth/refresh'] = [failure];
    await requestRefresh().catch(() => undefined);
    expect(getRefreshRecovery()).toBe('uncertain');
  });

  it('el 503 AUTH_REFRESH_UNAVAILABLE garantiza que no rotó: no queda en duda y se puede reintentar', async () => {
    routes['/auth/refresh'] = [
      { status: 503, body: { error: { message: 'x', code: 'AUTH_REFRESH_UNAVAILABLE' } } },
      { status: 200, body: { accessToken: 'nuevo', expiresIn: 900 } },
    ];
    await requestRefresh().catch(() => undefined);
    expect(getRefreshRecovery()).toBe('none');
    await expect(requestRefresh()).resolves.toBe('nuevo');
    expect(count('/auth/refresh')).toBe(2);
  });

  it('un 401 del refresh es definitivo: no queda en duda (la pantalla vuelve al login)', async () => {
    routes['/auth/refresh'] = [
      { status: 401, body: { error: { message: 'x', code: 'AUTH_SESSION_INVALID' } } },
    ];
    await requestRefresh().catch(() => undefined);
    expect(getRefreshRecovery()).toBe('none');
  });

  it('con el backend dormido, el refresh espera al health antes de enviarse (health → refresh)', async () => {
    resetBackendAvailability();
    routes['/health'] = [200];
    routes['/auth/refresh'] = [{ status: 200, body: { accessToken: 't', expiresIn: 900 } }];
    await requestRefresh();
    expect(calls).toEqual(['GET /health', 'POST /auth/refresh']);
  });
});
