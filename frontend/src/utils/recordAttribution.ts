import type { RecordedBy } from '../api/types';

/**
 * Nombre a mostrar en un registro: la persona asociada tal cual (nunca se
 * reemplaza por el autor) o, sin persona, el usuario que lo registró — p. ej.
 * un administrador sin ficha de empleado. `null` = no hay evidencia de nadie
 * (aperturas del inventario): cada pantalla conserva su texto para ese caso.
 * `recordedBy` es opcional por las respuestas idempotentes guardadas antes de
 * que el backend lo devolviera.
 */
export function attributedName(record: {
  employee: { displayName: string } | null;
  recordedBy?: RecordedBy | null;
}): string | null {
  return record.employee?.displayName ?? record.recordedBy?.displayName ?? null;
}
