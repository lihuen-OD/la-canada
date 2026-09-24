import type { TaskEmployee, TaskFrequency } from './taskTypes';

export interface PerformanceMetrics {
  expected: number;
  completed: number;
  percentage: number | null;
  performed: number;
  coveredOthers: number;
  receivedHelp: number;
}

export interface PerformanceEmployee extends PerformanceMetrics {
  employee: TaskEmployee & { role: string };
  dailyStreak: number | null;
}

export interface PerformanceOccurrence {
  taskId: string;
  description: string;
  frequency: Extract<TaskFrequency, 'DAILY' | 'WEEKLY' | 'MONTHLY'>;
  periodKey: string;
  assignedEmployeeId: string;
  completed: boolean;
  completedByEmployeeId: string | null;
  assignedEmployee: (TaskEmployee & { role: string }) | null;
  completedByEmployee: (TaskEmployee & { role: string }) | null;
  completedAt: string | null;
}

export interface PerformanceResponse {
  range: {
    from: string;
    to: string;
    timeZone: string;
    includesCurrentDay: boolean;
    maxDays: number;
  };
  team: PerformanceMetrics;
  special: { urgentCompleted: number; oneTimeCompleted: number; urgentPending: number | null };
  employees: PerformanceEmployee[];
  trend: { periodKey: string; expected: number; completed: number; percentage: number | null }[];
  occurrences?: PerformanceOccurrence[];
}
