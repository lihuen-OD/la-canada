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
  SECOND_HALF_FIRST_DAY,
  URGENT_PERIOD_KEY,
  addDays,
  annualPeriodKey,
  bimonthlyPeriodKey,
  compareLocalDates,
  formatLocalDate,
  isBimesterStart,
  computePeriodKey,
  parseLocalDate,
  semiMonthlyPeriodKey,
  startOfLocalDay,
  toLocalDate,
  type LocalDate,
} from '../lib/businessTime';
import { canRevertExecution, lateCompletionBounds } from '../tasks/completionRules';
import { scheduledDateText } from '../tasks/taskSchedule';
import type { TaskActor } from '../tasks/tasksService';
import {
  buildRecurringOccurrences,
  buildSingleOccurrences,
  computeMetrics,
  occurrenceStatus,
  percentage,
  type Occurrence,
} from './performanceCalculator';

/** Únicos rangos públicos de Desempeño (chips "7 días", "14 días", "30 días"). */
export const PERFORMANCE_RANGE_DAYS = [7, 14, 30] as const;
const MAX_RANGE_DAYS = 30;
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

export function rangeOrThrow(fromText: string, toText: string, now: Date) {
  const from = parseLocalDate(fromText);
  const requestedTo = parseLocalDate(toText);
  if (!from || !requestedTo || compareLocalDates(from, requestedTo) > 0) {
    throw new ValidationError('El rango de fechas no es válido.');
  }
  const today = toLocalDate(now, config.businessTimeZone);
  if (compareLocalDates(from, today) > 0)
    throw new ValidationError('El rango no puede comenzar en el futuro.');
  // El largo pedido (desde–hasta inclusive) debe ser exactamente 7, 14 o 30 días.
  let span = 1;
  for (let day = from; compareLocalDates(day, requestedTo) < 0 && span <= MAX_RANGE_DAYS;) {
    day = addDays(day, 1);
    span += 1;
  }
  if (!(PERFORMANCE_RANGE_DAYS as readonly number[]).includes(span))
    throw new ValidationError('El rango debe ser de 7, 14 o 30 días.');
  const to = compareLocalDates(requestedTo, today) > 0 ? today : requestedTo;
  return { from, to, today };
}

/**
 * Claves de las quincenas (`YYYY-MM-Q1/Q2`, día 1 o 16), bimestres
 * (`YYYY-B1…B6`, el 1 de un mes impar) y años (`YYYY-A`, el 1/1) que
 * EMPIEZAN dentro del rango — las mismas que genera
 * `buildRecurringOccurrences`. No son fechas, así que no entran en el filtro
 * `gte/lte` de las claves diarias.
 */
export function calendarKeysInRange(from: LocalDate, to: LocalDate): string[] {
  const keys: string[] = [];
  for (let day = from; compareLocalDates(day, to) <= 0; day = addDays(day, 1)) {
    if (day.day === 1 || day.day === SECOND_HALF_FIRST_DAY) keys.push(semiMonthlyPeriodKey(day));
    if (isBimesterStart(day)) keys.push(bimonthlyPeriodKey(day));
    if (day.day === 1 && day.month === 1) keys.push(annualPeriodKey(day));
  }
  return keys;
}

const employeeSelect = { id: true, displayName: true, role: true, colorHex: true } as const;

/**
 * Ventana de «Marcar como realizada» (carga olvidada): el rango público más
 * largo de Desempeño (30 días) hasta hoy, en `BUSINESS_TIME_ZONE`. Es lo que
 * el detalle puede mostrar; no amplía los rangos.
 */
export function lateCompletionWindow(now: Date) {
  const today = toLocalDate(now, config.businessTimeZone);
  return { from: addDays(today, -(MAX_RANGE_DAYS - 1)), to: today, today };
}

/**
 * ÚNICA lectura de las obligaciones de Tareas: la planificación que se
 * superpone con el rango y las ejecuciones vigentes de sus períodos. La usan
 * Desempeño (todas las tareas) y la carga olvidada (una tarea, `taskId`), así
 * que las dos validan exactamente las mismas obligaciones.
 */
