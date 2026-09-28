import type { AuthenticatedUser, SystemRole } from '../api/types';

const ROLE_LABELS: Record<SystemRole, string> = {
  ADMIN: 'Administrador',
  EMPLOYEE: 'Equipo',
};

export function getRoleLabel(role: SystemRole): string {
  return ROLE_LABELS[role];
}

/**
 * Nombre visible de la persona autenticada (Etapa 5F): el que cargó en Mi
 * perfil (o el de su Employee). Sin nombre, la etiqueta genérica — nunca su
 * `username` (que `/auth/me` ni siquiera devuelve).
 */
export function getUserDisplayName(user: AuthenticatedUser): string {
  return user.displayName ?? user.employee?.displayName ?? ROLE_LABELS.ADMIN;
}

/** Nombre real si ya lo cargó; null si solo existe el fallback genérico. */
export function getLoadedDisplayName(user: AuthenticatedUser | null): string | null {
  return user?.displayName ?? user?.employee?.displayName ?? null;
}
