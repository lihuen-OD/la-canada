import type { UserStatus } from '../generated/prisma/enums';

/**
 * Transiciones explícitas y validadas — `PATCH /admin/users/:id/status`
 * (sección 4). `PENDING_ACTIVATION → ACTIVE` NO está acá a propósito: esa
 * transición exige fijar un PIN y pasa exclusivamente por
 * `POST /admin/users/:id/activate`, nunca por este endpoint genérico.
 */
const ALLOWED_TRANSITIONS: Record<UserStatus, readonly UserStatus[]> = {
  PENDING_ACTIVATION: ['DEACTIVATED'],
  ACTIVE: ['SUSPENDED', 'DEACTIVATED'],
  SUSPENDED: ['ACTIVE', 'DEACTIVATED'],
  DEACTIVATED: ['ACTIVE', 'SUSPENDED'],
};

/** Estados que revocan todas las sesiones activas del usuario al aplicarse. */
const STATUSES_THAT_REVOKE_SESSIONS: readonly UserStatus[] = ['SUSPENDED', 'DEACTIVATED'];

export function isAllowedStatusTransition(from: UserStatus, to: UserStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function statusChangeRevokesSessions(to: UserStatus): boolean {
  return STATUSES_THAT_REVOKE_SESSIONS.includes(to);
}
