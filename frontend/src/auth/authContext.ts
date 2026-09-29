import { createContext } from 'react';
import type { AuthenticatedUser, SystemRole } from '../api/types';

/**
 * Estados explícitos, sin booleanos sueltos que puedan contradecirse entre
 * sí (ej. `isLoading`+`isAuthenticated` a la vez). La identidad elegida en
 * el selector de login NUNCA se representa acá como si ya fuera un usuario
 * autenticado — solo existe dentro de `LoginScreen` (estado de UI local),
 * hasta que `login()` confirma contra el backend.
 */
export type AuthStatus =
  'bootstrapping' | 'anonymous' | 'authenticating' | 'authenticated' | 'sessionError';

/**
 * Por qué no se pudo restaurar la sesión (`status === 'sessionError'`, Etapa
 * 5R). Ninguno cierra la sesión solo:
 * - `temporary`: el backend falló o no respondió; reintentar es seguro;
 * - `rateLimited`: 429 del backend — se muestra su mensaje, no es "dormido";
 * - `uncertain`: un refresh enviado quedó sin respuesta y pudo haber rotado
 *   la sesión. No se reintenta solo; la persona puede reintentar (se reenvía
 *   el MISMO intento, que el backend reconoce) o volver a ingresar (ver
 *   `refreshCoordinator.ts`).
 */
export type SessionIssue = 'temporary' | 'rateLimited' | 'uncertain';

export interface AuthContextValue {
  status: AuthStatus;
  /** Solo con `status === 'sessionError'`; `null` en cualquier otro estado. */
  sessionIssue: SessionIssue | null;
  user: AuthenticatedUser | null;
  /** Lanza (nunca devuelve un booleano de éxito) — la pantalla de PIN decide qué mostrar según el error. */
  login: (userId: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Reintenta la restauración de sesión desde `sessionError`. Si el refresh
   * ya había funcionado, repite solo `/auth/me`; si quedó en duda, lo reenvía
   * con el mismo intento.
   */
  retryBootstrap: () => void;
  hasRole: (role: SystemRole) => boolean;
  /**
   * Etapa 5F — refleja en la sesión en memoria un nombre visible recién
   * guardado en Mi perfil (sin request extra ni reinicio de sesión).
   */
  applyDisplayName: (displayName: string) => void;
}

/** Consumido exclusivamente por `useAuth.ts` — nunca directamente por componentes. */
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
