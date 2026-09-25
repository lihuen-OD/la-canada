import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, createTestQueryClient, render, renderHook, screen, waitFor } from '../test/render';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMeMock, loginMock, logoutSessionMock, refreshSessionMock } = vi.hoisted(() => ({
  fetchMeMock: vi.fn(),
  loginMock: vi.fn(),
  logoutSessionMock: vi.fn(),
  refreshSessionMock: vi.fn(),
}));

vi.mock('../api/authApi', () => ({
  fetchMe: fetchMeMock,
  login: loginMock,
  logoutSession: logoutSessionMock,
  refreshSession: refreshSessionMock,
}));

import { ApiError } from '../api/httpClient';
import { AuthProvider } from './AuthProvider';
import { clearAccessToken, getAccessToken } from './accessTokenStore';
import { useAuth } from './useAuth';

const USER = { id: 'user-1', role: 'EMPLOYEE' as const, status: 'ACTIVE', employee: null };

function renderAuth(queryClient: QueryClient = createTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
  return { queryClient, ...renderHook(() => useAuth(), { wrapper }) };
}

/**
 * `refreshCoordinator` guarda su `inFlight` a nivel de módulo (a propósito
 * — ver ese archivo). Un test que deja una promesa de refresh sin resolver
 * la dejaría "pegada" para todos los tests siguientes de este archivo — por
 * eso cualquier promesa creada a mano acá siempre se asienta (resuelve o
 * rechaza) antes de terminar el test.
 */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('AuthProvider — restauración de sesión (bootstrap)', () => {
  beforeEach(() => {
    fetchMeMock.mockReset();
    loginMock.mockReset();
    logoutSessionMock.mockReset();
    refreshSessionMock.mockReset();
  });

  afterEach(() => {
    clearAccessToken();
  });

  it('empieza en bootstrapping', async () => {
    const pending = deferred<{ accessToken: string; expiresIn: number }>();
    refreshSessionMock.mockReturnValue(pending.promise);

    const { result } = renderAuth();
    expect(result.current.status).toBe('bootstrapping');

    pending.reject(new Error('cierre del test — nunca se lee'));
    await pending.promise.catch(() => undefined);
  });

  it('refresh + /me exitosos -> authenticated, con el usuario real', async () => {
    refreshSessionMock.mockResolvedValue({ accessToken: 'token-1', expiresIn: 720 });
    fetchMeMock.mockResolvedValue({ user: USER });

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    expect(result.current.user).toEqual(USER);
    expect(getAccessToken()).toBe('token-1');
  });

  it('refresh rechazado con sesión inexistente/vencida (ApiError) -> anonymous, sin error técnico', async () => {
    refreshSessionMock.mockRejectedValue(
      new ApiError(401, 'Autenticación requerida.', 'AUTH_REQUIRED'),
    );

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(result.current.user).toBeNull();
  });

  it('refresh rechazado por un error de red -> sessionError, y retryBootstrap reintenta de verdad', async () => {
    refreshSessionMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.status).toBe('sessionError'));

    refreshSessionMock.mockResolvedValueOnce({ accessToken: 'token-2', expiresIn: 720 });
    fetchMeMock.mockResolvedValueOnce({ user: USER });

    act(() => {
      result.current.retryBootstrap();
    });

    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(refreshSessionMock).toHaveBeenCalledTimes(2);
  });

  it('React StrictMode (doble montaje de efectos) nunca dispara dos refresh reales', async () => {
    refreshSessionMock.mockResolvedValue({ accessToken: 'token-1', expiresIn: 720 });
    fetchMeMock.mockResolvedValue({ user: USER });

    function Probe() {
      const { status } = useAuth();
      return <span data-testid="status">{status}</span>;
    }

    render(
      <StrictMode>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    // Etapa 5P: la restauración completa es single-flight — tampoco duplica `/auth/me`.
    expect(fetchMeMock).toHaveBeenCalledTimes(1);
  });
});

