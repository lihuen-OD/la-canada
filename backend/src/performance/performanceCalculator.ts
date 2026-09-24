import type { TaskFrequency } from '../generated/prisma/enums';
import {
  addDays,
  compareLocalDates,
  formatLocalDate,
  parseLocalDate,
  startOfLocalDay,
  startOfWeek,
  type LocalDate,
} from '../lib/businessTime';

export interface PlanningRow {
  id: string;
  taskId: string;
  description: string;
  employeeId: string;
  frequency: TaskFrequency;
  validFrom: Date;
  validTo: Date | null;
}

export interface ExecutionRow {
  id: string;
  taskId: string;
  periodKey: string;
  assignedEmployeeId: string;
  completedByEmployeeId: string;
  completedAt: Date;
}

export interface Occurrence {
  taskId: string;
  description: string;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  periodKey: string;
  assignedEmployeeId: string;
  completed: boolean;
  completedByEmployeeId: string | null;
  completedAt: Date | null;
}

const recurring = (frequency: TaskFrequency): frequency is Occurrence['frequency'] =>
  frequency === 'DAILY' || frequency === 'WEEKLY' || frequency === 'MONTHLY';

function periodStarts(from: LocalDate, to: LocalDate): LocalDate[] {
  const dates: LocalDate[] = [];
  for (let day = from; compareLocalDates(day, to) <= 0; day = addDays(day, 1)) dates.push(day);
  return dates;
}

/**
 * Genera ocurrencias sin consultas: para cada cierre de período elige una
 * sola versión de planificación. En el período actual usa `now`; en uno
 * cerrado usa el primer instante del período siguiente. Esto evita duplicar
 * una tarea cuando cambia responsable o frecuencia dentro del período.
 */
export function buildRecurringOccurrences(input: {
  plans: PlanningRow[];
  executions: ExecutionRow[];
  from: LocalDate;
  to: LocalDate;
  today: LocalDate;
  now: Date;
  timeZone: string;
}): Occurrence[] {
  const byTask = new Map<string, PlanningRow[]>();
  for (const plan of input.plans) {
    const rows = byTask.get(plan.taskId) ?? [];
    rows.push(plan);
    byTask.set(plan.taskId, rows);
  }
  for (const rows of byTask.values())
    rows.sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());

  const executionByKey = new Map(
    input.executions.map((execution) => [`${execution.taskId}:${execution.periodKey}`, execution]),
  );
  const result: Occurrence[] = [];
  const seen = new Set<string>();

  for (const day of periodStarts(input.from, input.to)) {
    for (const rows of byTask.values()) {
      for (const frequency of ['DAILY', 'WEEKLY', 'MONTHLY'] as const) {
        if (frequency === 'WEEKLY' && compareLocalDates(day, startOfWeek(day)) !== 0) continue;
        if (frequency === 'MONTHLY' && day.day !== 1) continue;

        const next =
          frequency === 'DAILY'
            ? addDays(day, 1)
            : frequency === 'WEEKLY'
              ? addDays(day, 7)
              : {
                  year: day.month === 12 ? day.year + 1 : day.year,
                  month: (day.month % 12) + 1,
                  day: 1,
                };
        const current =
          compareLocalDates(day, input.today) <= 0 && compareLocalDates(input.today, next) < 0;
        const cutoff = current ? input.now : startOfLocalDay(next, input.timeZone);
        if (cutoff.getTime() > input.now.getTime()) continue;

        const candidates = rows.filter(
          (plan) =>
            plan.validFrom.getTime() < cutoff.getTime() &&
            (plan.validTo === null || plan.validTo.getTime() >= cutoff.getTime()),
        );
        const plan = candidates.at(-1);
        if (!plan || !recurring(plan.frequency) || plan.frequency !== frequency) continue;

        const periodKey = formatLocalDate(day);
        const key = `${plan.taskId}:${periodKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const execution = executionByKey.get(key);
        result.push({
          taskId: plan.taskId,
          description: plan.description,
          frequency,
          periodKey,
          assignedEmployeeId: execution?.assignedEmployeeId ?? plan.employeeId,
          completed: Boolean(execution),
          completedByEmployeeId: execution?.completedByEmployeeId ?? null,
          completedAt: execution?.completedAt ?? null,
        });
      }
    }
  }
  return result.sort(
    (a, b) =>
      a.periodKey.localeCompare(b.periodKey) || a.description.localeCompare(b.description, 'es'),
  );
}

export function percentage(completed: number, expected: number): number | null {
  return expected === 0 ? null : Math.round((completed / expected) * 1000) / 10;
}

export function computeDailyStreak(
  occurrences: Occurrence[],
  employeeId: string,
  today: LocalDate,
): number | null {
  const daily = occurrences.filter(
    (item) => item.frequency === 'DAILY' && item.assignedEmployeeId === employeeId,
  );
  if (daily.length === 0) return null;
  const byDay = new Map<string, Occurrence[]>();
  for (const item of daily) byDay.set(item.periodKey, [...(byDay.get(item.periodKey) ?? []), item]);
  let cursor = today;
  const todayItems = byDay.get(formatLocalDate(today));
  if (todayItems && !todayItems.every((item) => item.completed)) cursor = addDays(cursor, -1);
  let streak = 0;
  while (true) {
    const items = byDay.get(formatLocalDate(cursor));
    if (!items) {
      cursor = addDays(cursor, -1);
      if (compareLocalDates(cursor, parseLocalDate(daily[0]!.periodKey)!) < 0) break;
      continue;
    }
    if (!items.every((item) => item.completed)) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
