import type { TaskFrequency } from '../generated/prisma/enums';
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
  nextBimesterStart,
  nextSemiMonthStart,
  parseLocalDate,
  semiMonthlyPeriodKey,
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
  /**
   * Solo `ONE_TIME` con fecha para realizar en esta versión: la fecha
   * (`YYYY-MM-DD`) y el primer instante de ese día de negocio. Antes de
   * `dueFrom` la tarea no es exigible (no cuenta como pendiente ni vencida).
   */
  scheduledDate?: string | null;
  dueFrom?: Date | null;
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
 * Una obligación de una persona. Recurrentes: una por día/semana/quincena/
 * mes/bimestre/año planificado. URGENT y ONE_TIME: una sola por tarea
 * (`periodKey` fijo `URGENT`/`ONE_TIME`, el mismo que usa la ejecución).
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
  /** Solo una `ONE_TIME` con fecha: la de la versión de planificación que se usó. */
  scheduledDate?: string;
}

const RECURRING_FREQUENCIES = [
  'DAILY',
  'WEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'BIMONTHLY',
  'ANNUAL',
] as const;
type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

const recurring = (frequency: TaskFrequency): frequency is RecurringFrequency =>
  (RECURRING_FREQUENCIES as readonly TaskFrequency[]).includes(frequency);

/** ¿Empieza en `day` un período de `frequency`? Semana: lunes; quincena: 1 y 16; bimestre: el 1 de cada mes impar; año: 1/1. */
function startsPeriod(frequency: RecurringFrequency, day: LocalDate): boolean {
  switch (frequency) {
    case 'DAILY':
      return true;
    case 'WEEKLY':
      return compareLocalDates(day, startOfWeek(day)) === 0;
    case 'SEMI_MONTHLY':
      return day.day === 1 || day.day === SECOND_HALF_FIRST_DAY;
    case 'MONTHLY':
      return day.day === 1;
    case 'BIMONTHLY':
      return isBimesterStart(day);
    case 'ANNUAL':
      return day.day === 1 && day.month === 1;
  }
}

/** Primer día del período siguiente al que empieza en `day`. */
function nextPeriodStart(frequency: RecurringFrequency, day: LocalDate): LocalDate {
  switch (frequency) {
    case 'DAILY':
      return addDays(day, 1);
    case 'WEEKLY':
      return addDays(day, 7);
    case 'SEMI_MONTHLY':
      return nextSemiMonthStart(day);
    case 'MONTHLY':
      return {
        year: day.month === 12 ? day.year + 1 : day.year,
        month: (day.month % 12) + 1,
        day: 1,
      };
    case 'BIMONTHLY':
      return nextBimesterStart(day);
    case 'ANNUAL':
      return { year: day.year + 1, month: 1, day: 1 };
  }
}

/** Clave del período que empieza en `day`: la fecha, o la propia de quincena/bimestre/año (nunca una fecha). */
function periodKeyAt(frequency: RecurringFrequency, day: LocalDate): string {
  if (frequency === 'SEMI_MONTHLY') return semiMonthlyPeriodKey(day);
  if (frequency === 'BIMONTHLY') return bimonthlyPeriodKey(day);
  if (frequency === 'ANNUAL') return annualPeriodKey(day);
  return formatLocalDate(day);
}

/** Primer día del período de `periodKey`, sin validar que realmente empiece un período ese día. */
function periodKeyStart(frequency: RecurringFrequency, periodKey: string): LocalDate | null {
  const number = (value: string | undefined) => Number(value);
  if (frequency === 'SEMI_MONTHLY') {
    const match = /^(\d{4})-(\d{2})-Q([12])$/.exec(periodKey);
    if (!match) return null;
    const day = match[3] === '1' ? 1 : SECOND_HALF_FIRST_DAY;
    return parseLocalDate(`${match[1]}-${match[2]}-${String(day).padStart(2, '0')}`);
  }
  if (frequency === 'BIMONTHLY') {
    const match = /^(\d{4})-B([1-6])$/.exec(periodKey);
    return match ? { year: number(match[1]), month: number(match[2]) * 2 - 1, day: 1 } : null;
  }
  if (frequency === 'ANNUAL') {
    const match = /^(\d{4})-A$/.exec(periodKey);
    return match ? { year: number(match[1]), month: 1, day: 1 } : null;
  }
  return parseLocalDate(periodKey);
}

