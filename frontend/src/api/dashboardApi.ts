import { apiRequest } from './httpClient';
import type { DashboardResponse } from './dashboardTypes';

export const getDashboard = () =>
  apiRequest<DashboardResponse>('/dashboard', { authenticated: true });
