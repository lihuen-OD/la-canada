import type { UserStatus } from '../../api/types';

/**
 * Espejo de `backend/src/auth/userStatus.ts` (`ALLOWED_TRANSITIONS`) —
 * existe únicamente para decidir qué botones mostrar, nunca para
 * autorizar nada por sí solo: el backend sigue siendo la autoridad final,
 * y cualquier desincronización entre este archivo y el real solo puede
 * resultar en un botón de más (que el backend rechazaría igual, mostrando
 * el error real) o de menos (nunca en una acción indebida aceptada). Si el
 * backend cambia esta matriz, hay que actualizar esto a mano — no hay
 * forma de leerla dinámicamente sin un endpoint dedicado que hoy no existe.
 *
 * `PENDING_ACTIVATION -> ACTIVE` NO está acá a propósito, igual que en el
 * backend: esa transición exige fijar un PIN y pasa exclusivamente por
 * `POST /admin/users/:id/activate`, nunca por el cambio de estado genérico.
 */
const ALLOWED_TRANSITIONS: Record<UserStatus, readonly UserStatus[]> = {
  PENDING_ACTIVATION: ['DEACTIVATED'],
  ACTIVE: ['SUSPENDED', 'DEACTIVATED'],
  SUSPENDED: ['ACTIVE', 'DEACTIVATED'],
  DEACTIVATED: ['ACTIVE', 'SUSPENDED'],
};

const STATUSES_THAT_REVOKE_SESSIONS: readonly UserStatus[] = ['SUSPENDED', 'DEACTIVATED'];

export function getAllowedStatusTransitions(from: UserStatus): readonly UserStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function statusChangeRevokesSessions(to: UserStatus): boolean {
  return STATUSES_THAT_REVOKE_SESSIONS.includes(to);
}

const STATUS_LABELS: Record<UserStatus, string> = {
  PENDING_ACTIVATION: 'Pendiente de activación',
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
  DEACTIVATED: 'Deshabilitado',
};

export function getStatusLabel(status: UserStatus): string {
  return STATUS_LABELS[status];
}

/** Etiqueta de la ACCIÓN que lleva a `to` (no del estado en sí) — lo que ve la persona en el botón. */
const TRANSITION_ACTION_LABELS: Record<UserStatus, string> = {
  PENDING_ACTIVATION: 'Volver a pendiente', // nunca se ofrece en la práctica (ninguna transición real apunta acá)
  ACTIVE: 'Reactivar',
  SUSPENDED: 'Suspender',
  DEACTIVATED: 'Deshabilitar',
};

export function getTransitionActionLabel(to: UserStatus): string {
  return TRANSITION_ACTION_LABELS[to];
}
