import type { TaskEmployee, TaskFrequency } from './taskTypes';

/**
 * Métricas de Desempeño calculadas SOLO por el backend (regla definitiva):
 * `percentage` = `completedPersonally / assigned`; una cobertura no suma al
 * responsable ni a quien cubrió — se informa en `coverageReceived` /
 * `coverageGiven`. `operationalCompleted` es trabajo terminado por la persona
 * (propio + coberturas), nunca parte del porcentaje.
 */
export interface PerformanceMetrics {
  assigned: number;
  completedPersonally: number;
  percentage: number | null;
  pending: number;
  coverageReceived: number;
  coverageGiven: number;
  operationalCompleted: number;
}

export interface PerformanceEmployee extends PerformanceMetrics {
  employee: TaskEmployee & { role: string };
}

export interface PerformanceOccurrence {
  taskId: string;
  description: string;
  frequency: TaskFrequency;
  /** Para el responsable: hecha por él/ella, cubierta por otra persona o pendiente. */
  status: 'personal' | 'covered' | 'pending';
  periodKey: string;
  assignedEmployeeId: string;
  completed: boolean;
  completedByEmployeeId: string | null;
  assignedEmployee: (TaskEmployee & { role: string }) | null;
  completedByEmployee: (TaskEmployee & { role: string }) | null;
  completedAt: string | null;
  /** Solo una «Una vez» con fecha: la de la planificación que usó el cálculo. */
  scheduledDate?: string;
}

export interface PerformanceResponse {
  /** Hora del servidor (ISO), para el reloj del día; ausente en un backend anterior. */
  generatedAt?: string;
  range: {
    from: string;
    to: string;
    /** Fecha de negocio del servidor (puede ser posterior a `to`). */
    today?: string;
    timeZone: string;
    includesCurrentDay: boolean;
    maxDays: number;
  };
  team: PerformanceMetrics;
  special: { urgentCompleted: number; oneTimeCompleted: number; urgentPending: number | null };
  employees: PerformanceEmployee[];
  trend: {
    periodKey: string;
    assigned: number;
    completedPersonally: number;
    percentage: number | null;
  }[];
  occurrences?: PerformanceOccurrence[];
}
