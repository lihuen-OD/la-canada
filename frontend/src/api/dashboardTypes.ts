import type { EventListItem, PersonRef } from './moreTypes';
import type { MedicalRecordType } from './petTypes';

/**
 * 🐾 Atenciones de mascotas: pendientes abiertos de mascotas activas vencidos,
 * de hoy o próximos (≤ 30 días), con la regla y el orden de 📅 Vencimientos.
 * `counts` cuenta TODOS; `items` trae a lo sumo 5, ya ordenados.
 */
export interface DashboardPetDue {
  counts: { overdue: number; dueToday: number; upcoming: number };
  items: {
    record: { id: string; type: MedicalRecordType; description: string | null };
    pet: { id: string; name: string };
    nextDue: { date: string; status: 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING'; daysUntil: number };
  }[];
}

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
    targetQuantity: string | null;
    currentQuantity: string;
    /** Inicio solo recibe críticos (actual ≤ mínimo); los bajos quedan en Stock. */
    stockLevel: 'critical';
    suggestedPurchaseQuantity: string | null;
  }[];
  upcomingEvents: EventListItem[];
  /** `null`: el backend no pudo calcular este resumen (el resto de Inicio llega igual). */
  petDue: DashboardPetDue | null;
  latestNews: { id: string; text: string; createdAt: string; employee: PersonRef }[];
}
