import type { TaskFrequency } from '../generated/prisma/enums';
import {
  ONE_TIME_PERIOD_KEY,
  URGENT_PERIOD_KEY,
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

/**
 * Una obligación de una persona. Recurrentes: una por día/semana/mes
 * planificado. URGENT y ONE_TIME: una sola por tarea (`periodKey` fijo
 * `URGENT`/`ONE_TIME`, el mismo que usa la ejecución).
 */
export interface Occurrence {
  taskId: string;
  description: string;
  frequency: TaskFrequency;
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

const SINGLE_KEYS = [
  ['URGENT', URGENT_PERIOD_KEY],
  ['ONE_TIME', ONE_TIME_PERIOD_KEY],
] as const;

/**
 * URGENT y ONE_TIME: cada tarea es UNA obligación, nunca una por día/semana.
 * Su ventana va desde la primera planificación con esa frecuencia hasta la
 * finalización vigente (o, si sigue pendiente, hasta el cierre de la última
 * planificación). Entra al rango si esa ventana se superpone con él: creada
 * después del rango o completada antes de empezar → no entra; completada
 * durante el rango o pendiente en alguna parte → entra una sola vez. El
 * responsable es el snapshot de la ejecución; si sigue pendiente, el de la
 * planificación vigente al cierre de la ventana dentro del rango.
 */
export function buildSingleOccurrences(input: {
  plans: PlanningRow[];
  executions: ExecutionRow[];
  rangeStart: Date;
  rangeEnd: Date;
  now: Date;
}): Occurrence[] {
  const executionByKey = new Map(
    input.executions.map((execution) => [`${execution.taskId}:${execution.periodKey}`, execution]),
  );
  const byTask = new Map<string, PlanningRow[]>();
  for (const plan of input.plans) {
    const rows = byTask.get(plan.taskId) ?? [];
    rows.push(plan);
    byTask.set(plan.taskId, rows);
  }
  const result: Occurrence[] = [];
  for (const [taskId, rows] of byTask) {
    for (const [frequency, periodKey] of SINGLE_KEYS) {
      const plans = rows
        .filter((plan) => plan.frequency === frequency)
        .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
      if (plans.length === 0) continue;
      const start = plans[0]!.validFrom;
      const execution = executionByKey.get(`${taskId}:${periodKey}`);
      const end = execution ? execution.completedAt : (plans.at(-1)!.validTo ?? null);
      if (start.getTime() >= input.rangeEnd.getTime() || start.getTime() > input.now.getTime())
        continue;
      if (end !== null && end.getTime() < input.rangeStart.getTime()) continue;

      const cutoff = Math.min(
        end?.getTime() ?? Infinity,
        input.rangeEnd.getTime(),
        input.now.getTime(),
      );
      const plan = plans.filter((row) => row.validFrom.getTime() <= cutoff).at(-1) ?? plans.at(-1)!;
      // Completada después de terminar el rango: dentro del rango seguía pendiente.
      const done =
        execution && execution.completedAt.getTime() < input.rangeEnd.getTime() ? execution : null;
      result.push({
        taskId,
        description: plan.description,
        frequency,
        periodKey,
        assignedEmployeeId: done?.assignedEmployeeId ?? plan.employeeId,
        completed: Boolean(done),
        completedByEmployeeId: done?.completedByEmployeeId ?? null,
        completedAt: done?.completedAt ?? null,
      });
    }
  }
  return result.sort((a, b) => a.description.localeCompare(b.description, 'es'));
}

/** Estado de una obligación para su responsable: propia, cubierta por otra persona o pendiente. */
export function occurrenceStatus(item: Occurrence): 'personal' | 'covered' | 'pending' {
  if (!item.completed) return 'pending';
  return item.completedByEmployeeId === item.assignedEmployeeId ? 'personal' : 'covered';
}

/**
 * Regla definitiva de Desempeño. El cumplimiento personal cuenta SOLO
 * obligaciones propias realizadas por la misma persona: una cobertura deja
 * la tarea terminada, no suma al numerador del responsable (sigue en su
 * denominador) ni al porcentaje de quien cubrió; se informa aparte como
 * cobertura recibida/realizada. Sin `employeeId`: totales del equipo.
 */
export function computeMetrics(occurrences: Occurrence[], employeeId?: string) {
  const own = employeeId
    ? occurrences.filter((item) => item.assignedEmployeeId === employeeId)
    : occurrences;
  const completedPersonally = own.filter((item) => occurrenceStatus(item) === 'personal').length;
  const coverageReceived = own.filter((item) => occurrenceStatus(item) === 'covered').length;
  const coverageGiven = employeeId
    ? occurrences.filter(
        (item) => occurrenceStatus(item) === 'covered' && item.completedByEmployeeId === employeeId,
      ).length
    : coverageReceived;
  const operationalCompleted = employeeId
    ? occurrences.filter((item) => item.completed && item.completedByEmployeeId === employeeId)
        .length
    : occurrences.filter((item) => item.completed).length;
  return {
    assigned: own.length,
    completedPersonally,
    percentage: percentage(completedPersonally, own.length),
    pending: own.filter((item) => !item.completed).length,
    coverageReceived,
    coverageGiven,
    operationalCompleted,
  };
}

export function percentage(completed: number, expected: number): number | null {
  return expected === 0 ? null : Math.round((completed / expected) * 1000) / 10;
}

export function computeDailyStreak(
  occurrences: Occurrence[],
  employeeId: string,
  today: LocalDate,
): number | null {
  // Racha personal: un día cuenta solo si la persona hizo ella misma todas sus diarias.
  const daily = occurrences.filter(
    (item) => item.frequency === 'DAILY' && item.assignedEmployeeId === employeeId,
  );
  const done = (item: Occurrence) => occurrenceStatus(item) === 'personal';
  if (daily.length === 0) return null;
  const byDay = new Map<string, Occurrence[]>();
  for (const item of daily) byDay.set(item.periodKey, [...(byDay.get(item.periodKey) ?? []), item]);
  let cursor = today;
  const todayItems = byDay.get(formatLocalDate(today));
  if (todayItems && !todayItems.every(done)) cursor = addDays(cursor, -1);
  let streak = 0;
  while (true) {
    const items = byDay.get(formatLocalDate(cursor));
    if (!items) {
      cursor = addDays(cursor, -1);
      if (compareLocalDates(cursor, parseLocalDate(daily[0]!.periodKey)!) < 0) break;
      continue;
    }
    if (!items.every(done)) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
