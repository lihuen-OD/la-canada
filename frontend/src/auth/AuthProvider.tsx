import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { PropsWithChildren } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchMe, login as loginRequest, logoutSession } from '../api/authApi';
import { ApiError } from '../api/httpClient';
import type { AuthenticatedUser, SystemRole } from '../api/types';
import { AuthContext, type AuthContextValue } from './authContext';
import { clearAccessToken, setAccessToken } from './accessTokenStore';
import { requestRefresh, settleInFlightRefresh } from './refreshCoordinator';

interface AuthState {
  status: AuthContextValue['status'];
  user: AuthenticatedUser | null;
}

type AuthAction =
  | { type: 'BOOTSTRAP_AUTHENTICATED'; user: AuthenticatedUser }
  | { type: 'BOOTSTRAP_ANONYMOUS' }
  | { type: 'BOOTSTRAP_ERROR' }
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; user: AuthenticatedUser }
  | { type: 'LOGIN_FAILURE' }
  | { type: 'LOGGED_OUT' };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'BOOTSTRAP_AUTHENTICATED':
      return { status: 'authenticated', user: action.user };
    case 'BOOTSTRAP_ANONYMOUS':
      return { status: 'anonymous', user: null };
    case 'BOOTSTRAP_ERROR':
      return { status: 'sessionError', user: null };
    case 'LOGIN_START':
      return { status: 'authenticating', user: null };
    case 'LOGIN_SUCCESS':
      return { status: 'authenticated', user: action.user };
    case 'LOGIN_FAILURE':
      return { status: 'anonymous', user: null };
    case 'LOGGED_OUT':
      return { status: 'anonymous', user: null };
    default:
      return state;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(authReducer, { status: 'bootstrapping', user: null });
  // Contador de intentos de bootstrap — cambiarlo re-dispara el efecto de
  // restauración (única forma de "reintentar" expuesta al exterior).
  const [bootstrapAttempt, retryBootstrapAttempt] = useReducer((count: number) => count + 1, 0);
  const queryClient = useQueryClient();

  /**
   * Vacía la caché de datos (Etapa 5P): cancela primero lo que esté en vuelo
   * para que ninguna respuesta tardía repueble la caché de una sesión que ya
   * terminó. Síncrono en efecto: `cancelQueries` marca las queries como
   * canceladas antes de que `clear` las elimine.
   */
  const clearSessionData = useCallback(() => {
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient]);

  /**
   * Restauración single-flight POR INTENTO (Etapa 5P): StrictMode ejecuta el
   * efecto dos veces en desarrollo, y aunque el refresh ya era compartido,
   * cada ejecución pedía su propio `/auth/me`. El ref sobrevive al doble
   * montaje: ambas ejecuciones esperan la MISMA restauración (un refresh y un
   * `/me`); solo un reintento explícito (`retryBootstrap`) inicia otra.
   */
  const restoreRef = useRef<{ attempt: number; promise: Promise<AuthenticatedUser> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (restoreRef.current?.attempt !== bootstrapAttempt) {
      restoreRef.current = {
        attempt: bootstrapAttempt,
        promise: requestRefresh().then(async () => (await fetchMe()).user),
      };
    }
    const restore = restoreRef.current.promise;

    async function bootstrap(): Promise<void> {
      try {
        const user = await restore;
        if (!cancelled) {
          dispatch({ type: 'BOOTSTRAP_AUTHENTICATED', user });
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status < 500) {
          // Sesión inexistente o vencida — estado normal, no un error
          // técnico: no había nadie logueado (o dejó de estarlo), punto.
          dispatch({ type: 'BOOTSTRAP_ANONYMOUS' });
        } else {
          // Falla de red/conectividad, o 5xx del backend (p. ej. el 503
          // reintentable de refresh, Etapa 5P) — recuperable: se ofrece
          // reintentar sin descartar una sesión que puede seguir siendo válida.
          dispatch({ type: 'BOOTSTRAP_ERROR' });
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [bootstrapAttempt]);

  const login = useCallback(
    async (userId: string, pin: string): Promise<void> => {
      dispatch({ type: 'LOGIN_START' });
      try {
        const result = await loginRequest({ userId, pin });
        // Nunca se hereda caché de una sesión anterior (otra persona u otra cuenta).
        clearSessionData();
        setAccessToken(result.accessToken);
        dispatch({ type: 'LOGIN_SUCCESS', user: result.user });
      } catch (error) {
        dispatch({ type: 'LOGIN_FAILURE' });
        throw error;
      }
    },
    [clearSessionData],
  );

  const logout = useCallback(async (): Promise<void> => {
    // Primero el estado local (Etapa 5P): se desmonta la vista protegida, se
    // descarta el token (la nueva época invalida cualquier refresh tardío) y
    // se vacía la caché — aunque la red falle o tarde, nada de la sesión
    // queda visible ni puede repoblarse.
    dispatch({ type: 'LOGGED_OUT' });
    clearAccessToken();
    clearSessionData();
    try {
      await settleInFlightRefresh();
      await logoutSession();
    } catch {
      // Best-effort: el estado local ya quedó limpio aunque falle la red —
      // ver la regla de logout en docs/ARCHITECTURE.md.
    }
  }, [clearSessionData]);

  const retryBootstrap = useCallback((): void => {
    retryBootstrapAttempt();
  }, []);

  const hasRole = useCallback(
    (role: SystemRole): boolean => state.user?.role === role,
    [state.user],
  );

  const value: AuthContextValue = {
    status: state.status,
    user: state.user,
    login,
    logout,
    retryBootstrap,
    hasRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
