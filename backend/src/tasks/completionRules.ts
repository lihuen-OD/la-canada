import type { TaskFrequency } from '../generated/prisma/enums';
import {
  ONE_TIME_PERIOD_KEY,
  URGENT_PERIOD_KEY,
  addDays,
  compareLocalDates,
  formatLocalDate,
  parseLocalDate,
  startOfLocalDay,
  toLocalDate,
  type LocalDate,
} from '../lib/businessTime';
import {
  periodBounds,
  periodCutoff,
  type Occurrence,
  type PlanningRow,
} from '../performance/performanceCalculator';
import { scheduledDateText } from './taskSchedule';

/**
 * Reglas puras de las finalizaciones de Tareas que comparten Tareas,
 * Historial y Desempeño: quién puede deshacer, qué frecuencia tenía una
 * ejecución cuando se registró y la carga olvidada («Marcar como realizada»
 * desde Desempeño → Detalle). Ver docs/BUSINESS_RULES.md, "Tareas realizadas
 * que se olvidaron marcar".
 */

type Plan = Pick<PlanningRow, 'taskId' | 'frequency' | 'validFrom' | 'validTo'>;

export interface CompletionActor {
  userId: string;
  role: 'ADMIN' | 'EMPLOYEE';
  employeeId: string | null;
}

export interface RevertableExecution {
  periodKey: string;
  completedAt: Date | null;
  performedOn: Date | null;
  recordedByUserId: string | null;
  completedByEmployee: { id: string } | null;
}

/**
 * Un ADMIN corrige cualquier ejecución vigente (con motivo). Un EMPLOYEE
 * deshace solo lo que realizó él mismo: en el período vigente de la tarea, o
 * una carga olvidada que registró él, el mismo día de negocio en que la
 * cargó (para corregir un error al registrarla). Nunca cualquier ejecución
 * antigua.
 */
export function canRevertExecution(
  actor: CompletionActor,
  execution: RevertableExecution,
  currentPeriodKey: string,
  today: LocalDate,
  timeZone: string,
): boolean {
  if (actor.role === 'ADMIN') return true;
  if (actor.employeeId === null || execution.completedByEmployee?.id !== actor.employeeId) {
    return false;
  }
  if (execution.periodKey === currentPeriodKey) return true;
  return (
    execution.performedOn !== null &&
    execution.recordedByUserId === actor.userId &&
    execution.completedAt !== null &&
    compareLocalDates(toLocalDate(execution.completedAt, timeZone), today) === 0
  );
}

/** ¿Es `periodKey` una clave de `frequency`? (`URGENT`/`ONE_TIME` fijas; recurrentes con su forma y su día de inicio). */
function keyFits(frequency: TaskFrequency, periodKey: string): boolean {
  if (frequency === 'URGENT') return periodKey === URGENT_PERIOD_KEY;
  if (frequency === 'ONE_TIME') return periodKey === ONE_TIME_PERIOD_KEY;
  return periodBounds(frequency, periodKey) !== null;
}

/** Frecuencia que se deduce solo de la forma de la clave (una fecha sola es ambigua: diaria). */
function frequencyFromKey(periodKey: string): TaskFrequency {
  if (periodKey === URGENT_PERIOD_KEY) return 'URGENT';
  if (periodKey === ONE_TIME_PERIOD_KEY) return 'ONE_TIME';
  if (/-Q[12]$/.test(periodKey)) return 'SEMI_MONTHLY';
  if (/-B[1-6]$/.test(periodKey)) return 'BIMONTHLY';
  if (/-A$/.test(periodKey)) return 'ANNUAL';
  return 'DAILY';
}

/**
 * Frecuencia con la que se registró una ejecución — nunca solo la actual de
 * la tarea: la de su planificación (`TaskPlanningInterval`) en ese momento.
 * Flujo normal: al registrarla (`completedAt`), que es cuando el backend
 * calculó su clave. Carga olvidada: el último instante del día en que se
 * realizó (sin pasar del registro), que cae dentro de la planificación que
 * definió esa obligación. Si la planificación no alcanza o no coincide con la
 * clave (datos anteriores al historial), la frecuencia actual y, si tampoco
 * coincide, la que indica la forma de la clave.
 */
