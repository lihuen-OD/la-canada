import { apiRequest } from './httpClient';
import type { PerformanceResponse } from './performanceTypes';

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
