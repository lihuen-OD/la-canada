import type { TaskFrequency } from '../generated/prisma/enums';
import { formatLocalDate } from '../lib/businessTime';
import { occurrenceStatus, periodBounds, type Occurrence } from './performanceCalculator';

/**
 * Tareas → Desempeño → Detalle: orden, filtros y páginas sobre las
 * obligaciones que YA calculó `getPerformance` (nunca genera otras). Reglas
 * puras; ver docs/BUSINESS_RULES.md, "Detalle de Desempeño: orden, filtros y
 * «Ver más»".
 */

/** Estado visto desde la persona del detalle (los mismos rótulos de la pantalla). */
export const DETAIL_STATUSES = ['pending', 'personal', 'covered', 'coverageGiven'] as const;
export type DetailStatus = (typeof DETAIL_STATUSES)[number];

export const DETAIL_PAGE_SIZE = 20;
export const DETAIL_PAGE_MAX = 50;

export interface DetailFilters {
  /** Un día (`YYYY-MM-DD`) dentro del rango. */
  date?: string;
  frequency?: TaskFrequency;
  status?: DetailStatus;
}

/** Ubicación de una obligación: el día que la agrupa y, si es recurrente, su período completo. */
export interface DetailPlacement {
  /**
   * Diaria: su fecha. Recurrente más larga: el primer día del período (solo
   * para ubicarla; el período se muestra completo). «Una vez»: la fecha para
   * realizar de su planificación. Sin fecha («Una vez» sin fecha, urgente):
   * `null`, al final.
   */
  groupDate: string | null;
  period: { start: string; end: string } | null;
}

export function detailPlacement(
  item: Pick<Occurrence, 'frequency' | 'periodKey' | 'scheduledDate'>,
): DetailPlacement {
  const bounds = periodBounds(item.frequency, item.periodKey);
  if (bounds) {
    const start = formatLocalDate(bounds.start);
    return { groupDate: start, period: { start, end: formatLocalDate(bounds.end) } };
  }
  if (item.frequency === 'ONE_TIME' && item.scheduledDate) {
    return { groupDate: item.scheduledDate, period: null };
  }
  return { groupDate: null, period: null };
}

/**
 * Estado para la persona del detalle: sus obligaciones están sin completar,
 * realizadas por ella (cumplimiento personal) o cubiertas por otra persona;
 * las ajenas que hizo ella son «Cubrió a otros» (nunca cumplimiento personal).
 */
export function detailStatusOf(
  item: Pick<Occurrence, 'assignedEmployeeId' | 'completed' | 'completedByEmployeeId'>,
  personId: string,
): DetailStatus {
  if (item.assignedEmployeeId !== personId) return 'coverageGiven';
  return occurrenceStatus(item as Occurrence);
}

/** ¿Coincide con el día elegido? Una recurrente, si su período lo contiene; sin fecha, nunca. */
export function matchesDate(placement: DetailPlacement, date: string): boolean {
  if (placement.period) return placement.period.start <= date && date <= placement.period.end;
  return placement.groupDate === date;
}

export function matchesFilters(
  row: DetailPlacement & { frequency: TaskFrequency; status: DetailStatus },
  filters: DetailFilters,
): boolean {
  return (
    (!filters.date || matchesDate(row, filters.date)) &&
    (!filters.frequency || row.frequency === filters.frequency) &&
    (!filters.status || row.status === filters.status)
  );
}

/** Lo que ordena (y posiciona el cursor): fecha, descripción e identificador. */
export interface DetailSortKey {
  groupDate: string | null;
  description: string;
  taskId: string;
  periodKey: string;
}

const plainCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Orden TOTAL del detalle: la fecha más reciente primero (hoy, ayer…), las
 * sin fecha al final; con la misma fecha, por descripción y, al final, por
 * tarea y período (únicos por obligación), así dos obligaciones nunca empatan.
 */
export function compareDetail(a: DetailSortKey, b: DetailSortKey): number {
  if (a.groupDate !== b.groupDate) {
    if (a.groupDate === null) return 1;
    if (b.groupDate === null) return -1;
    return plainCompare(b.groupDate, a.groupDate);
  }
  return (
    a.description.localeCompare(b.description, 'es') ||
    plainCompare(a.description, b.description) ||
    plainCompare(a.taskId, b.taskId) ||
    plainCompare(a.periodKey, b.periodKey)
  );
}

/** Cursor opaco = la clave de orden de la última obligación entregada. */
export function encodeCursor(key: DetailSortKey): string {
  return Buffer.from(
    JSON.stringify([key.groupDate, key.description, key.taskId, key.periodKey]),
  ).toString('base64url');
}

export function decodeCursor(cursor: string): DetailSortKey | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 4) return null;
    const [groupDate, description, taskId, periodKey] = value as unknown[];
    if (groupDate !== null && typeof groupDate !== 'string') return null;
    if (typeof description !== 'string' || typeof taskId !== 'string') return null;
    if (typeof periodKey !== 'string') return null;
    return { groupDate, description, taskId, periodKey };
  } catch {
    return null;
  }
}

/**
 * Una página: las `limit` obligaciones que siguen ESTRICTAMENTE al cursor en
 * el orden total. Como el cursor es una posición en el orden (no un índice),
 * si entre página y página aparece o desaparece una obligación no se repite
 * ni se saltea ninguna de las que siguen. `total` = todas las que pasan los
 * filtros.
 */
export function pageOf<T extends DetailSortKey>(
  rows: T[],
  cursor: DetailSortKey | null,
  limit: number,
): { items: T[]; total: number; nextCursor: string | null } {
  const sorted = [...rows].sort(compareDetail);
  const found = cursor ? sorted.findIndex((row) => compareDetail(row, cursor) > 0) : 0;
  const start = found === -1 ? sorted.length : found;
  const items = sorted.slice(start, start + limit);
  const last = items.at(-1);
  return {
    items,
    total: sorted.length,
    nextCursor: last && start + items.length < sorted.length ? encodeCursor(last) : null,
  };
}
