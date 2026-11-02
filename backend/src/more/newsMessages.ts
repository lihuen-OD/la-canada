import {
  ForbiddenError,
  NewsMessageDeletedError,
  NewsMessageVersionConflictError,
} from '../errors/AppError';
import type { TaskActor } from '../tasks/tasksService';

/**
 * Edición y eliminación de mensajes de 📝 Novedades (la novedad original y
 * cada respuesta), docs/BUSINESS_RULES.md «Edición y eliminación de mensajes
 * en Novedades». Solo aplica a este módulo.
 *
 * - El autor es el usuario de la sesión que cargó el mensaje
 *   (`NewsReport.recordedByUserId`, `NewsReply.authorUserId`), nunca la
 *   persona que reporta, un nombre, el rol ni un `employeeId` enviado.
 * - Sin autor de carga (novedades del seed): nadie edita; un ADMIN modera.
 * - El autor edita y elimina; un ADMIN elimina mensajes ajenos pero no los edita.
 * - Un mensaje eliminado no se edita ni se vuelve a eliminar.
 */

export interface NewsMessageState {
  authorUserId: string | null;
  version: number;
  deletedAt: Date | null;
}

export function newsMessagePermissions(
  actor: TaskActor,
  authorUserId: string | null,
  deleted: boolean,
): { canEdit: boolean; canDelete: boolean } {
  const isAuthor = authorUserId !== null && authorUserId === actor.userId;
  return {
    canEdit: !deleted && isAuthor,
    canDelete: !deleted && (isAuthor || actor.role === 'ADMIN'),
  };
}

/**
 * Decide una edición antes de escribir: `false` = el texto no cambió (no se
 * escribe ni se audita, aunque la pantalla tuviera una versión vieja: no hay
 * nada que pisar). La versión se exige solo cuando el texto cambia.
 */
export function shouldWriteNewsMessageEdit(
  actor: TaskActor,
  current: NewsMessageState & { text: string },
  input: { text: string; version: number },
): boolean {
  if (current.authorUserId === null || current.authorUserId !== actor.userId) {
    throw new ForbiddenError('Solo quien escribió este mensaje puede editarlo.');
  }
  if (current.deletedAt) throw new NewsMessageDeletedError();
  if (current.text === input.text) return false;
  if (current.version !== input.version) throw new NewsMessageVersionConflictError();
  return true;
}

export function assertCanDeleteNewsMessage(actor: TaskActor, current: NewsMessageState): void {
  if (current.authorUserId !== actor.userId && actor.role !== 'ADMIN') {
    throw new ForbiddenError(
      'Solo quien escribió este mensaje o un administrador pueden eliminarlo.',
    );
  }
}

/**
 * Una escritura condicionada (`id` + versión + no eliminado) que no afectó
 * filas perdió contra otra transacción ya confirmada: se relee y se informa
 * qué pasó, sin pisar nada.
 */
export function lostEditRaceError(after: { deletedAt: Date | null } | null): Error {
  return after?.deletedAt ? new NewsMessageDeletedError() : new NewsMessageVersionConflictError();
}
