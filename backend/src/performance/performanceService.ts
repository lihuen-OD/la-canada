import { config } from '../config';
import {
  EmployeeLinkRequiredError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError';
import { prisma } from '../lib/prisma';
import {
  ONE_TIME_PERIOD_KEY,
  URGENT_PERIOD_KEY,
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
  buildSingleOccurrences,
  computeDailyStreak,
  computeMetrics,
  occurrenceStatus,
  percentage,
} from './performanceCalculator';

const MAX_RANGE_DAYS = 90;
/** Rango con el que abre Tareas → Desempeño (chip "7 días") y que usa Inicio. */
export const DEFAULT_RANGE_DAYS = 7;

/** Últimos `DEFAULT_RANGE_DAYS` días hasta hoy, en `BUSINESS_TIME_ZONE`. */
export function defaultPerformanceRange(now = new Date()) {
  const today = toLocalDate(now, config.businessTimeZone);
  return {
    from: formatLocalDate(addDays(today, -(DEFAULT_RANGE_DAYS - 1))),
    to: formatLocalDate(today),
  };
}

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

  const planOverlapsRange = {
    validFrom: { lt: rangeEnd },
    OR: [{ validTo: null }, { validTo: { gte: rangeStart } }],
  };
  const [employees, plans, executions, urgentPending] = await Promise.all([
    prisma.employee.findMany({
      where: {},
      select: employeeSelect,
      orderBy: { displayName: 'asc' },
    }),
    prisma.taskPlanningInterval.findMany({
      where: planOverlapsRange,
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
    // Una sola sentencia: las ejecuciones vigentes de los períodos del rango
    // y, para URGENT/ONE_TIME, la finalización vigente (a lo sumo una por
    // tarea) de las tareas planificadas en el rango — hace falta aunque sea
    // anterior al rango, para saber que ya no estaba pendiente.
    prisma.taskExecution.findMany({
      where: {
        revertedAt: null,
        OR: [
          { periodKey: { gte: formatLocalDate(from), lte: formatLocalDate(to) } },
          {
            periodKey: { in: [URGENT_PERIOD_KEY, ONE_TIME_PERIOD_KEY] },
            task: {
              planningIntervals: {
                some: { ...planOverlapsRange, frequency: { in: ['URGENT', 'ONE_TIME'] } },
              },
            },
          },
        ],
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
    prisma.task.count({
      where: {
        active: true,
        frequency: 'URGENT',
        ...(scopedEmployeeId ? { employeeId: scopedEmployeeId } : {}),
        executions: { none: { revertedAt: null } },
      },
    }),
  ]);

  const planRows = plans.map((plan) => ({ ...plan, description: plan.task.description }));
  const completedExecutions = executions.filter(
    (
      execution,
    ): execution is typeof execution & { completedAt: Date; completedByEmployeeId: string } =>
      execution.completedAt !== null && execution.completedByEmployeeId !== null,
  );
  const occurrences = [
    ...buildRecurringOccurrences({
      plans: planRows,
      executions: completedExecutions,
      from,
      to,
      today,
      now,
      timeZone,
    }),
    ...buildSingleOccurrences({
      plans: planRows,
      executions: completedExecutions,
      rangeStart,
      rangeEnd,
      now,
    }),
  ];
  const visibleOccurrences = scopedEmployeeId
    ? occurrences.filter(
        (item) =>
          item.assignedEmployeeId === scopedEmployeeId ||
          item.completedByEmployeeId === scopedEmployeeId,
      )
    : occurrences;
  const completedInRange = (frequency: 'URGENT' | 'ONE_TIME') =>
    visibleOccurrences.filter(
      (item) =>
        item.frequency === frequency &&
        item.completedAt !== null &&
        item.completedAt.getTime() >= rangeStart.getTime() &&
        (!scopedEmployeeId || item.completedByEmployeeId === scopedEmployeeId),
    ).length;
  const special = {
    urgentCompleted: completedInRange('URGENT'),
    oneTimeCompleted: completedInRange('ONE_TIME'),
    urgentPending,
  };

  const visibleEmployees = scopedEmployeeId
    ? employees.filter((employee) => employee.id === scopedEmployeeId)
    : employees;
  const employeeMetrics = visibleEmployees.map((employee) => ({
    employee,
    ...computeMetrics(visibleOccurrences, employee.id),
    dailyStreak: computeDailyStreak(visibleOccurrences, employee.id, today),
  }));
  const team = computeMetrics(visibleOccurrences);
  // Tendencia por período recurrente (las únicas/urgentes no tienen período),
  // con el mismo criterio personal que el porcentaje.
  const recurringVisible = visibleOccurrences.filter(
    (item) => item.periodKey !== URGENT_PERIOD_KEY && item.periodKey !== ONE_TIME_PERIOD_KEY,
  );
  const trend = Array.from(new Set(recurringVisible.map((item) => item.periodKey)))
    .sort()
    .map((periodKey) => {
      const rows = recurringVisible.filter((item) => item.periodKey === periodKey);
      const completedPersonally = rows.filter(
        (item) => occurrenceStatus(item) === 'personal',
      ).length;
      return {
        periodKey,
        assigned: rows.length,
        completedPersonally,
        percentage: percentage(completedPersonally, rows.length),
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
            status: occurrenceStatus(item),
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
