import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestRefreshMock } = vi.hoisted(() => ({ requestRefreshMock: vi.fn() }));

vi.mock('../auth/refreshCoordinator', () => ({
  requestRefresh: requestRefreshMock,
}));

import { apiRequest, ApiError } from './httpClient';
import { clearAccessToken, setAccessToken } from '../auth/accessTokenStore';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiRequest', () => {
  beforeEach(() => {
    requestRefreshMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
  });

  it('llama a una ruta relativa bajo /api/v1, nunca a una URL absoluta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { options: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/auth/login-options');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/login-options',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('siempre manda credentials: include, incluso para requests no autenticadas', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/auth/logout', { method: 'POST' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('nunca agrega Authorization a una request no marcada como authenticated, aunque haya un token', async () => {
    setAccessToken('un-token');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { options: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/auth/login-options');

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('agrega Authorization: Bearer <token> cuando la request es authenticated y hay token', async () => {
    setAccessToken('un-token');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { user: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/auth/me', { authenticated: true });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer un-token');
  });

  it('parsea el error real del backend ({ error: { message, code } }) en un ApiError tipado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, {
        error: { message: 'Identidad o PIN incorrectos.', code: 'AUTH_INVALID_CREDENTIALS' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const error = await apiRequest('/auth/login', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).code).toBe('AUTH_INVALID_CREDENTIALS');
    expect((error as ApiError).message).toBe('Identidad o PIN incorrectos.');
  });

  it('devuelve undefined para una respuesta 204 sin cuerpo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  describe('reintento único tras 401 en requests autenticadas', () => {
    it('un 401 en una request authenticated dispara un refresh compartido y reintenta una sola vez', async () => {
      setAccessToken('token-vencido');
      requestRefreshMock.mockImplementation(async () => {
        setAccessToken('token-nuevo');
        return 'token-nuevo';
      });

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(401, {
            error: { message: 'Token de acceso vencido.', code: 'AUTH_TOKEN_EXPIRED' },
          }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { user: { id: '1' } }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await apiRequest<{ user: { id: string } }>('/auth/me', {
        authenticated: true,
      });

      expect(result).toEqual({ user: { id: '1' } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(requestRefreshMock).toHaveBeenCalledTimes(1);
      const [, secondCallOptions] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect((secondCallOptions.headers as Record<string, string>).Authorization).toBe(
        'Bearer token-nuevo',
      );
    });

    it('si el refresh también falla, se propaga el 401 original y nunca reintenta una segunda vez', async () => {
      setAccessToken('token-vencido');
      requestRefreshMock.mockRejectedValue(
        new ApiError(401, 'Sesión inválida o expirada.', 'AUTH_SESSION_INVALID'),
      );

      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse(401, {
          error: { message: 'Autenticación requerida.', code: 'AUTH_REQUIRED' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const error = await apiRequest('/auth/me', { authenticated: true }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('AUTH_REQUIRED');
      // Un solo intento real a /me — el refresh se llamó, pero no reintentó de nuevo tras fallar.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requestRefreshMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['un 503 reintentable', new ApiError(503, 'No pudimos renovar.', 'AUTH_REFRESH_UNAVAILABLE')],
      ['una falla de red', new TypeError('Failed to fetch')],
    ])(
      'si el refresh falla por %s, se propaga ESE error (no un 401 que cerraría la sesión)',
      async (_label, refreshError) => {
        setAccessToken('token-vencido');
        requestRefreshMock.mockRejectedValue(refreshError);
        const fetchMock = vi
          .fn()
          .mockResolvedValue(
            jsonResponse(401, { error: { message: 'Token vencido.', code: 'AUTH_TOKEN_EXPIRED' } }),
          );
        vi.stubGlobal('fetch', fetchMock);

        await expect(apiRequest('/tasks', { authenticated: true })).rejects.toBe(refreshError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      },
    );

    it('un POST que falla por algo distinto de 401 nunca se reenvía', async () => {
      setAccessToken('token-valido');
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse(409, {
          error: { message: 'Conflicto.', code: 'STOCK_INSUFFICIENT_QUANTITY' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        apiRequest('/stock/items/x/movements', { method: 'POST', body: {}, authenticated: true }),
      ).rejects.toBeInstanceOf(ApiError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requestRefreshMock).not.toHaveBeenCalled();
    });

    it('nunca reintenta un 401 de una request que no es authenticated (ej. login)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse(401, {
          error: { message: 'Identidad o PIN incorrectos.', code: 'AUTH_INVALID_CREDENTIALS' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(apiRequest('/auth/login', { method: 'POST', body: {} })).rejects.toBeInstanceOf(
        ApiError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requestRefreshMock).not.toHaveBeenCalled();
    });

    it('un segundo 401 tras el reintento no dispara un segundo refresh (nunca hay loop)', async () => {
      setAccessToken('token-vencido');
      requestRefreshMock.mockResolvedValue('token-nuevo-pero-igual-invalido');

      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse(401, {
          error: { message: 'Autenticación requerida.', code: 'AUTH_REQUIRED' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(apiRequest('/auth/me', { authenticated: true })).rejects.toBeInstanceOf(
        ApiError,
      );

      expect(fetchMock).toHaveBeenCalledTimes(2); // intento original + 1 reintento, nunca más
      expect(requestRefreshMock).toHaveBeenCalledTimes(1);
    });
  });
});
