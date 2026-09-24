import { apiRequest } from './httpClient';
import type {
  CreateTaskRequest,
  TaskEmployeesResponse,
  TaskHistoryResponse,
  TaskMutationResponse,
  TaskStatusFilter,
  TasksListResponse,
  UpdateTaskRequest,
} from './taskTypes';

/** Todas autenticadas: ningún endpoint de tareas es público. */
export async function fetchTasks(status: TaskStatusFilter = 'active'): Promise<TasksListResponse> {
  const query = status === 'active' ? '' : `?status=${status}`;
  return apiRequest<TasksListResponse>(`/tasks${query}`, { authenticated: true });
}

export async function fetchTaskEmployees(): Promise<TaskEmployeesResponse> {
  return apiRequest<TaskEmployeesResponse>('/tasks/employees', { authenticated: true });
}

export async function fetchTaskHistory(params: {
  week?: string;
  employeeId?: string;
}): Promise<TaskHistoryResponse> {
  const query = new URLSearchParams();
  if (params.week) query.set('week', params.week);
  if (params.employeeId) query.set('employeeId', params.employeeId);
  const search = query.toString();
  const suffix = search ? `?${search}` : '';
  return apiRequest<TaskHistoryResponse>(`/tasks/history${suffix}`, { authenticated: true });
}

export async function createTask(body: CreateTaskRequest): Promise<TaskMutationResponse> {
  return apiRequest<TaskMutationResponse>('/tasks', { method: 'POST', body, authenticated: true });
}

export async function updateTask(
  taskId: string,
  body: UpdateTaskRequest,
): Promise<TaskMutationResponse> {
  return apiRequest<TaskMutationResponse>(`/tasks/${taskId}`, {
    method: 'PATCH',
    body,
    authenticated: true,
  });
}

export async function setTaskActive(
  taskId: string,
  active: boolean,
): Promise<TaskMutationResponse> {
  return apiRequest<TaskMutationResponse>(`/tasks/${taskId}/status`, {
    method: 'PATCH',
    body: { active },
    authenticated: true,
  });
}

/**
 * `employeeId` solo lo envía un ADMIN (quién realizó la tarea). Un EMPLOYEE
 * llama sin argumento: el backend usa su propio empleado de la sesión.
 */
export async function completeTask(
  taskId: string,
  employeeId?: string,
): Promise<TaskMutationResponse> {
  return apiRequest<TaskMutationResponse>(`/tasks/${taskId}/complete`, {
    method: 'POST',
    body: employeeId ? { employeeId } : {},
    authenticated: true,
  });
}

export async function revertTaskCompletion(
  taskId: string,
  executionId: string,
  reason?: string,
): Promise<TaskMutationResponse> {
  return apiRequest<TaskMutationResponse>(`/tasks/${taskId}/revert`, {
    method: 'POST',
    body: reason ? { executionId, reason } : { executionId },
    authenticated: true,
  });
}