describe('AuthProvider — login', () => {
  beforeEach(() => {
    fetchMeMock.mockReset();
    loginMock.mockReset();
    logoutSessionMock.mockReset();
    refreshSessionMock.mockReset();
    refreshSessionMock.mockRejectedValue(
      new ApiError(401, 'Autenticación requerida.', 'AUTH_REQUIRED'),
    );
  });

  afterEach(() => {
    clearAccessToken();
  });

  it('login exitoso pasa a authenticated y guarda el access token en memoria', async () => {
    loginMock.mockResolvedValue({ accessToken: 'token-login', expiresIn: 720, user: USER });

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.status).toBe('anonymous'));

    await act(async () => {
      await result.current.login(USER.id, '4821');
    });

    expect(result.current.status).toBe('authenticated');
    expect(result.current.user).toEqual(USER);
    expect(getAccessToken()).toBe('token-login');
  });

  it('login rechazado (credenciales inválidas) vuelve a anonymous y relanza el error para la UI', async () => {
    const loginError = new ApiError(
      401,
      'Identidad o PIN incorrectos.',
      'AUTH_INVALID_CREDENTIALS',
    );
    loginMock.mockRejectedValue(loginError);

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.status).toBe('anonymous'));

    await expect(
      act(async () => {
        await result.current.login(USER.id, '0000');
      }),
    ).rejects.toThrow('Identidad o PIN incorrectos.');

    expect(result.current.status).toBe('anonymous');
    expect(getAccessToken()).toBeNull();
  });

  it('hasRole refleja el rol real del usuario autenticado, nunca antes del login', async () => {
    loginMock.mockResolvedValue({
      accessToken: 'token-login',
      expiresIn: 720,
      user: { ...USER, role: 'ADMIN' as const },
    });

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(result.current.hasRole('ADMIN')).toBe(false);

    await act(async () => {
      await result.current.login(USER.id, '4821');
    });

    expect(result.current.hasRole('ADMIN')).toBe(true);
    expect(result.current.hasRole('EMPLOYEE')).toBe(false);
  });
});

describe('AuthProvider — logout', () => {
  beforeEach(() => {
    fetchMeMock.mockReset();
    loginMock.mockReset();
    logoutSessionMock.mockReset();
    refreshSessionMock.mockReset();
  });

  afterEach(() => {
    clearAccessToken();
  });

  async function renderAlreadyLoggedIn(queryClient?: QueryClient) {
    // Configurado ANTES de montar: el efecto de bootstrap dispara su propio
    // `requestRefresh()` apenas se monta el provider — si el mock se
    // configura después del render, el bootstrap ya corrió contra un mock
    // sin comportamiento definido.
    refreshSessionMock.mockRejectedValue(
      new ApiError(401, 'Autenticación requerida.', 'AUTH_REQUIRED'),
    );
    loginMock.mockResolvedValue({ accessToken: 'token-login', expiresIn: 720, user: USER });

    const rendered = renderAuth(queryClient);
    await waitFor(() => expect(rendered.result.current.status).toBe('anonymous'));
    await act(async () => {
      await rendered.result.current.login(USER.id, '4821');
    });
    return rendered;
  }

  it('logout limpia el estado y el token aunque el request de red falle', async () => {
    const { result } = await renderAlreadyLoggedIn();

    logoutSessionMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.status).toBe('anonymous');
    expect(result.current.user).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it('un refresh tardío que resuelve después del logout no vuelve a autenticar', async () => {
    const { result } = await renderAlreadyLoggedIn();

    // Refresh en vuelo (por ejemplo, disparado por un 401 casi simultáneo)
    // que todavía no resolvió cuando el logout se aplica.
    let resolveLateRefresh!: (value: { accessToken: string; expiresIn: number }) => void;
    refreshSessionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveLateRefresh = resolve;
      }),
    );
    const { requestRefresh } = await import('./refreshCoordinator');
    const lateRefresh = requestRefresh();
    const lateRejection = expect(lateRefresh).rejects.toThrow();

    logoutSessionMock.mockResolvedValue(undefined);
    let logoutDone!: Promise<void>;
    act(() => {
      logoutDone = result.current.logout();
    });
    // La sesión local ya se cerró, sin esperar a la red.
    expect(result.current.status).toBe('anonymous');
    expect(getAccessToken()).toBeNull();
    // El logout del servidor espera al refresh en vuelo: así envía la cookie
    // más reciente (la que ese refresh pudo haber rotado) y la revoca.
    expect(logoutSessionMock).not.toHaveBeenCalled();

    resolveLateRefresh({ accessToken: 'token-tardio', expiresIn: 720 });
    await lateRejection;
    await act(async () => {
      await logoutDone;
    });

    expect(logoutSessionMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('anonymous');
    expect(getAccessToken()).toBeNull();
  });

  it('logout vacía toda la caché de datos, aunque la red falle', async () => {
    const queryClient = createTestQueryClient();
    const { result } = await renderAlreadyLoggedIn(queryClient);
    queryClient.setQueryData(['session', USER.id, 'tasks', 'list', 'active'], { tasks: [] });
    queryClient.setQueryData(['session', USER.id, 'stock', 'categories', 'all'], {
      categories: [],
    });
    logoutSessionMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await act(async () => {
      await result.current.logout();
    });

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(result.current.status).toBe('anonymous');
  });

  it('un login nuevo nunca hereda la caché de la sesión anterior', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['session', 'otra-persona', 'tasks', 'list', 'active'], {
      tasks: [],
    });
    await renderAlreadyLoggedIn(queryClient);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('un 5xx al restaurar la sesión no la descarta: queda reintentable (sessionError)', async () => {
    refreshSessionMock.mockRejectedValue(
      new ApiError(503, 'No pudimos renovar la sesión.', 'AUTH_REFRESH_UNAVAILABLE'),
    );
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.status).toBe('sessionError'));
  });
});
