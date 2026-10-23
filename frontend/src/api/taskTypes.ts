/**
 * Contratos reales de `/api/v1/tasks` (Etapa 4A) — leídos de
 * `backend/src/tasks/tasksService.ts`. El frontend nunca calcula ni envía
 * `periodKey`: es solo de lectura, lo decide el backend con la zona horaria
 * de negocio.
 */

export type TaskFrequency =
  'DAILY' | 'WEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY' | 'BIMONTHLY' | 'ANNUAL' | 'URGENT' | 'ONE_TIME';

/**
 * Estado de una «Una vez» con fecha y sin completar, calculado por el backend
 * con las fechas de `BUSINESS_TIME_ZONE`: programada (futura), para hoy o
 * vencida. `null` sin fecha o ya completada.
 */
export type TaskScheduleStatus = 'SCHEDULED' | 'DUE_TODAY' | 'OVERDUE';

export interface TaskEmployee {
  id: string;
  displayName: string;
  colorHex: string;
}

export interface TaskExecution {
  id: string;
  periodKey: string;
  completedAt: string | null;
  /** Snapshot: a quién estaba asignada la tarea al completarla. */
  assignedEmployee: TaskEmployee;
  /** Quién la realizó realmente. */
  completedByEmployee: TaskEmployee | null;
  /** Calculado por el backend según rol, autoría y período vigente. */
  canRevert: boolean;
}

export interface TaskItem {
  id: string;
  description: string;
  frequency: TaskFrequency;
  active: boolean;
  assignee: TaskEmployee & { active: boolean };
  periodKey: string;
  /** «Fecha para realizar» (`YYYY-MM-DD`), solo de una «Una vez»; `null` sin fecha. */
  scheduledDate: string | null;
  scheduleStatus: TaskScheduleStatus | null;
  currentExecution: TaskExecution | null;
  canComplete: boolean;
}

export type TaskStatusFilter = 'active' | 'inactive' | 'all';

export interface TasksListResponse {
  period: {
    today: string;
    weekStart: string;
    timeZone: string;
    /** Hora del servidor (ISO), para el reloj del día; ausente en un backend anterior. */
    generatedAt?: string;
  };
  tasks: TaskItem[];
}

export interface TaskEmployeesResponse {
  employees: TaskEmployee[];
}

export interface TaskMutationResponse {
  task: TaskItem;
}

export interface CreateTaskRequest {
  description: string;
  employeeId: string;
  frequency: TaskFrequency;
  /** Solo «Una vez». Al editar: omitida = sin cambios; `null` = quitar la fecha. */
  scheduledDate?: string | null;
}

export type UpdateTaskRequest = Partial<CreateTaskRequest>;

export interface HistoryTask {
  id: string;
  description: string;
  frequency: TaskFrequency;
  active: boolean;
  assignee: TaskEmployee;
  scheduledDate: string | null;
}

export interface HistorySlot {
  periodKey: string;
  expected: boolean;
  execution: TaskExecution | null;
}

export interface TaskHistoryResponse {
  week: { start: string; end: string; days: string[]; isCurrent: boolean; timeZone: string };
  summary: { expected: number; completed: number };
  recurring: { task: HistoryTask; slots: HistorySlot[] }[];
  others: { task: HistoryTask; execution: TaskExecution }[];
}
