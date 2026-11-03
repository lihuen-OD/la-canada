import { Prisma } from '../generated/prisma/client';
import type { KitchenGardenActivityKind, TaskFrequency } from '../generated/prisma/enums';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { recordAuditLog } from '../auth/auditLog';
import {
  addDays,
  compareLocalDates,
  computePeriodKey,
  formatLocalDate,
  parseLocalDate,
  startOfLocalDay,
  startOfWeek,
  toLocalDate,
  type LocalDate,
} from '../lib/businessTime';
import { canonicalRequestHash, executeIdempotent } from '../lib/idempotency';
import {
  DuplicateGardenActivityError,
  ForbiddenError,
  GardenActivityAlreadyCompletedError,
  GardenActivityChangedError,
  GardenActivityInactiveError,
  GardenActivityNotFoundError,
  GardenExecutionNotActiveError,
  ValidationError,
} from '../errors/AppError';
import { scheduleStatusOf, scheduledDateText, scheduledDateValue } from '../tasks/taskSchedule';
import {
  EMPTY_SUGGESTION,
  SUGGESTION_FIELDS,
  resolveSuggestion,
  suggestedDateIn,
  type SuggestionField,
  type SuggestionValues,
} from '../tasks/taskSuggestion';
import { FREQUENCY_ORDER } from '../tasks/taskOrder';
import { isCompletedOneOffVisible } from '../tasks/completionRules';
import { GARDEN_SOON_DAYS, agendaOf, compareAgenda } from './gardenAgenda';
import {
  loadParticipantDirectory,
  lockParticipant,
  requireGardenAdmin,
  type GardenActor,
  type GardenParticipantEntry,
  type GardenPerson,
  type RequestMeta,
} from './gardenParticipants';

/**
 * 🥬 Huerta — actividades, que la interfaz llama «registros» (📝 Registros;
 * docs/BUSINESS_RULES.md, "🥬 Huerta"). Las MISMAS reglas que ✅ Tareas
 * (períodos, «Una vez» con fecha, sugerencias, orden, una ejecución vigente
 * por período, reversión lógica, planificación histórica) sobre tablas
 * propias `kitchen_garden_*`: nada se lee ni se escribe en las de Tareas.
 * Cada una tiene además un tipo opcional (siembra, trasplante u otra; las
 * anteriores quedan «Sin clasificar») y observaciones, que no versionan.
 * Permisos: consultar, todos; crear y editar (también las de otro
 * responsable), ADMIN y participantes activos; activar/desactivar, solo
 * ADMIN; completar, el participante activo responsable (lo propio) o un
 * ADMIN indicando quién la realizó.
 */

const SCHEDULED_DATE_ONLY_ONE_TIME =
  'La fecha para realizar solo se puede indicar en actividades «Una vez».';
const RESPONSIBLE_INVALID = 'El responsable debe ser un participante activo de la Huerta.';

/** Crear y editar registros: un ADMIN o un participante activo (identidad de la sesión). */
function requireGardenWriter(actor: GardenActor, message: string): void {
  if (actor.role !== 'ADMIN' && actor.participantId === null) throw new ForbiddenError(message);
}

const canWrite = (actor: GardenActor) => actor.role === 'ADMIN' || actor.participantId !== null;

function assertScheduledDateFits(frequency: TaskFrequency, date: string | null | undefined): void {
  if (date != null && frequency !== 'ONE_TIME')
    throw new ValidationError(SCHEDULED_DATE_ONLY_ONE_TIME);
}

const suggestionSelect = {
  suggestedWeekday: true,
  suggestedFirstHalfDay: true,
  suggestedSecondHalfDay: true,
  suggestedMonthDay: true,
  suggestedMonth: true,
} as const;

const suggestionOf = (row: SuggestionValues): SuggestionValues => ({
  suggestedWeekday: row.suggestedWeekday,
  suggestedFirstHalfDay: row.suggestedFirstHalfDay,
  suggestedSecondHalfDay: row.suggestedSecondHalfDay,
  suggestedMonthDay: row.suggestedMonthDay,
  suggestedMonth: row.suggestedMonth,
});

/** Solo los valores cargados (para auditar sin ruido). */
const filledOf = (values: Partial<Record<string, number | null>>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null));

const activitySelect = {
  id: true,
  description: true,
  frequency: true,
  active: true,
  participantId: true,
  scheduledDate: true,
  executionOrder: true,
  ...suggestionSelect,
  kind: true,
  notes: true,
  version: true,
} as const;

type ActivityRow = Prisma.KitchenGardenActivityGetPayload<{ select: typeof activitySelect }>;

const executionSelect = {
  id: true,
  periodKey: true,
  completedAt: true,
  assignedParticipantId: true,
  completedByParticipantId: true,
} as const;

