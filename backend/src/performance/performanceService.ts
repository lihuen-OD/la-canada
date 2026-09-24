import { config } from '../config';
import {
  EmployeeLinkRequiredError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError';
import { prisma } from '../lib/prisma';
import {
  addDays,
  compareLocalDates,
  formatLocalDate,
  parseLocalDate,
  startOfLocalDay,
  toLocalDate,
} from '../lib/businessTime';
import type { TaskActor } from '../tasks/tasksService';
import {
  buildRecurringOccurrences,
  computeDailyStreak,
  percentage,
  type Occurrence,
} from './performanceCalculator';

const MAX_RANGE_DAYS = 90;

function rangeOrThrow(fromText: string, toText: string, now: Date) {
  const from = parseLocalDate(fromText);
  const requestedTo = parseLocalDate(toText);
  if (!from || !requestedTo || compareLocalDates(from, requestedTo) > 0) {
    throw new ValidationError('El rango de fechas no es válido.');
  }
  const today = toLocalDate(now, config.businessTimeZone);
  if (compareLocalDates(from, today) > 0)
    throw new ValidationError('El rango no puede comenzar en el futuro.');
  const to = compareLocalDates(requestedTo, today) > 0 ? today : requestedTo;
  let count = 1;
  for (let day = from; compareLocalDates(day, to) < 0; day = addDays(day, 1)) count += 1;
  if (count > MAX_RANGE_DAYS)
    throw new ValidationError(`El rango no puede superar ${MAX_RANGE_DAYS} días.`);
  return { from, to, today };
}

const employeeSelect = { id: true, displayName: true, role: true, colorHex: true } as const;

function metricsFor(occurrences: Occurrence[], employeeId?: string) {
  const assigned = employeeId
    ? occurrences.filter((item) => item.assignedEmployeeId === employeeId)
    : occurrences;
  const completed = assigned.filter((item) => item.completed);
  const performed = employeeId
    ? occurrences.filter((item) => item.completedByEmployeeId === employeeId).length
    : occurrences.filter((item) => item.completed).length;
  const coveredOthers = employeeId
    ? occurrences.filter(
        (item) =>
          item.completedByEmployeeId === employeeId && item.assignedEmployeeId !== employeeId,
      ).length
    : occurrences.filter(
        (item) => item.completed && item.completedByEmployeeId !== item.assignedEmployeeId,
      ).length;
  const receivedHelp = employeeId
    ? occurrences.filter(
        (item) =>
          item.assignedEmployeeId === employeeId &&
          item.completed &&
          item.completedByEmployeeId !== employeeId,
      ).length
    : coveredOthers;
  return {
    expected: assigned.length,
    completed: completed.length,
    percentage: percentage(completed.length, assigned.length),
    performed,
    coveredOthers,
    receivedHelp,
  };
}

export async function getPerformance(
  actor: TaskActor,
  query: { from: string; to: string },
  requestedEmployeeId?: string,
  now = new Date(),
) {
  if (actor.role === 'EMPLOYEE' && !actor.employeeId) throw new EmployeeLinkRequiredError();
  if (actor.role === 'EMPLOYEE' && requestedEmployeeId && requestedEmployeeId !== actor.employeeId)
    throw new ForbiddenError();
  const scopedEmployeeId = actor.role === 'EMPLOYEE' ? actor.employeeId! : requestedEmployeeId;
  const { from, to, today } = rangeOrThrow(query.from, query.to, now);
  const timeZone = config.businessTimeZone;
  const rangeStart = startOfLocalDay(from, timeZone);
  const rangeEnd = startOfLocalDay(addDays(to, 1), timeZone);

  if (scopedEmployeeId) {
    const exists = await prisma.employee.findUnique({
      where: { id: scopedEmployeeId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Empleado no encontrado.');
  }

  const [employees, plans, executions, specialExecutions, urgentPending] = await Promise.all([
    prisma.employee.findMany({
      where: {},
      select: employeeSelect,
      orderBy: { displayName: 'asc' },
    }),
    prisma.taskPlanningInterval.findMany({
      where: {
        validFrom: { lt: rangeEnd },
        OR: [{ validTo: null }, { validTo: { gte: rangeStart } }],
      },
      select: {
        id: true,
        taskId: true,
        employeeId: true,
        frequency: true,
        validFrom: true,
        validTo: true,
        task: { select: { description: true } },
      },
      orderBy: { validFrom: 'asc' },
    }),
    prisma.taskExecution.findMany({
      where: {
        revertedAt: null,
        periodKey: { gte: formatLocalDate(from), lte: formatLocalDate(to) },
      },
      select: {
        id: true,
        taskId: true,
        periodKey: true,
        assignedEmployeeId: true,
        completedByEmployeeId: true,
        completedAt: true,
      },
    }),
    prisma.taskExecution.findMany({
      where: {
        revertedAt: null,
        completedAt: { gte: rangeStart, lt: rangeEnd },
        task: { frequency: { in: ['URGENT', 'ONE_TIME'] } },
      },
      select: { task: { select: { frequency: true } }, completedByEmployeeId: true },
    }),
    prisma.task.count({
      where: {
        active: true,
        frequency: 'URGENT',
        ...(scopedEmployeeId ? { employeeId: scopedEmployeeId } : {}),
        executions: { none: { revertedAt: null } },
      },
    }),
  ]);

  const occurrences = buildRecurringOccurrences({
    plans: plans.map((plan) => ({ ...plan, description: plan.task.description })),
    executions: executions
      .filter(
        (
          execution,
        ): execution is typeof execution & {
          completedAt: Date;
          completedByEmployeeId: string;
        } => execution.completedAt !== null && execution.completedByEmployeeId !== null,
      )
      .map((execution) => ({ ...execution })),
    from,
    to,
    today,
    now,
    timeZone,
  });
  const visibleOccurrences = scopedEmployeeId
    ? occurrences.filter(
        (item) =>
          item.assignedEmployeeId === scopedEmployeeId ||
          item.completedByEmployeeId === scopedEmployeeId,
      )
    : occurrences;
  const special = {
    urgentCompleted: specialExecutions.filter(
      (row) =>
        row.task.frequency === 'URGENT' &&
        (!scopedEmployeeId || row.completedByEmployeeId === scopedEmployeeId),
    ).length,
    oneTimeCompleted: specialExecutions.filter(
      (row) =>
        row.task.frequency === 'ONE_TIME' &&
        (!scopedEmployeeId || row.completedByEmployeeId === scopedEmployeeId),
    ).length,
    urgentPending,
  };

  const visibleEmployees = scopedEmployeeId
    ? employees.filter((employee) => employee.id === scopedEmployeeId)
    : employees;
  const employeeMetrics = visibleEmployees.map((employee) => ({
    employee,
    ...metricsFor(visibleOccurrences, employee.id),
    dailyStreak: computeDailyStreak(visibleOccurrences, employee.id, today),
  }));
  const team = metricsFor(visibleOccurrences);
  const trend = Array.from(new Set(visibleOccurrences.map((item) => item.periodKey)))
    .sort()
    .map((periodKey) => {
      const rows = visibleOccurrences.filter((item) => item.periodKey === periodKey);
      const completed = rows.filter((item) => item.completed).length;
      return {
        periodKey,
        expected: rows.length,
        completed,
        percentage: percentage(completed, rows.length),
      };
    });

  return {
    range: {
      from: formatLocalDate(from),
      to: formatLocalDate(to),
      timeZone,
      includesCurrentDay: compareLocalDates(to, today) === 0,
      maxDays: MAX_RANGE_DAYS,
    },
    team,
    special,
    employees: employeeMetrics,
    trend,
    occurrences:
      requestedEmployeeId || actor.role === 'EMPLOYEE'
        ? visibleOccurrences.map((item) => ({
            ...item,
            assignedEmployee:
              actor.role === 'ADMIN' || item.assignedEmployeeId === scopedEmployeeId
                ? (employees.find((employee) => employee.id === item.assignedEmployeeId) ?? null)
                : null,
            completedByEmployee:
              actor.role === 'ADMIN' || item.completedByEmployeeId === scopedEmployeeId
                ? (employees.find((employee) => employee.id === item.completedByEmployeeId) ?? null)
                : null,
            completedAt: item.completedAt?.toISOString() ?? null,
          }))
        : undefined,
  };
}
