import type { TaskFrequency } from '../generated/prisma/enums';

/**
 * Orden operativo de los listados con frecuencia (✅ Tareas y 🥬 Huerta):
 * regla pura, sin datos ni consultas (docs/BUSINESS_RULES.md, "Orden de
 * realización y programación sugerida").
 */

/**
 * Orden de los grupos del prototipo: urgente → única → diaria → semanal →
 * mensual (quincenal, entre semanal y mensual; bimestral y anual, después de
 * mensual).
 */
export const FREQUENCY_ORDER: Record<TaskFrequency, number> = {
  URGENT: 0,
  ONE_TIME: 1,
  DAILY: 2,
  WEEKLY: 3,
  SEMI_MONTHLY: 4,
  MONTHLY: 5,
  BIMONTHLY: 6,
  ANNUAL: 7,
};

/** Lo que ordena: ya serializado por el backend (fechas `YYYY-MM-DD`). */
export interface OperationalOrderItem {
  id: string;
  description: string;
  frequency: TaskFrequency;
  scheduledDate: string | null;
  suggestedDate: string | null;
  executionOrder: number | null;
}

/** Fechas `YYYY-MM-DD`: primero las que tienen fecha (la más antigua arriba), después las sin fecha. */
function compareDates(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

/** «Orden de realización»: primero las numeradas, de menor a mayor; después las sin orden. */
function compareExecutionOrder(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/**
 * Fecha que ordena dentro de la frecuencia: la «Fecha para realizar» de una
 * «Una vez» o la fecha sugerida del período vigente de una recurrente (ambas
 * del backend). Diarias y urgentes se ordenan solo por número.
 */
function sortDateOf(
  item: Pick<OperationalOrderItem, 'frequency' | 'scheduledDate' | 'suggestedDate'>,
) {
  switch (item.frequency) {
    case 'DAILY':
    case 'URGENT':
      return null;
    case 'ONE_TIME':
      return item.scheduledDate;
    default:
      return item.suggestedDate;
  }
}

/**
 * Frecuencia → fecha (sin fecha al final) → orden de realización (sin número
 * al final) → descripción → id (desempate estable). Nunca por estado ni
 * cumplimiento.
 */
export function compareOperationalOrder(a: OperationalOrderItem, b: OperationalOrderItem): number {
  return (
    FREQUENCY_ORDER[a.frequency] - FREQUENCY_ORDER[b.frequency] ||
    compareDates(sortDateOf(a), sortDateOf(b)) ||
    compareExecutionOrder(a.executionOrder, b.executionOrder) ||
    a.description.localeCompare(b.description, 'es') ||
    a.id.localeCompare(b.id)
  );
}