type ExecutionRow = Prisma.KitchenGardenExecutionGetPayload<{ select: typeof executionSelect }>;

export type Directory = Map<string, GardenParticipantEntry>;

/** Persona de un participante; si no estuviera en el directorio (no debería), un rótulo neutro. */
export const personFrom = (directory: Directory, participantId: string): GardenPerson =>
  directory.get(participantId)?.person ?? {
    id: participantId,
    displayName: 'Participante',
    colorHex: null,
  };

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// ── Serialización ─────────────────────────────────────────────────────────

/**
 * Un participante deshace lo que él mismo completó y solo en el período
 * vigente; un ADMIN corrige cualquier ejecución vigente (con motivo).
 */
export function canRevertExecution(
  actor: GardenActor,
  execution: { periodKey: string; completedByParticipantId: string },
  currentPeriodKey: string,
): boolean {
  if (actor.role === 'ADMIN') return true;
  return (
    actor.participantId !== null &&
    execution.completedByParticipantId === actor.participantId &&
    execution.periodKey === currentPeriodKey
  );
}

function serializeExecution(directory: Directory, execution: ExecutionRow, canRevert: boolean) {
  return {
    id: execution.id,
    periodKey: execution.periodKey,
    completedAt: execution.completedAt.toISOString(),
    /** Responsable esperado en ese período (snapshot). */
    assignedTo: personFrom(directory, execution.assignedParticipantId),
    /** Quién la realizó realmente. */
    completedBy: personFrom(directory, execution.completedByParticipantId),
    canRevert,
  };
}

/** ¿Puede completarla este actor? ADMIN, cualquiera; participante activo, solo las suyas. */
const canCompleteActivity = (actor: GardenActor, activity: ActivityRow) =>
  actor.role === 'ADMIN' ||
  (actor.participantId !== null && actor.participantId === activity.participantId);

function serializeActivity(
  directory: Directory,
  activity: ActivityRow,
  periodKey: string,
  execution: ExecutionRow | null,
  actor: GardenActor,
  today: LocalDate,
) {
  const scheduledDate = scheduledDateText(activity.scheduledDate);
  const suggestion = suggestionOf(activity);
  const suggestedDate = suggestedDateIn(activity.frequency, suggestion, today);
  const suggestedText = suggestedDate ? formatLocalDate(suggestedDate) : null;
  const responsible = directory.get(activity.participantId);
  return {
    id: activity.id,
    description: activity.description,
    frequency: activity.frequency,
    active: activity.active,
    /** `null` = «Sin clasificar» (actividades anteriores al tipo). */
    kind: activity.kind,
    notes: activity.notes,
    version: activity.version,
    responsible: {
      ...personFrom(directory, activity.participantId),
      active: responsible?.active ?? false,
    },
    periodKey,
    scheduledDate,
    scheduleStatus: scheduleStatusOf(scheduledDate, today, execution !== null),
    executionOrder: activity.executionOrder,
    ...suggestion,
    // Fecha sugerida del período vigente: solo una sugerencia, nunca un vencimiento.
    suggestedDate: suggestedText,
    // Grupo de 📝 Registros (vencidas, para hoy, próximas, sin fecha) y su fecha.
    ...agendaOf(
      { frequency: activity.frequency, scheduledDate, suggestedDate: suggestedText },
      formatLocalDate(today),
    ),
    currentExecution: execution
      ? serializeExecution(directory, execution, canRevertExecution(actor, execution, periodKey))
      : null,
    canComplete: activity.active && execution === null && canCompleteActivity(actor, activity),
  };
}

export type SerializedGardenActivity = ReturnType<typeof serializeActivity>;

async function loadCurrentExecutions(
  activities: { id: string; frequency: TaskFrequency }[],
  now: Date,
): Promise<Map<string, ExecutionRow>> {
  if (activities.length === 0) return new Map();
  const executions = await prisma.kitchenGardenExecution.findMany({
    where: {
      revertedAt: null,
      OR: activities.map((activity) => ({
        activityId: activity.id,
        periodKey: computePeriodKey(activity.frequency, now, config.businessTimeZone),
      })),
    },
    select: { ...executionSelect, activityId: true },
  });
  return new Map(executions.map((execution) => [execution.activityId, execution]));
}

async function loadSerializedActivity(activityId: string, actor: GardenActor, now: Date) {
  const [activity, directory] = await Promise.all([
    prisma.kitchenGardenActivity.findUnique({ where: { id: activityId }, select: activitySelect }),
    loadParticipantDirectory(),
  ]);
  if (!activity) throw new GardenActivityNotFoundError();
  const executions = await loadCurrentExecutions([activity], now);
  return serializeActivity(
    directory,
    activity,
    computePeriodKey(activity.frequency, now, config.businessTimeZone),
    executions.get(activity.id) ?? null,
    actor,
    toLocalDate(now, config.businessTimeZone),
  );
}

