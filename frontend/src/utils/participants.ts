import type { AuthenticatedUser, ParticipantOption } from '../api/types';

/**
 * Valor de un `<select>` de participante: `EMPLOYEE:<employeeId>` o
 * `ADMIN:<userId>`. Identidad estable (dos personas pueden llamarse igual).
 */
export type ParticipantValue = `${ParticipantOption['kind']}:${string}`;

export function participantValue(option: Pick<ParticipantOption, 'kind' | 'id'>): ParticipantValue {
  return `${option.kind}:${option.id}`;
}

/**
 * La propia persona de la sesión: su ficha si la tiene (así nunca aparece dos
 * veces) o, para un ADMIN sin ficha, su usuario.
 */
export function ownParticipantValue(
  user: Pick<AuthenticatedUser, 'id' | 'role' | 'employee'> | null,
): ParticipantValue | '' {
  if (!user) return '';
  if (user.employee) return participantValue({ kind: 'EMPLOYEE', id: user.employee.id });
  return user.role === 'ADMIN' ? participantValue({ kind: 'ADMIN', id: user.id }) : '';
}

/**
 * Campo del cuerpo o del filtro: `employeeId` o `participantUserId` (nunca los
 * dos). El autor NUNCA viaja: el backend lo toma de la sesión.
 */
export function participantParams(
  value: string,
): { employeeId: string } | { participantUserId: string } | null {
  const [kind, id] = value.split(':');
  if (!id) return null;
  if (kind === 'EMPLOYEE') return { employeeId: id };
  if (kind === 'ADMIN') return { participantUserId: id };
  return null;
}

/** Etiqueta del selector: los administradores con 🔐, como la opción «🔐 Administrador» del prototipo. */
export function participantLabel(option: ParticipantOption): string {
  return option.kind === 'ADMIN' ? `🔐 ${option.displayName}` : option.displayName;
}
