import { config } from '../config';
import { ForbiddenError, GardenParticipantNotFoundError } from '../errors/AppError';
import { prisma } from '../lib/prisma';
import {
  ONE_TIME_PERIOD_KEY,
  URGENT_PERIOD_KEY,
  addDays,
  compareLocalDates,
  formatLocalDate,
  parseLocalDate,
  startOfLocalDay,
} from '../lib/businessTime';
import { scheduledDateText } from '../tasks/taskSchedule';
import {
  buildRecurringOccurrences,
  buildSingleOccurrences,
  computeMetrics,
  occurrenceStatus,
  type Occurrence,
} from '../performance/performanceCalculator';
import { calendarKeysInRange, rangeOrThrow } from '../performance/performanceService';
import { loadParticipantDirectory, type GardenActor } from './gardenParticipants';

/**
 * 🥬 Huerta — Desempeño PROPIO (nunca el general ni Inicio). Mismos rangos
 * (7, 14 y 30 días), mismas obligaciones y mismas métricas que Tareas →
 * Desempeño: usa el MISMO calculador puro (`performanceCalculator.ts`) con la
 * planificación histórica y las ejecuciones de la Huerta. Sus nombres de
 * campo dicen «employee» por su origen; acá llevan ids de PARTICIPANTES.
 *
 * Visibilidad, como Tareas → Desempeño: un ADMIN ve a todos los participantes
 * y el detalle de cada uno; cualquier otra persona, solo lo suyo (y nada si
 * no participa). El backend calcula todo; el frontend solo presenta.
 */