/**
 * Primer y último día del período `periodKey` de una recurrente: las mismas
 * claves que genera `buildRecurringOccurrences` (una semanal que no empieza en
 * lunes, una mensual que no empieza el 1, etc. no son claves válidas → `null`).
 * URGENT y ONE_TIME no tienen período → `null`.
 */
export function periodBounds(
  frequency: TaskFrequency,
  periodKey: string,
): { start: LocalDate; end: LocalDate } | null {
  if (!recurring(frequency)) return null;
  const start = periodKeyStart(frequency, periodKey);
  if (!start || !startsPeriod(frequency, start) || periodKeyAt(frequency, start) !== periodKey) {
    return null;
  }
  return { start, end: addDays(nextPeriodStart(frequency, start), -1) };
}

/**
 * Último instante que decide la planificación de un período (el mismo corte
 * que `buildRecurringOccurrences`): `now` si el período está en curso, o el
 * primer instante del período siguiente si ya cerró.
 */
export function periodCutoff(
  frequency: TaskFrequency,
  start: LocalDate,
  today: LocalDate,
  now: Date,
  timeZone: string,
): Date | null {
  return recurring(frequency) ? cutoffOf(frequency, start, today, now, timeZone) : null;
}

function cutoffOf(
  frequency: RecurringFrequency,
  start: LocalDate,
  today: LocalDate,
  now: Date,
  timeZone: string,
): Date {
  const next = nextPeriodStart(frequency, start);
  const current = compareLocalDates(start, today) <= 0 && compareLocalDates(today, next) < 0;
  return current ? now : startOfLocalDay(next, timeZone);
}

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
 * Cada período entra si su primer día cae en el rango (la quincena, el 1 o
 * el 16; el bimestre, el 1 de ene/mar/may/jul/sep/nov; el año, el 1/1 —
 * igual que la mensual el 1); quincenales, bimestrales y anuales usan su
 * propia clave (`YYYY-MM-Q1/Q2`, `YYYY-B1…B6`, `YYYY-A`), así que nunca toman
 * una ejecución de otra frecuencia.
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
  // `start` ordena por el primer día del período (una clave `YYYY-MM-Q2`
  // quedaría, como texto, después de todas las fechas de su mes).
  const result: { start: string; occurrence: Occurrence }[] = [];
  const seen = new Set<string>();

  for (const day of periodStarts(input.from, input.to)) {
    for (const rows of byTask.values()) {
      for (const frequency of RECURRING_FREQUENCIES) {
        if (!startsPeriod(frequency, day)) continue;

        const cutoff = cutoffOf(frequency, day, input.today, input.now, input.timeZone);
        if (cutoff.getTime() > input.now.getTime()) continue;

        const candidates = rows.filter(
          (plan) =>
            plan.validFrom.getTime() < cutoff.getTime() &&
            (plan.validTo === null || plan.validTo.getTime() >= cutoff.getTime()),
        );
        const plan = candidates.at(-1);
        if (!plan || !recurring(plan.frequency) || plan.frequency !== frequency) continue;

        const start = formatLocalDate(day);
        const periodKey = periodKeyAt(frequency, day);
        const key = `${plan.taskId}:${periodKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const execution = executionByKey.get(key);
        result.push({
          start,
          occurrence: {
            taskId: plan.taskId,
            description: plan.description,
            frequency,
            periodKey,
            assignedEmployeeId: execution?.assignedEmployeeId ?? plan.employeeId,
            completed: Boolean(execution),
            completedByEmployeeId: execution?.completedByEmployeeId ?? null,
            completedAt: execution?.completedAt ?? null,
          },
        });
      }
    }
  }
  return result
    .sort(
      (a, b) =>
        a.start.localeCompare(b.start) ||
        a.occurrence.description.localeCompare(b.occurrence.description, 'es'),
    )
    .map((row) => row.occurrence);
}

const SINGLE_KEYS = [
  ['URGENT', URGENT_PERIOD_KEY],
  ['ONE_TIME', ONE_TIME_PERIOD_KEY],
] as const;

/**
 * ¿Es exigible en `at` una `ONE_TIME`? Manda la última versión de su
 * planificación que ya había empezado (también en un hueco, p. ej. mientras
 * estuvo desactivada): con fecha, recién desde el primer instante de ese día.
 */
function exigibleAt(plans: PlanningRow[], at: number): boolean {
  const plan = plans.filter((row) => row.validFrom.getTime() <= at).at(-1);
  return !plan?.dueFrom || plan.dueFrom.getTime() <= at;
}

/**
 * Último instante de `[from, to]` en que la tarea estuvo pendiente y ya era
 * exigible, o `null` si nunca lo fue. La exigibilidad solo cambia al empezar
 * una versión de planificación o al llegar una fecha para realizar, así que
 * alcanza con mirar esos puntos.
 */
function lastExigibleInstant(plans: PlanningRow[], from: number, to: number): number | null {
  if (from > to) return null;
  const points = plans.flatMap((plan) =>
    plan.dueFrom ? [plan.validFrom.getTime(), plan.dueFrom.getTime()] : [plan.validFrom.getTime()],
  );
  const starts = Array.from(
    new Set([from, ...points.filter((point) => point > from && point <= to)]),
  ).sort((a, b) => a - b);
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    if (exigibleAt(plans, starts[index]!)) {
      return index === starts.length - 1 ? to : starts[index + 1]! - 1;
    }
  }
  return null;
}

/**
 * URGENT y ONE_TIME: cada tarea es UNA obligación, nunca una por día/semana.
 * Su ventana va desde la primera planificación con esa frecuencia hasta la
 * finalización vigente (o, si sigue pendiente, hasta el cierre de la última
 * planificación). Entra al rango si esa ventana se superpone con él: creada
 * después del rango o completada antes de empezar → no entra; completada
 * durante el rango o pendiente en alguna parte → entra una sola vez. El
 * responsable es el snapshot de la ejecución; si sigue pendiente, el de la
 * planificación vigente al cierre de la ventana dentro del rango.
 *
 * Una `ONE_TIME` con fecha para realizar solo cuenta como pendiente donde ya
 * era exigible según la versión de planificación de cada momento: programada
 * para más adelante no entra; vencida, sí. Reprogramarla abre otra versión,
 * así que lo esperado en rangos anteriores no cambia, y sigue siendo UNA sola
 * obligación. Completada (antes, el día o después de la fecha) entra en el
 * rango de su finalización, igual que sin fecha. Sin fecha: exactamente la
 * regla de siempre.
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

      let cutoff = Math.min(
        end?.getTime() ?? Infinity,
        input.rangeEnd.getTime(),
        input.now.getTime(),
      );
      // Completada después de terminar el rango: dentro del rango seguía pendiente.
      const done =
        execution && execution.completedAt.getTime() < input.rangeEnd.getTime() ? execution : null;
      if (!done && plans.some((row) => row.dueFrom)) {
        const lastDue = lastExigibleInstant(
          plans,
          Math.max(start.getTime(), input.rangeStart.getTime()),
          Math.min(end?.getTime() ?? Infinity, input.rangeEnd.getTime() - 1, input.now.getTime()),
        );
        if (lastDue === null) continue;
        cutoff = lastDue;
      }
      const plan = plans.filter((row) => row.validFrom.getTime() <= cutoff).at(-1) ?? plans.at(-1)!;
      result.push({
        taskId,
        description: plan.description,
        frequency,
        periodKey,
        assignedEmployeeId: done?.assignedEmployeeId ?? plan.employeeId,
        completed: Boolean(done),
        completedByEmployeeId: done?.completedByEmployeeId ?? null,
        completedAt: done?.completedAt ?? null,
        ...(plan.scheduledDate ? { scheduledDate: plan.scheduledDate } : {}),
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
