import type {
  TaskEmployee,
  TaskExecution,
  TaskHistoryResponse,
  TaskItem,
  TasksListResponse,
} from '../../api/taskTypes';

/**
 * Fixtures SINTÉTICOS, solo para tests (nunca importados por código de
 * runtime — lo verifica `styles/styles.test.ts`). Nombres explícitamente
 * de prueba: no representan personas ni tareas reales.
 */
export const PERSON_A: TaskEmployee = {
  id: '00000000-0000-4000-8000-00000000000a',
  displayName: 'Persona sintética A',
  colorHex: '#4a7c59',
};
export const PERSON_B: TaskEmployee = {
  id: '00000000-0000-4000-8000-00000000000b',
  displayName: 'Persona sintética B',
  colorHex: 'no-es-un-color',
};

export function makeExecution(overrides: Partial<TaskExecution> = {}): TaskExecution {
  return {
    id: '00000000-0000-4000-8000-0000000000e1',
    periodKey: '2026-09-24',
    completedAt: '2026-09-24T15:30:00.000Z',
    assignedEmployee: PERSON_A,
    completedByEmployee: PERSON_A,
    canRevert: true,
    ...overrides,
  };
}

export function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: '00000000-0000-4000-8000-0000000000t1',
    description: 'Tarea sintética diaria',
    frequency: 'DAILY',
    active: true,
    assignee: { ...PERSON_A, active: true },
    periodKey: '2026-09-24',
    currentExecution: null,
    canComplete: true,
    ...overrides,
  };
}

export function listResponse(tasks: TaskItem[]): TasksListResponse {
  return {
    period: {
      today: '2026-09-24',
      weekStart: '2026-09-21',
      timeZone: 'America/Argentina/Buenos_Aires',
    },
    tasks,
  };
}

export function emptyHistory(overrides: Partial<TaskHistoryResponse> = {}): TaskHistoryResponse {
  return {
    week: {
      start: '2026-09-21',
      end: '2026-09-27',
      days: [
        '2026-09-21',
        '2026-09-22',
        '2026-09-23',
        '2026-09-24',
        '2026-09-25',
        '2026-09-26',
        '2026-09-27',
      ],
      isCurrent: true,
      timeZone: 'America/Argentina/Buenos_Aires',
    },
    summary: { expected: 0, completed: 0 },
    recurring: [],
    others: [],
    ...overrides,
  };
}