// ── Consulta ──────────────────────────────────────────────────────────────

export interface ListGardenActivitiesFilters {
  participantId?: string;
  frequency?: TaskFrequency;
  status: 'active' | 'inactive' | 'all';
}

/**
 * `GET /kitchen-garden/activities`: las del período vigente, agrupadas para
 * 📝 Registros (vencidas → para hoy → próximas → sin fecha; dentro de cada
 * grupo por fecha y después el orden operativo de Tareas).
 */
export async function listGardenActivities(
  actor: GardenActor,
  filters: ListGardenActivitiesFilters,
  now = new Date(),
) {
  if (filters.status !== 'active' && actor.role !== 'ADMIN') {
    throw new ForbiddenError('Solo un administrador puede ver actividades desactivadas.');
  }
  const [activities, directory] = await Promise.all([
    prisma.kitchenGardenActivity.findMany({
      where: {
        ...(filters.status === 'active' ? { active: true } : {}),
        ...(filters.status === 'inactive' ? { active: false } : {}),
        ...(filters.participantId ? { participantId: filters.participantId } : {}),
        ...(filters.frequency ? { frequency: filters.frequency } : {}),
      },
      select: activitySelect,
    }),
    loadParticipantDirectory(),
  ]);
  const executions = await loadCurrentExecutions(activities, now);
  const today = toLocalDate(now, config.businessTimeZone);
  // «Una vez» y urgentes completadas: siguen (tachadas) durante la semana de
  // negocio de su finalización vigente (`completedAt`, la misma regla de ✅
  // Tareas) y salen el lunes siguiente; se consultan en el historial y un
  // ADMIN las ve con `status=all`. Nunca se renuevan ni se desactivan.
  const hidden = (activity: ActivityRow, execution: ExecutionRow | undefined) =>
    filters.status === 'active' &&
    execution !== undefined &&
    (activity.frequency === 'ONE_TIME' || activity.frequency === 'URGENT') &&
    !isCompletedOneOffVisible(execution.completedAt, today, config.businessTimeZone);
  const serialized = activities
    .filter((activity) => !hidden(activity, executions.get(activity.id)))
    .map((activity) =>
      serializeActivity(
        directory,
        activity,
        computePeriodKey(activity.frequency, now, config.businessTimeZone),
        executions.get(activity.id) ?? null,
        actor,
        today,
      ),
    )
    .sort(compareAgenda);

  return {
    period: {
      today: formatLocalDate(today),
      weekStart: formatLocalDate(startOfWeek(today)),
      // Último día de «Próximos días» en el resumen de 📝 Registros.
      soonUntil: formatLocalDate(addDays(today, GARDEN_SOON_DAYS)),
      timeZone: config.businessTimeZone,
      // Hora del servidor para el reloj del día compartido (docs/ARCHITECTURE.md §39.1).
      generatedAt: now.toISOString(),
    },
    // Qué acciones mostrar; el backend vuelve a validar cada una.
    viewer: { canWrite: canWrite(actor), canManage: actor.role === 'ADMIN' },
    activities: serialized,
  };
}

// ── Alta y edición (ADMIN y participantes activos) ────────────────────────

/** Programación sugerida enviada: omitido = sin cambios (o vacío al crear), `null` = quitar. */
type SuggestionInput = Partial<Record<SuggestionField, number | null>>;

const suggestionInputOf = (input: SuggestionInput): SuggestionInput =>
  Object.fromEntries(
    SUGGESTION_FIELDS.filter((field) => input[field] !== undefined).map((field) => [
      field,
      input[field],
    ]),
  );

/** Dentro de la transacción: el responsable existe y está activo (fila bloqueada). */
async function requireActiveResponsible(tx: Prisma.TransactionClient, participantId: string) {
  const participant = await lockParticipant(tx, participantId);
  if (!participant?.active) throw new ValidationError(RESPONSIBLE_INVALID);
}

/** Tipos que se pueden asignar (`HARVEST` queda en la base sin uso; ver `gardenSchemas.ts`). */
export type GardenActivityKind = Exclude<KitchenGardenActivityKind, 'HARVEST'>;

/** «Programar también el trasplante»: otra actividad «Una vez» de tipo trasplante. */
export interface ScheduledTransplantInput {
  description: string;
  participantId: string;
  scheduledDate?: string | null;
}

export interface CreateGardenActivityInput extends SuggestionInput {
  kind: GardenActivityKind;
  description: string;
  participantId: string;
  frequency: TaskFrequency;
  scheduledDate?: string | null;
  notes?: string | null;
  executionOrder?: number | null;
  transplant?: ScheduledTransplantInput;
}

interface NewActivity {
  kind: GardenActivityKind;
  description: string;
  participantId: string;
  frequency: TaskFrequency;
  scheduledDate: string | null;
  notes: string | null;
  executionOrder: number | null;
  suggestion: SuggestionValues;
}

