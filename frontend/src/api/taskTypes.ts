/**
 * Contratos reales de `/api/v1/tasks` (Etapa 4A) — leídos de
 * `backend/src/tasks/tasksService.ts`. El frontend nunca calcula ni envía
 * `periodKey`: es solo de lectura, lo decide el backend con la zona horaria
 * de negocio.
 */

export type TaskFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'URGENT' | 'ONE_TIME';

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
  currentExecution: TaskExecution | null;
  canComplete: boolean;
}

export type TaskStatusFilter = 'active' | 'inactive' | 'all';

export interface TasksListResponse {
  period: { today: string; weekStart: string; timeZone: string };
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
}

export type UpdateTaskRequest = Partial<CreateTaskRequest>;

export interface HistoryTask {
  id: string;
  description: string;
  frequency: TaskFrequency;
  active: boolean;
  assignee: TaskEmployee;
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