export function executionFrequency(
  plans: Pick<Plan, 'frequency' | 'validFrom'>[],
  execution: { periodKey: string; completedAt: Date | null; performedOn: Date | null },
  currentFrequency: TaskFrequency,
  timeZone: string,
): TaskFrequency {
  const performedOn = execution.performedOn
    ? parseLocalDate(scheduledDateText(execution.performedOn) ?? '')
    : null;
  const completedAt = execution.completedAt?.getTime() ?? Infinity;
  const reference = performedOn
    ? Math.min(startOfLocalDay(addDays(performedOn, 1), timeZone).getTime() - 1, completedAt)
    : completedAt;
  const plan = plans
    .filter((row) => row.validFrom.getTime() <= reference)
    .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime())
    .at(-1);
  for (const candidate of [plan?.frequency, currentFrequency]) {
    if (candidate && keyFits(candidate, execution.periodKey)) return candidate;
  }
  return frequencyFromKey(execution.periodKey);
}

/** Límites de la fecha de realización de una carga olvidada (`YYYY-MM-DD`, en `BUSINESS_TIME_ZONE`). */
export interface LateCompletionBounds {
  periodStart: string;
  periodEnd: string;
  /** Primer día admitido: el inicio del período o, si empezó después, el día en que la tarea tuvo esa frecuencia. */
  earliest: string;
  /** Último día admitido: el fin del período o hoy (nunca una fecha futura). */
  latest: string;
}

/**
 * ¿Se puede registrar ahora como realizada esta obligación de Desempeño, y
 * entre qué fechas? Solo recurrentes pendientes cuyo período EMPIEZA en la
 * ventana (`windowFrom`…hoy: el rango más largo de Desempeño), con las mismas
 * obligaciones que calcula `buildRecurringOccurrences` (responsable y
 * frecuencia históricos). URGENT y ONE_TIME no tienen período: se completan
 * en Tareas. La fecha va del primer día en que la tarea tuvo esa frecuencia
 * dentro del período (creada o cambiada de frecuencia a mitad de período)
 * hasta el último día del período o hoy. Una desactivación posterior no la
 * invalida: lo que cuenta es la planificación de ese período.
 */
export function lateCompletionBounds(input: {
  occurrence: Pick<Occurrence, 'taskId' | 'frequency' | 'periodKey' | 'completed'>;
  plans: Plan[];
  windowFrom: LocalDate;
  today: LocalDate;
  now: Date;
  timeZone: string;
}): LateCompletionBounds | null {
  const { occurrence, today } = input;
  if (occurrence.completed) return null;
  const bounds = periodBounds(occurrence.frequency, occurrence.periodKey);
  if (!bounds) return null;
  if (
    compareLocalDates(bounds.start, input.windowFrom) < 0 ||
    compareLocalDates(bounds.start, today) > 0
  ) {
    return null;
  }
  const cutoff = periodCutoff(occurrence.frequency, bounds.start, today, input.now, input.timeZone);
  if (!cutoff) return null;
  const periodStartsAt = startOfLocalDay(bounds.start, input.timeZone).getTime();
  const firstPlanned = input.plans
    .filter(
      (plan) =>
        plan.taskId === occurrence.taskId &&
        plan.frequency === occurrence.frequency &&
        plan.validFrom.getTime() < cutoff.getTime() &&
        (plan.validTo === null || plan.validTo.getTime() > periodStartsAt),
    )
    .reduce<Date | null>(
      (first, plan) => (first === null || plan.validFrom < first ? plan.validFrom : first),
      null,
    );
  if (!firstPlanned) return null;
  const plannedDay = toLocalDate(firstPlanned, input.timeZone);
  const earliest = compareLocalDates(plannedDay, bounds.start) > 0 ? plannedDay : bounds.start;
  const latest = compareLocalDates(bounds.end, today) < 0 ? bounds.end : today;
  if (compareLocalDates(earliest, latest) > 0) return null;
  return {
    periodStart: formatLocalDate(bounds.start),
    periodEnd: formatLocalDate(bounds.end),
    earliest: formatLocalDate(earliest),
    latest: formatLocalDate(latest),
  };
}
