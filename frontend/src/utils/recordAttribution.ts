import type { ParticipantUser, RecordedBy } from '../api/types';

interface AttributedRecord {
  employee: { displayName: string } | null;
  /** Administrador sin ficha que realizó la actividad (Stock, Gallinero). */
  participantUser?: ParticipantUser | null;
  recordedBy?: RecordedBy | null;
}

/**
 * Nombre a mostrar en un registro: la persona que realizó la actividad
 * (empleado o administrador), nunca reemplazada por el autor. Sin persona
 * (registros anteriores de un ADMIN con «Administrador»), el usuario que lo
 * registró. `null` = no hay evidencia de nadie (aperturas del inventario):
 * cada pantalla conserva su texto para ese caso. `recordedBy` es opcional por
 * las respuestas idempotentes guardadas antes de que el backend lo devolviera.
 */
export function attributedName(record: AttributedRecord): string | null {
  return (
    record.employee?.displayName ??
    record.participantUser?.displayName ??
    record.recordedBy?.displayName ??
    null
  );
}

/**
 * «Registró: …» — solo cuando hay una persona y otro usuario la cargó a su
 * nombre (el backend solo manda `recordedBy` si no es la misma persona). Sin
 * persona, el autor ya es el nombre principal y no se repite.
 */
export function recordedByName(record: AttributedRecord): string | null {
  const hasParticipant = Boolean(record.employee ?? record.participantUser);
  return hasParticipant ? (record.recordedBy?.displayName ?? null) : null;
}
