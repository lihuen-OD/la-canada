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

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthenticatedUser | null;
  /** Lanza (nunca devuelve un booleano de éxito) — la pantalla de PIN decide qué mostrar según el error. */
  login: (userId: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Reintenta la restauración de sesión — solo tiene sentido desde `sessionError` (falla de red). */
  retryBootstrap: () => void;
  hasRole: (role: SystemRole) => boolean;
}

/** Consumido exclusivamente por `useAuth.ts` — nunca directamente por componentes. */
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
