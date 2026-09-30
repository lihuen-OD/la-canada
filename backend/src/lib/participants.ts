import type { Prisma } from '../generated/prisma/client';
import { ForbiddenError, ValidationError } from '../errors/AppError';
import { prisma } from './prisma';
import { toUserIdentity, userIdentitySelect } from './userIdentity';

/**
 * Participante de una actividad («¿Quién consumió?» en Stock, «¿Quién
 * juntó?» en el Gallinero): quien la REALIZÓ, distinto del usuario que la
 * registró (que siempre sale de la sesión, nunca del cliente).
 *
 * Un participante es un empleado activo (`employeeId`) o un ADMIN activo SIN
 * ficha de empleado (`participantUserId`). Un ADMIN con `Employee` vinculado
 * participa por su ficha, así que aparece una sola vez. Nunca se crea un
 * `Employee` para representar a un administrador.
 */
export type ParticipantKind = 'EMPLOYEE' | 'ADMIN';

export interface ParticipantOption {
  kind: ParticipantKind;
  /** `employeeId` (EMPLOYEE) o `userId` (ADMIN): identidad estable, nunca el nombre. */
  id: string;
  displayName: string;
  colorHex: string | null;
}

/** Persona elegida ya resuelta; a lo sumo una de las dos (CHECK en la base). */
export interface ParticipantSelection {
  employeeId: string | null;
  participantUserId: string | null;
}

/**
 * Catálogo de participantes para los selectores y filtros: administradores
 * activos sin ficha primero (en orden de alta) y después los empleados
 * activos, en el mismo orden que ya usaban los selectores. Dos sentencias
 * fijas. Solo datos públicos: tipo, id, nombre visible y color.
 */
export async function listParticipants(): Promise<{ participants: ParticipantOption[] }> {
  const [admins, employees] = await Promise.all([
    prisma.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE', employeeId: null },
      select: { id: true, ...userIdentitySelect },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.employee.findMany({
      where: { active: true },
      select: { id: true, displayName: true, colorHex: true },
      orderBy: [{ createdAt: 'asc' }, { displayName: 'asc' }],
    }),
  ]);
  return {
    participants: [
      ...admins.map((user) => ({
        kind: 'ADMIN' as const,
        id: user.id,
        displayName: toUserIdentity(user)!.displayName,
        colorHex: null,
      })),
      ...employees.map((employee) => ({ kind: 'EMPLOYEE' as const, ...employee })),
    ],
  };
}

/**
 * Solo un ADMIN puede elegir a un administrador como participante; nunca las
 * dos identidades a la vez. Un EMPLOYEE que envía `participantUserId` recibe
 * 403 (sus permisos no cambian: sigue fijado a sí mismo).
 */
export function assertParticipantUserAllowed(
  actor: { role: 'ADMIN' | 'EMPLOYEE' },
  input: { employeeId?: string | null; participantUserId?: string },
  forbiddenMessage: string,
): void {
  if (input.participantUserId === undefined) return;
  if (actor.role !== 'ADMIN') throw new ForbiddenError(forbiddenMessage);
  if (input.employeeId) {
    throw new ValidationError('Elegí una sola persona.');
  }
}

/**
 * Dentro de la transacción de escritura: el administrador elegido existe,
 * es ADMIN, está ACTIVE y no tiene ficha (con ficha se elige su empleado).
 */
export async function requireActiveAdminParticipant(
  client: Pick<Prisma.TransactionClient, 'user'>,
  userId: string,
  error: () => Error,
): Promise<void> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true, employeeId: true },
  });
  if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE' || user.employeeId !== null) {
    throw error();
  }
}