/** Una actividad nueva con su primera versión de planificación y su auditoría. */
async function insertActivity(
  tx: Prisma.TransactionClient,
  actor: GardenActor,
  activity: NewActivity,
  meta: RequestMeta,
  now: Date,
  link: Record<string, string> = {},
): Promise<string> {
  const { kind, description, participantId, frequency, scheduledDate, notes, executionOrder } =
    activity;
  await requireActiveResponsible(tx, participantId);
  const created = await tx.kitchenGardenActivity.create({
    data: {
      kind,
      description,
      participantId,
      frequency,
      scheduledDate: scheduledDateValue(scheduledDate),
      notes,
      executionOrder,
      ...activity.suggestion,
    },
    select: { id: true },
  });
  await tx.kitchenGardenPlanningInterval.create({
    data: {
      activityId: created.id,
      participantId,
      frequency,
      scheduledDate: scheduledDateValue(scheduledDate),
      validFrom: now,
    },
  });
  await recordAuditLog(tx, {
    actorUserId: actor.userId,
    action: 'kitchen_garden.activity_created',
    entityType: 'KitchenGardenActivity',
    entityId: created.id,
    newState: {
      kind,
      description,
      participantId,
      frequency,
      ...(scheduledDate ? { scheduledDate } : {}),
      ...(notes ? { notes } : {}),
      ...filledOf({ executionOrder, ...activity.suggestion }),
      active: true,
      actorRole: actor.role,
      ...link,
    },
    ...meta,
  });
  return created.id;
}

const CREATE_ENDPOINT = 'POST /kitchen-garden/activities';

/** Lo que guarda la idempotencia: los ids creados (la respuesta se arma al día). */
interface CreatedIds {
  activityId: string;
  transplantId: string | null;
}

/** Huella canónica del alta (orden fijo; mismo cuerpo → misma huella). */
const createHashParts = (input: CreateGardenActivityInput) => [
  CREATE_ENDPOINT,
  input.kind,
  input.description,
  input.participantId,
  input.frequency,
  input.scheduledDate ?? null,
  input.notes ?? null,
  input.executionOrder ?? null,
  ...SUGGESTION_FIELDS.map((field) => input[field] ?? null),
  input.transplant ? 1 : 0,
  input.transplant?.description ?? null,
  input.transplant?.participantId ?? null,
  input.transplant?.scheduledDate ?? null,
];

/**
 * Alta de un registro (actividad). El tipo es obligatorio en las nuevas.
 * Con `transplant` (solo siembra «Una vez») crea además el trasplante como
 * otra actividad independiente, en la MISMA transacción: o quedan las dos o
 * ninguna. Después se gestionan por separado (completar una nunca completa
 * la otra). Con `Idempotency-Key`, un doble envío devuelve lo ya creado.
 */
export async function createGardenActivity(
  actor: GardenActor,
  input: CreateGardenActivityInput,
  meta: RequestMeta,
  now = new Date(),
  idempotencyKey?: string,
) {
  requireGardenWriter(
    actor,
    'Solo un administrador o un participante activo de la Huerta puede crear registros.',
  );
  assertScheduledDateFits(input.frequency, input.scheduledDate);
  const { transplant } = input;
  if (transplant) {
    if (input.kind !== 'SOWING' || input.frequency !== 'ONE_TIME') {
      throw new ValidationError(
        'El trasplante solo se puede programar junto con una siembra «Una vez».',
      );
    }
    if (transplant.scheduledDate && input.scheduledDate) {
      if (transplant.scheduledDate < input.scheduledDate) {
        throw new ValidationError(
          'La fecha prevista del trasplante no puede ser anterior a la de la siembra.',
        );
      }
    }
  }
  const suggestion = resolveSuggestion(input.frequency, EMPTY_SUGGESTION, suggestionInputOf(input));

  const write = async (tx: Prisma.TransactionClient): Promise<CreatedIds> => {
    const activityId = await insertActivity(
      tx,
      actor,
      {
        kind: input.kind,
        description: input.description,
        participantId: input.participantId,
        frequency: input.frequency,
        scheduledDate: input.scheduledDate ?? null,
        notes: input.notes ?? null,
        executionOrder: input.executionOrder ?? null,
        suggestion,
      },
      meta,
      now,
    );
    const transplantId = transplant
      ? await insertActivity(
          tx,
          actor,
          {
            kind: 'TRANSPLANT',
            description: transplant.description,
            participantId: transplant.participantId,
            frequency: 'ONE_TIME',
            scheduledDate: transplant.scheduledDate ?? null,
            notes: null,
            executionOrder: null,
            suggestion: EMPTY_SUGGESTION,
          },
          meta,
          now,
          // Solo un rastro en la auditoría: no hay vínculo ni automatismo entre ambas.
          { scheduledWithSowingId: activityId },
        )
      : null;
    return { activityId, transplantId };
  };

  let created: CreatedIds;
  try {
    if (idempotencyKey === undefined) {
      created = await prisma.$transaction(write);
    } else {
      const result = await executeIdempotent({
        actorUserId: actor.userId,
        endpoint: CREATE_ENDPOINT,
        key: idempotencyKey,
        requestHash: canonicalRequestHash(createHashParts(input)),
        status: 201,
        run: async (tx) => ({ ...(await write(tx)) }),
      });
      created = result.kind === 'created' ? result.body : (result.body as unknown as CreatedIds);
    }
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateGardenActivityError();
    throw error;
  }
  return {
    activity: await loadSerializedActivity(created.activityId, actor, now),
    transplant: created.transplantId
      ? await loadSerializedActivity(created.transplantId, actor, now)
      : null,
  };
}

