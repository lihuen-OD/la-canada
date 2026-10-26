import type {
  GardenActivity,
  GardenExecution,
  GardenHistoryActivity,
  GardenHistoryResponse,
  GardenPerformanceResponse,
  GardenPerson,
} from '../../api/kitchenGardenTypes';
import type { PerformanceResponse } from '../../api/performanceTypes';
import type {
  HistoryTask,
  TaskEmployee,
  TaskExecution,
  TaskHistoryResponse,
  TaskItem,
} from '../../api/taskTypes';
import type { ItemNoun } from '../tasks/taskLabels';

/**
 * 🥬 Huerta → formas de PRESENTACIÓN de los componentes compartidos con ✅
 * Tareas (`TaskItem`, `TaskFormDialog`, `TaskHistory`, `PerformanceScreen`).
 * Solo traduce nombres de campo (participante ↔ «persona» del componente):
 * no calcula estados, fechas ni métricas, y nunca mezcla datos de Tareas.
 */

export const GARDEN_NOUN: ItemNoun = {
  singular: 'actividad',
  plural: 'actividades',
  noObligations: 'Sin actividades previstas',
};

/** Persona de la Huerta como la muestran los componentes (color por defecto si no tiene). */
export const toPerson = (person: GardenPerson): TaskEmployee => ({
  id: person.id,
  displayName: person.displayName,
  colorHex: person.colorHex ?? '',
});

const toExecution = (execution: GardenExecution): TaskExecution => ({
  id: execution.id,
  periodKey: execution.periodKey,
  completedAt: execution.completedAt,
  assignedEmployee: toPerson(execution.assignedTo),
  completedByEmployee: toPerson(execution.completedBy),
  canRevert: execution.canRevert,
});

export function toTaskItem(activity: GardenActivity): TaskItem {
  return {
    id: activity.id,
    description: activity.description,
    frequency: activity.frequency,
    active: activity.active,
    assignee: { ...toPerson(activity.responsible), active: activity.responsible.active },
    periodKey: activity.periodKey,
    scheduledDate: activity.scheduledDate,
    scheduleStatus: activity.scheduleStatus,
    executionOrder: activity.executionOrder,
    suggestedWeekday: activity.suggestedWeekday,
    suggestedFirstHalfDay: activity.suggestedFirstHalfDay,
    suggestedSecondHalfDay: activity.suggestedSecondHalfDay,
    suggestedMonthDay: activity.suggestedMonthDay,
    suggestedMonth: activity.suggestedMonth,
    suggestedDate: activity.suggestedDate,
    currentExecution: activity.currentExecution ? toExecution(activity.currentExecution) : null,
    canComplete: activity.canComplete,
  };
}

const toHistoryTask = (activity: GardenHistoryActivity): HistoryTask => ({
  id: activity.id,
  description: activity.description,
  frequency: activity.frequency,
  active: activity.active,
  assignee: toPerson(activity.responsible),
  scheduledDate: activity.scheduledDate,
});

export function toTaskHistory(history: GardenHistoryResponse): TaskHistoryResponse {
  return {
    week: history.week,
    summary: history.summary,
    recurring: history.recurring.map((row) => ({
      task: toHistoryTask(row.activity),
      slots: row.slots.map((slot) => ({
        periodKey: slot.periodKey,
        expected: slot.expected,
        execution: slot.execution ? toExecution(slot.execution) : null,
      })),
    })),
    others: history.others.map((row) => ({
      task: toHistoryTask(row.activity),
      execution: toExecution(row.execution),
    })),
  };
}

const withRole = (person: GardenPerson | null, role = '') =>
  person ? { ...toPerson(person), role } : null;

export function toPerformance(performance: GardenPerformanceResponse): PerformanceResponse {
  return {
    generatedAt: performance.generatedAt,
    range: performance.range,
    team: performance.team,
    special: performance.special,
    employees: performance.participants.map(({ participant, ...metrics }) => ({
      ...metrics,
      employee: { ...toPerson(participant), role: participant.roleLabel },
    })),
    trend: [],
    occurrences: performance.occurrences?.map((item) => ({
      taskId: item.activityId,
      description: item.description,
      frequency: item.frequency,
      status: item.status,
      periodKey: item.periodKey,
      assignedEmployeeId: item.assignedParticipantId,
      completed: item.status !== 'pending',
      completedByEmployeeId: item.completedByParticipantId,
      assignedEmployee: withRole(item.assignedTo),
      completedByEmployee: withRole(item.completedBy),
      completedAt: item.completedAt,
      ...(item.scheduledDate ? { scheduledDate: item.scheduledDate } : {}),
    })),
  };
}
