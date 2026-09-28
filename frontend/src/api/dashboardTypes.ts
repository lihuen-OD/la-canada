import type { EventListItem, PersonRef } from './moreTypes';

export interface DashboardResponse {
  generatedAt: string;
  today: string;
  timeZone: string;
  kpis: {
    tasksCompleted: number;
    tasksTotal: number;
    urgentPending: number;
    stockAlerts: number;
    goodEggsToday: number;
  };
  urgentTasks: { id: string; description: string; assignee: PersonRef }[];
  /**
   * Desempeño canónico (el MISMO cálculo de Tareas → Desempeño, rango
   * predeterminado de 7 días). `team`: ADMIN, todas las personas; `self`:
   * EMPLOYEE, solo su fila. `null` si la cuenta no tiene empleado vinculado.
   */
  performance: {
    scope: 'team' | 'self';
    range: { from: string; to: string; timeZone: string };
    employees: {
      employee: PersonRef;
      assigned: number;
      completedPersonally: number;
      percentage: number | null;
      pending: number;
      coverageReceived: number;
      coverageGiven: number;
    }[];
  } | null;
  stockAlerts: {
    id: string;
    name: string;
    area: 'HOUSE' | 'GARDEN';
    unit: string;
    minimumQuantity: string;
    currentQuantity: string;
    stockLevel: 'low' | 'critical';
  }[];
  upcomingEvents: EventListItem[];
  latestNews: { id: string; text: string; createdAt: string; employee: PersonRef }[];
}
