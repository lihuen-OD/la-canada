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

/**
 * Programación SUGERIDA de una recurrente (la valida y la usa el backend):
 * semanal `suggestedWeekday` (1 = lunes … 7 = domingo); quincenal
 * `suggestedFirstHalfDay` (1–15) y `suggestedSecondHalfDay` (16–31);
 * mensual `suggestedMonthDay`; bimestral `suggestedMonth` (1–2, mes del
 * bimestre) + `suggestedMonthDay`; anual `suggestedMonth` (1–12) +
 * `suggestedMonthDay`. `null` = sin dato.
 */
export interface TaskSuggestion {
  suggestedWeekday: number | null;
  suggestedFirstHalfDay: number | null;
  suggestedSecondHalfDay: number | null;
  suggestedMonthDay: number | null;
  suggestedMonth: number | null;
}

export type TaskSuggestionField = keyof TaskSuggestion;

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

export interface TaskItem extends TaskSuggestion {
  id: string;
  description: string;
  frequency: TaskFrequency;
  active: boolean;
  assignee: TaskEmployee & { active: boolean };
  periodKey: string;
  /** «Fecha para realizar» (`YYYY-MM-DD`), solo de una «Una vez»; `null` sin fecha. */
  scheduledDate: string | null;
  scheduleStatus: TaskScheduleStatus | null;
  /** «Orden de realización» (1–9999) o `null` sin orden: ya viene aplicado al listado. */
  executionOrder: number | null;
  /** Fecha sugerida del período vigente (`YYYY-MM-DD`), calculada por el backend. Nunca un vencimiento. */
  suggestedDate: string | null;
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

export interface CreateTaskRequest extends Partial<TaskSuggestion> {
  description: string;
  employeeId: string;
  frequency: TaskFrequency;
  /** Solo «Una vez». Al editar: omitida = sin cambios; `null` = quitar la fecha. */
  scheduledDate?: string | null;
  /** Al editar: omitido = sin cambios; `null` = quitar el orden. */
  executionOrder?: number | null;
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

/** `GET /tasks/calendar?month=YYYY-MM`: dónde ubicar las tareas con sugerencia ese mes. */
export interface TaskCalendarResponse {
  month: string;
  today: string;
  /** Una entrada por tarea activa con sugerencia: sus fechas desde `from` (inicio del período vigente). */
  suggestions: { taskId: string; from: string; dates: string[] }[];
}