export interface UpdateGardenActivityInput extends SuggestionInput {
  /** La versión que vio la pantalla (concurrencia optimista). */
  version: number;
  kind?: GardenActivityKind;
  description?: string;
  participantId?: string;
  frequency?: TaskFrequency;
  scheduledDate?: string | null;
  notes?: string | null;
  executionOrder?: number | null;
}

type ActivityChanges = Omit<UpdateGardenActivityInput, 'version'>;

/**
 * Mismas reglas que editar una tarea: omitido conserva, `null` quita; cambiar
 * de frecuencia limpia SOLO la sugerencia que deja de valer (y la fecha si
 * deja de ser «Una vez»). Reasignar, cambiar la frecuencia o reprogramar
 * cierran la versión de planificación vigente y abren otra: las ejecuciones
 * y lo esperado antes no se reescriben. Tipo, observaciones, orden y
 * sugerencia no versionan la planificación. La fila se bloquea antes de
 * leerla y la `version` enviada debe ser la vigente (409 si otra persona la
 * cambió); sin cambios reales no se escribe ni se audita nada.
 */
export async function updateGardenActivity(
  actor: GardenActor,
  activityId: string,
  input: UpdateGardenActivityInput,
  meta: RequestMeta,
  now = new Date(),
) {
  requireGardenWriter(
    actor,
    'Solo un administrador o un participante activo de la Huerta puede editar registros.',
  );
  try {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT "id" FROM "kitchen_garden_activities" WHERE "id" = ${activityId}::uuid FOR UPDATE`,
      );
      if (locked.length === 0) throw new GardenActivityNotFoundError();
      const current = await tx.kitchenGardenActivity.findUnique({
        where: { id: activityId },
        select: activitySelect,
      });
      if (!current) throw new GardenActivityNotFoundError();
      if (!current.active && actor.role !== 'ADMIN') {
        throw new ForbiddenError('Solo un administrador puede editar registros desactivados.');
      }
      if (current.version !== input.version) throw new GardenActivityChangedError();

      const changes: ActivityChanges = {};
      const previous: ActivityChanges = {};
      for (const key of ['kind', 'description', 'participantId', 'frequency', 'notes'] as const) {
        const next = input[key];
        if (next !== undefined && next !== current[key]) {
          (changes as Record<string, unknown>)[key] = next;
          (previous as Record<string, unknown>)[key] = current[key];
        }
      }

      const frequency = changes.frequency ?? current.frequency;
      assertScheduledDateFits(frequency, input.scheduledDate);
      const currentDate = scheduledDateText(current.scheduledDate);
      const nextDate =
        frequency !== 'ONE_TIME'
          ? null
          : input.scheduledDate !== undefined
            ? input.scheduledDate
            : currentDate;
      if (nextDate !== currentDate) {
        changes.scheduledDate = nextDate;
        previous.scheduledDate = currentDate;
      }
      if (input.executionOrder !== undefined && input.executionOrder !== current.executionOrder) {
        changes.executionOrder = input.executionOrder;
        previous.executionOrder = current.executionOrder;
      }
      const currentSuggestion = suggestionOf(current);
      const nextSuggestion = resolveSuggestion(
        frequency,
        currentSuggestion,
        suggestionInputOf(input),
      );
      for (const field of SUGGESTION_FIELDS) {
        if (nextSuggestion[field] !== currentSuggestion[field]) {
          changes[field] = nextSuggestion[field];
          previous[field] = currentSuggestion[field];
        }
      }
      if (Object.keys(changes).length === 0) return;

      if (changes.participantId) await requireActiveResponsible(tx, changes.participantId);
      if (
        current.active &&
        (changes.participantId || changes.frequency || changes.scheduledDate !== undefined)
      ) {
        await tx.kitchenGardenPlanningInterval.updateMany({
          where: { activityId, validTo: null },
          data: { validTo: now },
        });
        await tx.kitchenGardenPlanningInterval.create({
          data: {
            activityId,
            participantId: changes.participantId ?? current.participantId,
            frequency,
            scheduledDate: scheduledDateValue(nextDate),
            validFrom: now,
          },
        });
      }
      const { scheduledDate, ...fields } = changes;
      await tx.kitchenGardenActivity.update({
        where: { id: activityId },
        data: {
          ...fields,
          ...(scheduledDate !== undefined
            ? { scheduledDate: scheduledDateValue(scheduledDate) }
            : {}),
          version: { increment: 1 },
        },
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'kitchen_garden.activity_updated',
        entityType: 'KitchenGardenActivity',
        entityId: activityId,
        previousState: { ...previous, version: current.version },
        newState: { ...changes, version: current.version + 1, actorRole: actor.role },
        ...meta,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateGardenActivityError();
    throw error;
  }
  return { activity: await loadSerializedActivity(activityId, actor, now) };
}

// ── Activar y desactivar (solo ADMIN) ─────────────────────────────────────

/** Sin borrado: desactivar conserva la actividad y todo su historial. */
export async function setGardenActivityActive(
  actor: GardenActor,
  activityId: string,
  active: boolean,
  meta: RequestMeta,
  now = new Date(),
) {
  requireGardenAdmin(actor, 'Solo un administrador puede activar o desactivar actividades.');
  await prisma.$transaction(async (tx) => {
    const current = await tx.kitchenGardenActivity.findUnique({
      where: { id: activityId },
      select: { active: true, participantId: true, frequency: true, scheduledDate: true },
    });
    if (!current) throw new GardenActivityNotFoundError();
    if (current.active === active) return;
    if (active) {
      // Reactivarla exige un responsable activo (si no, primero se reasigna).
      const responsible = await lockParticipant(tx, current.participantId);
      if (!responsible?.active) {
        throw new ValidationError(
          'El responsable ya no participa de la Huerta: reasignala a un participante activo antes de reactivarla.',
        );
      }
      await tx.kitchenGardenPlanningInterval.create({
        data: {
          activityId,
          participantId: current.participantId,
          frequency: current.frequency,
          scheduledDate: current.scheduledDate,
          validFrom: now,
        },
      });
    } else {
      await tx.kitchenGardenPlanningInterval.updateMany({
        where: { activityId, validTo: null },
        data: { validTo: now },
      });
    }
    // La versión sube: una edición abierta antes del cambio recibe 409 y no lo pisa.
    await tx.kitchenGardenActivity.update({
      where: { id: activityId },
      data: { active, version: { increment: 1 } },
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: active ? 'kitchen_garden.activity_activated' : 'kitchen_garden.activity_deactivated',
      entityType: 'KitchenGardenActivity',
      entityId: activityId,
      previousState: { active: current.active },
      newState: { active },
      ...meta,
    });
  });
  return { activity: await loadSerializedActivity(activityId, actor, now) };
}

// ── Operación ─────────────────────────────────────────────────────────────

/**
 * Registra una finalización para el período vigente. Un participante activo
 * completa SOLO las actividades asignadas a él y siempre a su nombre; un
 * ADMIN indica quién la realizó (un participante activo). El responsable
 * esperado (snapshot), quien la realizó y el usuario de la sesión quedan por
 * separado. La unicidad parcial `(activity_id, period_key) WHERE reverted_at
 * IS NULL` es la defensa final ante dos solicitudes simultáneas: la segunda
 * recibe un 409 controlado y su transacción (con la auditoría) se revierte.
 */
export async function completeGardenActivity(
  actor: GardenActor,
  activityId: string,
  requestedParticipantId: string | undefined,
  meta: RequestMeta,
  now = new Date(),
) {
  let performerId: string;
  if (actor.role === 'ADMIN') {
    const chosen = requestedParticipantId ?? actor.participantId;
    if (!chosen) throw new ValidationError('Indicá quién realizó la actividad.');
    performerId = chosen;
  } else {
    if (!actor.participantId) {
      throw new ForbiddenError('Solo los participantes de la Huerta pueden completar actividades.');
    }
    if (requestedParticipantId !== undefined && requestedParticipantId !== actor.participantId) {
      throw new ForbiddenError('Solo podés registrar actividades realizadas por vos.');
    }
    performerId = actor.participantId;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const activity = await tx.kitchenGardenActivity.findUnique({
        where: { id: activityId },
        select: { id: true, active: true, participantId: true, frequency: true },
      });
      if (!activity) throw new GardenActivityNotFoundError();
      if (!activity.active) throw new GardenActivityInactiveError();
      if (actor.role !== 'ADMIN' && activity.participantId !== actor.participantId) {
        throw new ForbiddenError('Solo podés completar actividades asignadas a vos.');
      }
      if (actor.role === 'ADMIN') {
        const performer = await tx.kitchenGardenParticipant.findUnique({
          where: { id: performerId },
          select: { active: true },
        });
        if (!performer?.active) {
          throw new ValidationError(
            'Quien la realizó debe ser un participante activo de la Huerta.',
          );
        }
      }

      const periodKey = computePeriodKey(activity.frequency, now, config.businessTimeZone);
      const execution = await tx.kitchenGardenExecution.create({
        data: {
          activityId: activity.id,
          periodKey,
          completed: true,
          completedAt: now,
          assignedParticipantId: activity.participantId,
          completedByParticipantId: performerId,
          recordedByUserId: actor.userId,
        },
        select: { id: true },
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'kitchen_garden.activity_completed',
        entityType: 'KitchenGardenExecution',
        entityId: execution.id,
        newState: {
          activityId: activity.id,
          periodKey,
          assignedParticipantId: activity.participantId,
          completedByParticipantId: performerId,
          actorRole: actor.role,
          registeredOnBehalf: performerId !== actor.participantId,
        },
        ...meta,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new GardenActivityAlreadyCompletedError();
    throw error;
  }
  return { activity: await loadSerializedActivity(activityId, actor, now) };
}

/**
 * Revertir nunca borra: marca la ejecución (quién, cuándo, por qué) y libera
 * el período. Un participante deshace lo propio dentro del período vigente;
 * un ADMIN corrige cualquier ejecución vigente indicando el motivo.
 */
export async function revertGardenCompletion(
  actor: GardenActor,
  activityId: string,
  input: { executionId: string; reason?: string },
  meta: RequestMeta,
  now = new Date(),
) {
  if (actor.role === 'ADMIN' && !input.reason) {
    throw new ValidationError('Indicá el motivo de la corrección.');
  }
  await prisma.$transaction(async (tx) => {
    const execution = await tx.kitchenGardenExecution.findUnique({
      where: { id: input.executionId },
      select: {
        id: true,
        activityId: true,
        periodKey: true,
        revertedAt: true,
        completedByParticipantId: true,
        activity: { select: { frequency: true } },
      },
    });
    if (!execution || execution.activityId !== activityId) {
      throw new GardenActivityNotFoundError();
    }
    if (execution.revertedAt) throw new GardenExecutionNotActiveError();
    const currentPeriodKey = computePeriodKey(
      execution.activity.frequency,
      now,
      config.businessTimeZone,
    );
    if (!canRevertExecution(actor, execution, currentPeriodKey)) {
      throw new ForbiddenError(
        'Solo podés deshacer una actividad que completaste vos, dentro del período vigente.',
      );
    }
    const updated = await tx.kitchenGardenExecution.updateMany({
      where: { id: execution.id, revertedAt: null },
      data: {
        completed: false,
        revertedAt: now,
        revertedByUserId: actor.userId,
        revertReason: input.reason ?? null,
      },
    });
    if (updated.count === 0) throw new GardenExecutionNotActiveError();
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'kitchen_garden.activity_completion_reverted',
      entityType: 'KitchenGardenExecution',
      entityId: execution.id,
      previousState: { completed: true },
      newState: {
        activityId,
        periodKey: execution.periodKey,
        completed: false,
        reason: input.reason ?? null,
        actorRole: actor.role,
        administrativeCorrection:
          actor.role === 'ADMIN' && execution.completedByParticipantId !== actor.participantId,
      },
      ...meta,
    });
  });
  return { activity: await loadSerializedActivity(activityId, actor, now) };
}

// ── Historial semanal ─────────────────────────────────────────────────────

const historyActivitySelect = {
  id: true,
  description: true,
  frequency: true,
  active: true,
  createdAt: true,
  scheduledDate: true,
  participantId: true,
} as const;

type HistoryActivityRow = Prisma.KitchenGardenActivityGetPayload<{
  select: typeof historyActivitySelect;
}>;

function serializeHistoryActivity(directory: Directory, activity: HistoryActivityRow) {
  return {
    id: activity.id,
    description: activity.description,
    frequency: activity.frequency,
    active: activity.active,
    responsible: personFrom(directory, activity.participantId),
    scheduledDate: scheduledDateText(activity.scheduledDate),
  };
}

/**
 * La semana lunes-domingo de la zona de negocio, con el mismo criterio que
 * el historial de Tareas: diarias y semanales con un slot por período
 * esperado (activa hoy, período empezado y la actividad ya existía); las
 * demás frecuencias, por fecha de finalización y fuera del conteo
 * hechas/esperadas. Solo ejecuciones vigentes. Filtro por participante:
 * quien la tenía asignada (snapshot o responsable actual) o quien la realizó.
 */
export async function getGardenWeeklyHistory(
  actor: GardenActor,
  params: { week?: string; participantId?: string },
  now = new Date(),
) {
  const timeZone = config.businessTimeZone;
  const today = toLocalDate(now, timeZone);
  let reference: LocalDate = today;
  if (params.week) {
    const parsed = parseLocalDate(params.week);
    if (!parsed) throw new ValidationError('La semana indicada no es una fecha válida.');
    reference = parsed;
  }
  const weekStart = startOfWeek(reference);
  if (compareLocalDates(weekStart, startOfWeek(today)) > 0) {
    throw new ValidationError('No se puede consultar una semana futura.');
  }
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const dayKeys = days.map(formatLocalDate);
  const weekKey = dayKeys[0] as string;
  const periodKeys = Array.from(new Set([...dayKeys, weekKey]));
  const rangeStart = startOfLocalDay(weekStart, timeZone);
  const rangeEnd = startOfLocalDay(addDays(weekStart, 7), timeZone);

  const [directory, recurringActivities, otherExecutions] = await Promise.all([
    loadParticipantDirectory(),
    prisma.kitchenGardenActivity.findMany({
      where: {
        frequency: { in: ['DAILY', 'WEEKLY'] },
        OR: [
          { active: true },
          { executions: { some: { revertedAt: null, periodKey: { in: periodKeys } } } },
        ],
      },
      select: historyActivitySelect,
    }),
    prisma.kitchenGardenExecution.findMany({
      where: {
        revertedAt: null,
        completedAt: { gte: rangeStart, lt: rangeEnd },
        activity: {
          frequency: {
            in: ['SEMI_MONTHLY', 'MONTHLY', 'BIMONTHLY', 'ANNUAL', 'URGENT', 'ONE_TIME'],
          },
        },
      },
      select: { ...executionSelect, activity: { select: historyActivitySelect } },
      orderBy: { completedAt: 'asc' },
    }),
  ]);
  const recurringExecutions = recurringActivities.length
    ? await prisma.kitchenGardenExecution.findMany({
        where: {
          revertedAt: null,
          activityId: { in: recurringActivities.map((activity) => activity.id) },
          periodKey: { in: periodKeys },
        },
        select: { ...executionSelect, activityId: true },
      })
    : [];
  const executionByKey = new Map(
    recurringExecutions.map((execution) => [
      `${execution.activityId}|${execution.periodKey}`,
      execution,
    ]),
  );

  const matchesParticipant = (assignedId: string, completedById: string | undefined): boolean =>
    !params.participantId ||
    assignedId === params.participantId ||
    completedById === params.participantId;

  let expected = 0;
  let completed = 0;
  const recurring = recurringActivities
    .sort(
      (a, b) =>
        FREQUENCY_ORDER[a.frequency] - FREQUENCY_ORDER[b.frequency] ||
        a.description.localeCompare(b.description, 'es'),
    )
    .map((activity) => {
      const createdOn = toLocalDate(activity.createdAt, timeZone);
      const currentPeriodKey = computePeriodKey(activity.frequency, now, timeZone);
      const slotDates = activity.frequency === 'DAILY' ? days : [weekStart];
      const slots = slotDates
        .map((date) => {
          const periodKey = formatLocalDate(date);
          const execution = executionByKey.get(`${activity.id}|${periodKey}`) ?? null;
          const periodEnd = activity.frequency === 'DAILY' ? date : addDays(weekStart, 6);
          const isExpected =
            activity.active &&
            compareLocalDates(date, today) <= 0 &&
            compareLocalDates(createdOn, periodEnd) <= 0;
          const assignedId = execution?.assignedParticipantId ?? activity.participantId;
          if (!matchesParticipant(assignedId, execution?.completedByParticipantId)) return null;
          if (isExpected) {
            expected += 1;
            if (execution) completed += 1;
          }
          return {
            periodKey,
            expected: isExpected,
            execution: execution
              ? serializeExecution(
                  directory,
                  execution,
                  canRevertExecution(actor, execution, currentPeriodKey),
                )
              : null,
          };
        })
        .filter((slot): slot is NonNullable<typeof slot> => slot !== null);
      return { activity: serializeHistoryActivity(directory, activity), slots };
    })
    .filter((row) => row.slots.some((slot) => slot.expected || slot.execution));

  const others = otherExecutions
    .filter((execution) =>
      matchesParticipant(execution.assignedParticipantId, execution.completedByParticipantId),
    )
    .map((execution) => ({
      activity: serializeHistoryActivity(directory, execution.activity),
      execution: serializeExecution(
        directory,
        execution,
        canRevertExecution(
          actor,
          execution,
          computePeriodKey(execution.activity.frequency, now, timeZone),
        ),
      ),
    }));

  return {
    week: {
      start: weekKey,
      end: dayKeys[6] as string,
      days: dayKeys,
      isCurrent: weekKey === formatLocalDate(startOfWeek(today)),
      timeZone,
    },
    summary: { expected, completed },
    recurring,
    others,
  };
}
