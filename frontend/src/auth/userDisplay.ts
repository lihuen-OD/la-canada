import type { AuthenticatedUser, SystemRole } from '../api/types';

const ROLE_LABELS: Record<SystemRole, string> = {
  ADMIN: 'Administrador',
  EMPLOYEE: 'Equipo',
};

export function getRoleLabel(role: SystemRole): string {
  return ROLE_LABELS[role];
}

/**
 * Nombre visible de la persona autenticada. Un ADMIN sin `Employee`
 * vinculado se muestra con la etiqueta genérica — nunca con su `username`
 * (que `/auth/me` ni siquiera devuelve).
 */
export function getUserDisplayName(user: AuthenticatedUser): string {
  return user.employee?.displayName ?? ROLE_LABELS.ADMIN;
}
