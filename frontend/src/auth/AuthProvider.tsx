import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { PropsWithChildren } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchMe, login as loginRequest, logoutSession } from '../api/authApi';
import { classifyError } from '../api/errorClassification';
import { ApiError } from '../api/httpClient';
import type { AuthenticatedUser, SystemRole } from '../api/types';
import { ensureBackendAwake, resetBackendAvailability } from '../connectivity/backendAvailability';
import { AuthContext, type AuthContextValue, type SessionIssue } from './authContext';
import { clearAccessToken, getAccessToken, setAccessToken } from './accessTokenStore';
import { OfflineError, isTransportFailure } from '../api/transportErrors';
import { clearRefreshAttempt, peekRefreshAttempt } from './refreshAttempt';
import { requestRefresh, settleInFlightRefresh } from './refreshCoordinator';
import { getRefreshRecovery, resetRefreshRecovery } from './refreshRecovery';

interface AuthState {
  status: AuthContextValue['status'];
  user: AuthenticatedUser | null;
  sessionIssue: SessionIssue | null;
}

type AuthAction =
  | { type: 'BOOTSTRAP_AUTHENTICATED'; user: AuthenticatedUser }
  | { type: 'BOOTSTRAP_ANONYMOUS' }
  | { type: 'BOOTSTRAP_ERROR'; issue: SessionIssue }
  | { type: 'BOOTSTRAP_RETRY' }
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; user: AuthenticatedUser }
  | { type: 'LOGIN_FAILURE' }
  | { type: 'LOGGED_OUT' }
  | { type: 'DISPLAY_NAME_CHANGED'; displayName: string };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'BOOTSTRAP_AUTHENTICATED':
      return { status: 'authenticated', user: action.user, sessionIssue: null };
    case 'BOOTSTRAP_ANONYMOUS':
      return { status: 'anonymous', user: null, sessionIssue: null };
    case 'BOOTSTRAP_ERROR':
      return { status: 'sessionError', user: null, sessionIssue: action.issue };
    case 'BOOTSTRAP_RETRY':
      return { status: 'bootstrapping', user: null, sessionIssue: null };
    case 'LOGIN_START':
      return { status: 'authenticating', user: null, sessionIssue: null };
    case 'LOGIN_SUCCESS':
      return { status: 'authenticated', user: action.user, sessionIssue: null };
    case 'LOGIN_FAILURE':
      return { status: 'anonymous', user: null, sessionIssue: null };
    case 'LOGGED_OUT':
      return { status: 'anonymous', user: null, sessionIssue: null };
    case 'DISPLAY_NAME_CHANGED':
      if (!state.user) return state;
      return {
        ...state,
        user: {
          ...state.user,
          displayName: action.displayName,
          employee: state.user.employee
            ? { ...state.user.employee, displayName: action.displayName }
            : null,
        },
      };
    default:
      return state;
  }
}

/**
 * Restauración en tres pasos, en este orden (Etapa 5R):
 * 1. backend despierto — `GET /health` compartido; sin request si ya está
 *    `online`. Espera lo necesario (el aviso "Preparando La Cañada" lo
 *    muestra `BootstrappingScreen`) y nunca manda al login por tardar;
 * 2. UN refresh, recién con el backend despierto — salvo que ya haya access
 *    token (un reintento después de un `/auth/me` fallido no rota de nuevo);
 * 3. `/auth/me`.
 */
async function restoreSession(): Promise<AuthenticatedUser> {
  await ensureBackendAwake();
  if (!getAccessToken()) await requestRefresh();
  return (await fetchMe()).user;
}

/** Qué hacer con un fallo de la restauración: nunca un logout por una falla temporal. */
function bootstrapOutcome(error: unknown): AuthAction | null {
  const kind = classifyError(error);
  if (kind === 'cancelled') return null;
  if (getRefreshRecovery() === 'uncertain') return { type: 'BOOTSTRAP_ERROR', issue: 'uncertain' };
  if (kind === 'rateLimit') return { type: 'BOOTSTRAP_ERROR', issue: 'rateLimited' };
  // Sesión inexistente o vencida (401) u otro rechazo definitivo del backend:
  // estado normal, no un error técnico — va al selector de ingreso.
  if (error instanceof ApiError && error.status < 500) return { type: 'BOOTSTRAP_ANONYMOUS' };
  // Red, timeout, backend no disponible o 5xx: recuperable, la sesión se conserva.
  return { type: 'BOOTSTRAP_ERROR', issue: 'temporary' };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(authReducer, {
    status: 'bootstrapping',
    user: null,
    sessionIssue: null,
  });
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
        promise: restoreSession(),
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
        const outcome = bootstrapOutcome(error);
        if (outcome) dispatch(outcome);
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
        // La cookie nueva reemplazó a cualquier refresh que hubiera quedado en duda.
        resetRefreshRecovery();
        clearRefreshAttempt();
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
    // Etapa 5R: se cancela cualquier espera del backend (timers, health en
    // vuelo, lecturas esperando) y se olvida un refresh en duda — el logout
    // siguiente borra esa cookie sin disparar la detección de reuso.
    resetBackendAvailability();
    resetRefreshRecovery();
    try {
      await settleInFlightRefresh();
      // Con un intento en duda, el backend revoca también la sucesora huérfana.
      await logoutSession(peekRefreshAttempt());
      clearRefreshAttempt();
    } catch (error) {
      // Best-effort: el estado local ya quedó limpio aunque falle la red —
      // ver la regla de logout en docs/ARCHITECTURE.md. Si el logout no llegó
      // al backend, el intento se conserva: la cookie sigue ahí y una
      // restauración posterior debe poder reenviarlo sin disparar reuso.
      if (!isTransportFailure(error) && !(error instanceof OfflineError)) clearRefreshAttempt();
    }
  }, [clearSessionData]);

  const retryBootstrap = useCallback((): void => {
    // Un refresh en duda se reintenta solo por decisión de la persona, y con
    // el MISMO intento persistido: si la rotación ya ocurrió, el backend
    // devuelve la misma sucesora (nunca dispara la detección de reuso).
    if (getRefreshRecovery() === 'uncertain') resetRefreshRecovery();
    dispatch({ type: 'BOOTSTRAP_RETRY' });
    retryBootstrapAttempt();
  }, []);

  const hasRole = useCallback(
    (role: SystemRole): boolean => state.user?.role === role,
    [state.user],
  );

  const applyDisplayName = useCallback((displayName: string): void => {
    dispatch({ type: 'DISPLAY_NAME_CHANGED', displayName });
  }, []);

  const value: AuthContextValue = {
    status: state.status,
    sessionIssue: state.sessionIssue,
    user: state.user,
    login,
    logout,
    retryBootstrap,
    hasRole,
    applyDisplayName,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
