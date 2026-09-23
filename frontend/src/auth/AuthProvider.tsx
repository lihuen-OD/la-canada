import { useCallback, useEffect, useReducer } from 'react';
import type { PropsWithChildren } from 'react';
import { fetchMe, login as loginRequest, logoutSession } from '../api/authApi';
import { ApiError } from '../api/httpClient';
import type { AuthenticatedUser, SystemRole } from '../api/types';
import { AuthContext, type AuthContextValue } from './authContext';
import { clearAccessToken, setAccessToken } from './accessTokenStore';
import { requestRefresh } from './refreshCoordinator';

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

  useEffect(() => {
    let cancelled = false;

    async function bootstrap(): Promise<void> {
      try {
        await requestRefresh();
        const { user } = await fetchMe();
        if (!cancelled) {
          dispatch({ type: 'BOOTSTRAP_AUTHENTICATED', user });
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError) {
          // Sesión inexistente o vencida — estado normal, no un error
          // técnico: no había nadie logueado (o dejó de estarlo), punto.
          dispatch({ type: 'BOOTSTRAP_ANONYMOUS' });
        } else {
          // Falla de red/conectividad — recuperable, se ofrece reintentar.
          dispatch({ type: 'BOOTSTRAP_ERROR' });
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [bootstrapAttempt]);

  const login = useCallback(async (userId: string, pin: string): Promise<void> => {
    dispatch({ type: 'LOGIN_START' });
    try {
      const result = await loginRequest({ userId, pin });
      setAccessToken(result.accessToken);
      dispatch({ type: 'LOGIN_SUCCESS', user: result.user });
    } catch (error) {
      dispatch({ type: 'LOGIN_FAILURE' });
      throw error;
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await logoutSession();
    } catch {
      // Best-effort: el estado local se limpia igual aunque falle la red —
      // ver la regla de logout en docs/ARCHITECTURE.md.
    } finally {
      clearAccessToken();
      dispatch({ type: 'LOGGED_OUT' });
    }
  }, []);

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
