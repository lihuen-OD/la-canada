import { apiRequest } from './httpClient';
import type { PerformanceDetailFilters, PerformanceResponse } from './performanceTypes';

/** Obligaciones por página del detalle («Ver más»). */
export const DETAIL_PAGE_SIZE = 20;

function rangeQuery(from: string, to: string) {
  return new URLSearchParams({ from, to }).toString();
}

export function fetchPerformance(from: string, to: string): Promise<PerformanceResponse> {
  return apiRequest(`/performance/summary?${rangeQuery(from, to)}`, { authenticated: true });
}

export function fetchEmployeePerformance(
  employeeId: string,
  from: string,
  to: string,
): Promise<PerformanceResponse> {
  return apiRequest(`/performance/employees/${employeeId}?${rangeQuery(from, to)}`, {
    authenticated: true,
  });
}

/**
 * Una página del detalle con filtros (el backend filtra, ordena y pagina):
 * `cursor` = el `nextCursor` de la página anterior, `null` para la primera.
 */
export function fetchEmployeePerformancePage(
  employeeId: string,
  from: string,
  to: string,
  filters: PerformanceDetailFilters,
  cursor: string | null,
): Promise<PerformanceResponse> {
  const query = new URLSearchParams({ from, to, limit: String(DETAIL_PAGE_SIZE) });
  if (filters.date) query.set('date', filters.date);
  if (filters.frequency) query.set('frequency', filters.frequency);
  if (filters.status) query.set('status', filters.status);
  if (cursor) query.set('cursor', cursor);
  return apiRequest(`/performance/employees/${employeeId}?${query.toString()}`, {
    authenticated: true,
  });
}
