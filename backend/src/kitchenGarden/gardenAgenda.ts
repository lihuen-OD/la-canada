import type { TaskFrequency } from '../generated/prisma/enums';
import { compareOperationalOrder, type OperationalOrderItem } from '../tasks/taskOrder';

/**
 * 🥬 Huerta → 📝 Registros: en qué grupo de la agenda cae cada actividad del
 * período vigente (docs/BUSINESS_RULES.md, "🥬 Huerta: registros"). Regla
 * pura sobre lo que el backend ya serializó (fechas `YYYY-MM-DD`):
 *
 * - «Una vez»: su fecha prevista decide (pasada → vencida; hoy → para hoy;
 *   futura → próxima; sin fecha → sin fecha). Es el único caso «vencida»,
 *   el mismo criterio que `scheduleStatus`.
 * - Diaria y urgente: para hoy.
 * - Recurrentes con período largo: la fecha SUGERIDA del período vigente.
 *   Si ya llegó (hoy o antes), para hoy; nunca vencida, porque la sugerencia
 *   no es un vencimiento. Futura → próxima. Sin sugerencia → sin fecha.
 *
 * No cambia períodos, estados, Desempeño ni Historial: solo agrupa y ordena.
 */

export const GARDEN_AGENDA_GROUPS = ['OVERDUE', 'TODAY', 'UPCOMING', 'NO_DATE'] as const;
export type GardenAgenda = (typeof GARDEN_AGENDA_GROUPS)[number];

const AGENDA_ORDER: Record<GardenAgenda, number> = {
  OVERDUE: 0,
  TODAY: 1,
  UPCOMING: 2,
  NO_DATE: 3,
};

/** Días que abarca «Próximos días» en el resumen (hoy excluido). */
export const GARDEN_SOON_DAYS = 7;

export interface GardenAgendaPlacement {
  agenda: GardenAgenda;
  /** Fecha que ordena dentro del grupo; `null` solo en «Sin fecha». */
  agendaDate: string | null;
}

export function agendaOf(
  item: { frequency: TaskFrequency; scheduledDate: string | null; suggestedDate: string | null },
  today: string,
): GardenAgendaPlacement {
  if (item.frequency === 'ONE_TIME') {
    const date = item.scheduledDate;
    if (date === null) return { agenda: 'NO_DATE', agendaDate: null };
    if (date < today) return { agenda: 'OVERDUE', agendaDate: date };
    return { agenda: date === today ? 'TODAY' : 'UPCOMING', agendaDate: date };
  }
  if (item.frequency === 'DAILY' || item.frequency === 'URGENT') {
    return { agenda: 'TODAY', agendaDate: today };
  }
  const date = item.suggestedDate;
  if (date === null) return { agenda: 'NO_DATE', agendaDate: null };
  return { agenda: date <= today ? 'TODAY' : 'UPCOMING', agendaDate: date };
}

/**
 * Grupo (vencidas → para hoy → próximas → sin fecha) → fecha ascendente →
 * orden operativo de siempre (frecuencia, fecha, orden de realización,
 * descripción, id): desempate estable.
 */
export function compareAgenda(
  a: OperationalOrderItem & GardenAgendaPlacement,
  b: OperationalOrderItem & GardenAgendaPlacement,
): number {
  return (
    AGENDA_ORDER[a.agenda] - AGENDA_ORDER[b.agenda] ||
    (a.agendaDate ?? '').localeCompare(b.agendaDate ?? '') ||
    compareOperationalOrder(a, b)
  );
}
