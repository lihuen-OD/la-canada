import type { PropsWithChildren, ReactNode } from 'react';
import { useAuth } from '../auth/useAuth';
import type { SystemRole } from '../api/types';

interface RequireRoleProps extends PropsWithChildren {
  role: SystemRole;
  fallback?: ReactNode;
}

/**
 * Preparado para rutas admin-only de etapas futuras — todavía sin ningún
 * consumidor real (no hay módulos administrativos que proteger todavía).
 * Nunca confía en un rol decodificado del JWT en el cliente: `hasRole` lee
 * el usuario que devolvió el backend en `/auth/login`/`/auth/me`, la misma
 * fuente de verdad que ya usa el resto de la app.
 */
export function RequireRole({ role, fallback = null, children }: RequireRoleProps) {
  const { hasRole } = useAuth();
  return hasRole(role) ? <>{children}</> : <>{fallback}</>;
}