export async function getGardenPerformance(
  actor: GardenActor,
  query: { from: string; to: string },
  requestedParticipantId?: string,
  now = new Date(),
) {
  const { from, to, today } = rangeOrThrow(query.from, query.to, now);
  const timeZone = config.businessTimeZone;
  const rangeStart = startOfLocalDay(from, timeZone);
  const rangeEnd = startOfLocalDay(addDays(to, 1), timeZone);

  // Fuera de ADMIN, solo la propia participación (aunque hoy esté desactivada: su historia sigue).
  let scopedParticipantId: string | null | undefined = requestedParticipantId;
  if (actor.role !== 'ADMIN') {
    const own =
      actor.participantId ??
      (
        await prisma.kitchenGardenParticipant.findUnique({
          where: { userId: actor.userId },
          select: { id: true },
        })
      )?.id ??
      null;
    if (requestedParticipantId && requestedParticipantId !== own) throw new ForbiddenError();
    scopedParticipantId = own;
  }
  const scope =
    actor.role === 'ADMIN' && !requestedParticipantId
      ? 'team'
      : scopedParticipantId
        ? 'self'
        : 'none';

  const planOverlapsRange = {
    validFrom: { lt: rangeEnd },
    OR: [{ validTo: null }, { validTo: { gte: rangeStart } }],
  };
  const [directory, plans, executions, urgentPending] = await Promise.all([
    loadParticipantDirectory(),
    prisma.kitchenGardenPlanningInterval.findMany({
      where: planOverlapsRange,
      select: {
        id: true,
        activityId: true,
        participantId: true,
        frequency: true,
        scheduledDate: true,
        validFrom: true,
        validTo: true,
        activity: { select: { description: true } },
      },
      orderBy: { validFrom: 'asc' },
    }),
    // Las ejecuciones vigentes de los períodos del rango y, para URGENT/ONE_TIME,
    // la finalización vigente de las planificadas en el rango (como Tareas).
    prisma.kitchenGardenExecution.findMany({
      where: {
        revertedAt: null,
        OR: [
          { periodKey: { gte: formatLocalDate(from), lte: formatLocalDate(to) } },
          {
            periodKey: { in: [URGENT_PERIOD_KEY, ONE_TIME_PERIOD_KEY] },
            activity: {
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
        activityId: true,
        periodKey: true,
        assignedParticipantId: true,
        completedByParticipantId: true,
        completedAt: true,
      },
    }),
    scope === 'none'
      ? Promise.resolve(0)
      : prisma.kitchenGardenActivity.count({
          where: {
            active: true,
            frequency: 'URGENT',
            ...(scopedParticipantId ? { participantId: scopedParticipantId } : {}),
            executions: { none: { revertedAt: null } },
          },
        }),
  ]);
  if (requestedParticipantId && !directory.has(requestedParticipantId)) {
    throw new GardenParticipantNotFoundError();
  }

  // Una «Una vez» con fecha recién es exigible desde el primer instante de ese día.
  const planRows = plans.map((plan) => {
    const text = scheduledDateText(plan.scheduledDate);
    const due = text ? parseLocalDate(text) : null;
    return {
      id: plan.id,
      taskId: plan.activityId,
      description: plan.activity.description,
      employeeId: plan.participantId,
      frequency: plan.frequency,
      validFrom: plan.validFrom,
      validTo: plan.validTo,
      scheduledDate: text,
      dueFrom: due ? startOfLocalDay(due, timeZone) : null,
    };
  });
  const executionRows = executions.map((execution) => ({
    id: execution.id,
    taskId: execution.activityId,
    periodKey: execution.periodKey,
    assignedEmployeeId: execution.assignedParticipantId,
    completedByEmployeeId: execution.completedByParticipantId,
    completedAt: execution.completedAt,
  }));
  const occurrences: Occurrence[] =
    scope === 'none'
      ? []
      : [
          ...buildRecurringOccurrences({
            plans: planRows,
            executions: executionRows,
            from,
            to,
            today,
            now,
            timeZone,
          }),
          ...buildSingleOccurrences({
            plans: planRows,
            executions: executionRows,
            rangeStart,
            rangeEnd,
            now,
          }),
        ];
  const visible = scopedParticipantId
    ? occurrences.filter(
        (item) =>
          item.assignedEmployeeId === scopedParticipantId ||
          item.completedByEmployeeId === scopedParticipantId,
      )
    : occurrences;

  const completedInRange = (frequency: 'URGENT' | 'ONE_TIME') =>
    visible.filter(
      (item) =>
        item.frequency === frequency &&
        item.completedAt !== null &&
        item.completedAt.getTime() >= rangeStart.getTime() &&
        (!scopedParticipantId || item.completedByEmployeeId === scopedParticipantId),
    ).length;

  // Equipo: los participantes activos y los que tuvieron obligaciones o
  // finalizaciones en el rango (un dado de baja con historia sigue contando).
  const involved = new Set(
    occurrences.flatMap((item) => [item.assignedEmployeeId, item.completedByEmployeeId]),
  );
  // Quien no es ADMIN ni participa no ve filas de nadie.
  const listed =
    scope === 'none'
      ? []
      : [...directory.entries()].filter(([id, entry]) =>
          scopedParticipantId ? id === scopedParticipantId : entry.active || involved.has(id),
        );
  const nameOf = (participantId: string | null) => {
    if (!participantId) return null;
    // Fuera de ADMIN, nunca el nombre de otra persona (como Tareas → Desempeño).
    if (actor.role !== 'ADMIN' && participantId !== scopedParticipantId) return null;
    return directory.get(participantId)?.person ?? null;
  };

  return {
    // Fecha de negocio y hora del servidor: alimentan el reloj del día compartido.
    generatedAt: now.toISOString(),
    range: {
      from: formatLocalDate(from),
      to: formatLocalDate(to),
      today: formatLocalDate(today),
      timeZone,
      includesCurrentDay: compareLocalDates(to, today) === 0,
      maxDays: 30,
    },
    scope,
    team: computeMetrics(visible),
    special: {
      urgentCompleted: completedInRange('URGENT'),
      oneTimeCompleted: completedInRange('ONE_TIME'),
      urgentPending,
    },
    participants: listed.map(([id, entry]) => ({
      participant: { ...entry.person, roleLabel: entry.roleLabel, active: entry.active },
      ...computeMetrics(visible, id),
    })),
    occurrences:
      requestedParticipantId || actor.role !== 'ADMIN'
        ? visible.map((item) => ({
            activityId: item.taskId,
            description: item.description,
            frequency: item.frequency,
            status: occurrenceStatus(item),
            periodKey: item.periodKey,
            assignedParticipantId: item.assignedEmployeeId,
            completedByParticipantId: item.completedByEmployeeId,
            assignedTo: nameOf(item.assignedEmployeeId),
            completedBy: nameOf(item.completedByEmployeeId),
            completedAt: item.completedAt?.toISOString() ?? null,
            ...(item.scheduledDate ? { scheduledDate: item.scheduledDate } : {}),
          }))
        : undefined,
  };
}