export async function loadObligationInputs(
  range: { from: LocalDate; to: LocalDate; rangeStart: Date; rangeEnd: Date },
  taskId?: string,
) {
  const timeZone = config.businessTimeZone;
  const { from, to, rangeStart, rangeEnd } = range;
  const ofTask = taskId ? { taskId } : {};
  const planOverlapsRange = {
    validFrom: { lt: rangeEnd },
    OR: [{ validTo: null }, { validTo: { gte: rangeStart } }],
  };
  const [plans, executions] = await Promise.all([
    prisma.taskPlanningInterval.findMany({
      where: { ...planOverlapsRange, ...ofTask },
      select: {
        id: true,
        taskId: true,
        employeeId: true,
        frequency: true,
        scheduledDate: true,
        validFrom: true,
        validTo: true,
        task: { select: { description: true } },
      },
      orderBy: { validFrom: 'asc' },
    }),
    // Una sola sentencia: las ejecuciones vigentes de los períodos del rango
    // (fechas, quincenas, bimestres y años) y, para URGENT/ONE_TIME, la finalización vigente
    // (a lo sumo una por tarea) de las tareas planificadas en el rango — hace
    // falta aunque sea anterior al rango, para saber que ya no estaba pendiente.
    prisma.taskExecution.findMany({
      where: {
        revertedAt: null,
        ...ofTask,
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
          { periodKey: { in: calendarKeysInRange(from, to) } },
        ],
      },
      select: {
        id: true,
        taskId: true,
        periodKey: true,
        assignedEmployeeId: true,
        completedByEmployeeId: true,
        completedAt: true,
        performedOn: true,
        recordedByUserId: true,
      },
    }),
  ]);

  // Una «Una vez» con fecha recién es exigible desde el primer instante de ese
  // día de negocio, según la versión de planificación de cada momento.
  const planRows = plans.map(({ scheduledDate, ...plan }) => {
    const text = scheduledDateText(scheduledDate ?? null);
    const due = text ? parseLocalDate(text) : null;
    return {
      ...plan,
      description: plan.task.description,
      scheduledDate: text,
      dueFrom: due ? startOfLocalDay(due, timeZone) : null,
    };
  });
  const completedExecutions = executions.filter(
    (
      execution,
    ): execution is typeof execution & { completedAt: Date; completedByEmployeeId: string } =>
      execution.completedAt !== null && execution.completedByEmployeeId !== null,
  );
  return { planRows, executions: completedExecutions };
}

type ObligationInputs = Awaited<ReturnType<typeof loadObligationInputs>>;

/**
 * Datos de acción del detalle de Tareas → Desempeño, calculados acá (el
 * frontend no decide nada): `lateCompletion` = la obligación pendiente se
 * puede registrar ahora como realizada, con sus fechas admitidas;
 * `completeInTasks` = una «Una vez» o urgente pendiente se completa con su
 * flujo normal, en Tareas; `lateRegistration` = la ejecución fue una carga
 * olvidada (fecha real, momento del registro y si quien mira la puede
 * deshacer).
 */
function detailActions(inputs: ObligationInputs, actor: TaskActor, now: Date) {
  const timeZone = config.businessTimeZone;
  const { from: windowFrom, today } = lateCompletionWindow(now);
  const executionByKey = new Map(
    inputs.executions.map((row) => [`${row.taskId}:${row.periodKey}`, row]),
  );
  return (item: Occurrence) => {
    const execution = executionByKey.get(`${item.taskId}:${item.periodKey}`);
    const plans = inputs.planRows.filter((plan) => plan.taskId === item.taskId);
    if (item.completed) {
      if (!execution?.performedOn) return {};
      const currentFrequency = plans.at(-1)?.frequency ?? item.frequency;
      return {
        lateRegistration: {
          executionId: execution.id,
          performedOn: scheduledDateText(execution.performedOn)!,
          recordedAt: execution.completedAt.toISOString(),
          canRevert: canRevertExecution(
            actor,
            { ...execution, completedByEmployee: { id: execution.completedByEmployeeId } },
            computePeriodKey(currentFrequency, now, timeZone),
            today,
            timeZone,
          ),
        },
      };
    }
    if (item.frequency === 'URGENT' || item.frequency === 'ONE_TIME') {
      const active = plans.some((plan) => plan.validTo === null);
      const canComplete = actor.role === 'ADMIN' || actor.employeeId !== null;
      return active && !execution && canComplete ? { completeInTasks: true as const } : {};
    }
    const mayRegister = actor.role === 'ADMIN' || item.assignedEmployeeId === actor.employeeId;
    const bounds = mayRegister
      ? lateCompletionBounds({ occurrence: item, plans, windowFrom, today, now, timeZone })
      : null;
    return bounds ? { lateCompletion: bounds } : {};
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

  const [employees, inputs, urgentPending] = await Promise.all([
    prisma.employee.findMany({
      where: {},
      select: employeeSelect,
      orderBy: { displayName: 'asc' },
    }),
    loadObligationInputs({ from, to, rangeStart, rangeEnd }),
    prisma.task.count({
      where: {
        active: true,
        frequency: 'URGENT',
        ...(scopedEmployeeId ? { employeeId: scopedEmployeeId } : {}),
        executions: { none: { revertedAt: null } },
      },
    }),
  ]);

  const occurrences = [
    ...buildRecurringOccurrences({
      plans: inputs.planRows,
      executions: inputs.executions,
      from,
      to,
      today,
      now,
      timeZone,
    }),
    ...buildSingleOccurrences({
      plans: inputs.planRows,
      executions: inputs.executions,
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

  const actionsOf = detailActions(inputs, actor, now);
  return {
    // `today` y `generatedAt`: fecha de negocio y hora del servidor, para que
    // el reloj del día del frontend no dé por empezado un día que el backend
    // todavía no alcanzó (docs/ARCHITECTURE.md §39.1).
    generatedAt: now.toISOString(),
    range: {
      from: formatLocalDate(from),
      to: formatLocalDate(to),
      today: formatLocalDate(today),
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
            ...actionsOf(item),
          }))
        : undefined,
  };
}
