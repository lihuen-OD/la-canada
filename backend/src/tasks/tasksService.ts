import { Prisma } from '../generated/prisma/client';
import type { TaskFrequency } from '../generated/prisma/enums';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { recordAuditLog } from '../auth/auditLog';
import type { AuthContext } from '../auth/types';
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
import {
  DuplicateTaskError,
  ForbiddenError,
  NotFoundError,
  TaskAlreadyCompletedError,
  TaskExecutionNotActiveError,
  TaskInactiveError,
  TaskInUseError,
  TaskNotFoundError,
  ValidationError,
} from '../errors/AppError';
import { runEntityDeletion } from '../lib/deletion';
import {
  assertScheduledDateFits,
  scheduleStatusOf,
  scheduledDateText,
  scheduledDateValue,
} from './taskSchedule';
import {
  EMPTY_SUGGESTION,
  SUGGESTION_FIELDS,
  resolveSuggestion,
  suggestedDateIn,
  suggestedDatesInMonth,
  type SuggestionField,
  type SuggestionValues,
} from './taskSuggestion';

/**
 * Reglas del módulo Tareas (Etapa 4A) — ver docs/BUSINESS_RULES.md §2-§5 y
 * docs/ARCHITECTURE.md §18. Todo permiso se decide acá con el rol y el
 * empleado leídos de la base para el usuario autenticado; el frontend solo
 * oculta lo que igual se rechazaría.
 */

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface TaskActor {
  userId: string;
  role: AuthContext['role'];
  /** Empleado vinculado y ACTIVO del usuario autenticado, o null (p. ej. el admin inicial). */
  employeeId: string | null;
}

/**
 * Orden operativo del prototipo: urgente → única → diaria → semanal → mensual
 * (quincenal, entre semanal y mensual; bimestral y anual, después de mensual).
 */
const FREQUENCY_ORDER: Record<TaskFrequency, number> = {
  URGENT: 0,
  ONE_TIME: 1,
  DAILY: 2,
  WEEKLY: 3,
  SEMI_MONTHLY: 4,
  MONTHLY: 5,
  BIMONTHLY: 6,
  ANNUAL: 7,
};

/** Fechas `YYYY-MM-DD`: primero las que tienen fecha (la más antigua arriba), después las sin fecha. */
function compareDates(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

/** «Orden de realización»: primero las numeradas, de menor a mayor; después las sin orden. */
function compareExecutionOrder(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/**
 * Fecha que ordena dentro de la frecuencia: la «Fecha para realizar» de una
 * «Una vez» o la fecha sugerida del período vigente de una recurrente (ambas
 * del backend). Diarias y urgentes se ordenan solo por número.
 */
function sortDateOf(task: Pick<SerializedTask, 'frequency' | 'scheduledDate' | 'suggestedDate'>) {
  switch (task.frequency) {
    case 'DAILY':
    case 'URGENT':
      return null;
    case 'ONE_TIME':
      return task.scheduledDate;
    default:
      return task.suggestedDate;
  }
}

/**
 * Orden operativo (docs/BUSINESS_RULES.md, "Orden de realización y
 * programación sugerida"): frecuencia → fecha (sin fecha al final) → orden de
 * realización (sin número al final) → descripción → id (desempate estable).
 * Nunca por estado ni cumplimiento.
 */
function compareOperationalOrder(a: SerializedTask, b: SerializedTask): number {
  return (
    FREQUENCY_ORDER[a.frequency] - FREQUENCY_ORDER[b.frequency] ||
    compareDates(sortDateOf(a), sortDateOf(b)) ||
    compareExecutionOrder(a.executionOrder, b.executionOrder) ||
    a.description.localeCompare(b.description, 'es') ||
    a.id.localeCompare(b.id)
  );
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

const employeeSummarySelect = { id: true, displayName: true, colorHex: true } as const;

const executionSelect = {
  id: true,
  periodKey: true,
  completedAt: true,
  recordedByUserId: true,
  assignedEmployee: { select: employeeSummarySelect },
  completedByEmployee: { select: employeeSummarySelect },
} as const;

type ExecutionRow = Prisma.TaskExecutionGetPayload<{ select: typeof executionSelect }>;

const taskSelect = {
  id: true,
  description: true,
  frequency: true,
  active: true,
  scheduledDate: true,
  executionOrder: true,
  ...suggestionSelect,
  employee: { select: { ...employeeSummarySelect, active: true } },
} as const;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Actor de la request: rol ya validado por `requireAuth`, empleado leído de la base (nunca del body). */
export async function resolveActor(auth: AuthContext): Promise<TaskActor> {
  // `requireAuth` ya lo resolvió en su consulta única (Etapa 5P).
  if (auth.employeeId !== undefined) {
    return { userId: auth.userId, role: auth.role, employeeId: auth.employeeId };
  }
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { employee: { select: { id: true, active: true } } },
  });
  const employee = user?.employee;
  return {
    userId: auth.userId,
    role: auth.role,
    employeeId: employee && employee.active ? employee.id : null,
  };
}

// ── Serialización ─────────────────────────────────────────────────────────

function serializeExecution(execution: ExecutionRow, canRevert: boolean) {
  return {
    id: execution.id,
    periodKey: execution.periodKey,
    completedAt: execution.completedAt?.toISOString() ?? null,
    assignedEmployee: execution.assignedEmployee,
    completedByEmployee: execution.completedByEmployee,
    canRevert,
  };
}

/**
 * Un EMPLOYEE revierte solo lo que él mismo completó y solo en el período
 * vigente de la tarea; un ADMIN puede corregir cualquier ejecución vigente.
 */
function canRevertExecution(
  actor: TaskActor,
  execution: { periodKey: string; completedByEmployee: { id: string } | null },
  currentPeriodKey: string,
): boolean {
  if (actor.role === 'ADMIN') return true;
  return (
    actor.employeeId !== null &&
    execution.completedByEmployee?.id === actor.employeeId &&
    execution.periodKey === currentPeriodKey
  );
}

/**
 * `scheduledDate`/`scheduleStatus`: «Fecha para realizar» de una «Una vez» y
 * su estado de hoy en `BUSINESS_TIME_ZONE` (programada, para hoy o vencida).
 * Completar ANTES de la fecha está permitido: `canComplete` no depende de ella.
 */
function serializeTask(
  task: TaskRow,
  periodKey: string,
  execution: ExecutionRow | null,
  actor: TaskActor,
  today: LocalDate,
) {
  const canActOnTasks = actor.role === 'ADMIN' || actor.employeeId !== null;
  const scheduledDate = scheduledDateText(task.scheduledDate);
  const suggestion = suggestionOf(task);
  const suggestedDate = suggestedDateIn(task.frequency, suggestion, today);
  return {
    id: task.id,
    description: task.description,
    frequency: task.frequency,
    active: task.active,
    assignee: task.employee,
    periodKey,
    scheduledDate,
    scheduleStatus: scheduleStatusOf(scheduledDate, today, execution !== null),
    executionOrder: task.executionOrder,
    ...suggestion,
    // Fecha sugerida del período vigente: solo una sugerencia, nunca un vencimiento.
    suggestedDate: suggestedDate ? formatLocalDate(suggestedDate) : null,
    currentExecution: execution
      ? serializeExecution(execution, canRevertExecution(actor, execution, periodKey))
      : null,
    canComplete: task.active && execution === null && canActOnTasks,
  };
}

export type SerializedTask = ReturnType<typeof serializeTask>;

async function loadCurrentExecutions(
  client: Prisma.TransactionClient | typeof prisma,
  tasks: { id: string; frequency: TaskFrequency }[],
  now: Date,
): Promise<Map<string, ExecutionRow>> {
  if (tasks.length === 0) return new Map();
  const executions = await client.taskExecution.findMany({
    where: {
      revertedAt: null,
      OR: tasks.map((task) => ({
        taskId: task.id,
        periodKey: computePeriodKey(task.frequency, now, config.businessTimeZone),
      })),
    },
    select: { ...executionSelect, taskId: true },
  });
  return new Map(executions.map((execution) => [execution.taskId, execution]));
}

async function loadSerializedTask(
  taskId: string,
  actor: TaskActor,
  now: Date,
): Promise<SerializedTask> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: taskSelect });
  if (!task) throw new NotFoundError('Tarea no encontrada.');
  const executions = await loadCurrentExecutions(prisma, [task], now);
  const periodKey = computePeriodKey(task.frequency, now, config.businessTimeZone);
  return serializeTask(
    task,
    periodKey,
    executions.get(task.id) ?? null,
    actor,
    toLocalDate(now, config.businessTimeZone),
  );
}

// ── Consulta ──────────────────────────────────────────────────────────────

export interface ListTasksFilters {
  employeeId?: string;
  frequency?: TaskFrequency;
  status: 'active' | 'inactive' | 'all';
}

export async function listTasks(actor: TaskActor, filters: ListTasksFilters, now = new Date()) {
  if (filters.status !== 'active' && actor.role !== 'ADMIN') {
    throw new ForbiddenError('Solo un administrador puede ver tareas desactivadas.');
  }

  const tasks = await prisma.task.findMany({
    where: {
      ...(filters.status === 'active' ? { active: true } : {}),
      ...(filters.status === 'inactive' ? { active: false } : {}),
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      ...(filters.frequency ? { frequency: filters.frequency } : {}),
    },
    select: taskSelect,
  });

  const executions = await loadCurrentExecutions(prisma, tasks, now);
  const today = toLocalDate(now, config.businessTimeZone);
  const serialized = tasks
    .map((task) =>
      serializeTask(
        task,
        computePeriodKey(task.frequency, now, config.businessTimeZone),
        executions.get(task.id) ?? null,
        actor,
        today,
      ),
    )
    // Una tarea única ya completada sale del listado operativo (como en el
    // prototipo): se conserva en base y en el historial, y un ADMIN la ve
    // con `status=all`.
    .filter(
      (task) =>
        !(filters.status === 'active' && task.frequency === 'ONE_TIME' && task.currentExecution),
    )
    .sort(compareOperationalOrder);

  return {
    period: {
      today: formatLocalDate(today),
      weekStart: formatLocalDate(startOfWeek(today)),
      timeZone: config.businessTimeZone,
      // Hora del servidor: el reloj del día del frontend la usa para no
      // depender de la hora del dispositivo (docs/ARCHITECTURE.md §39.1).
      generatedAt: now.toISOString(),
    },
    tasks: serialized,
  };
}

/** Empleados activos, para filtros, formularios y el diálogo de completado de un ADMIN. */
export async function listTaskEmployees() {
  const employees = await prisma.employee.findMany({
    where: { active: true },
    select: employeeSummarySelect,
    orderBy: [{ createdAt: 'asc' }, { displayName: 'asc' }],
  });
  return { employees };
}

// ── Administración ────────────────────────────────────────────────────────

function requireAdmin(actor: TaskActor): void {
  if (actor.role !== 'ADMIN') throw new ForbiddenError();
}

async function requireActiveEmployee(
  client: Prisma.TransactionClient,
  employeeId: string,
  message: string,
): Promise<void> {
  const employee = await client.employee.findUnique({
    where: { id: employeeId },
    select: { active: true },
  });
  if (!employee || !employee.active) throw new ValidationError(message);
}

/** Programación sugerida enviada: omitido = sin cambios (o vacío al crear), `null` = quitar. */
type SuggestionInput = Partial<Record<SuggestionField, number | null>>;

const suggestionInputOf = (input: SuggestionInput): SuggestionInput =>
  Object.fromEntries(
    SUGGESTION_FIELDS.filter((field) => input[field] !== undefined).map((field) => [
      field,
      input[field],
    ]),
  );

export interface CreateTaskInput extends SuggestionInput {
  description: string;
  employeeId: string;
  frequency: TaskFrequency;
  /** Solo `ONE_TIME`: `YYYY-MM-DD` (puede ser pasada). Omitida o `null`: sin fecha. */
  scheduledDate?: string | null;
  /** Orden de realización (1–9999, repetidos permitidos). Omitido o `null`: sin orden. */
  executionOrder?: number | null;
}

export async function createTask(
  actor: TaskActor,
  input: CreateTaskInput,
  meta: RequestMeta,
  now = new Date(),
) {
  requireAdmin(actor);
  assertScheduledDateFits(input.frequency, input.scheduledDate);
  const suggestion = resolveSuggestion(input.frequency, EMPTY_SUGGESTION, suggestionInputOf(input));
  const { scheduledDate = null, executionOrder = null, description, employeeId, frequency } = input;
  const fields = { description, employeeId, frequency };
  let taskId: string;
  try {
    taskId = await prisma.$transaction(async (tx) => {
      await requireActiveEmployee(
        tx,
        input.employeeId,
        'El responsable no existe o no está activo.',
      );
      const task = await tx.task.create({
        data: {
          ...fields,
          scheduledDate: scheduledDateValue(scheduledDate),
          executionOrder,
          ...suggestion,
        },
        select: { id: true },
      });
      await tx.taskPlanningInterval.create({
        data: {
          taskId: task.id,
          employeeId: input.employeeId,
          frequency: input.frequency,
          scheduledDate: scheduledDateValue(scheduledDate),
          validFrom: now,
        },
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'task.created',
        entityType: 'Task',
        entityId: task.id,
        newState: {
          ...fields,
          ...(scheduledDate ? { scheduledDate } : {}),
          ...filledOf({ executionOrder, ...suggestion }),
          active: true,
        },
        ...meta,
      });
      return task.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateTaskError();
    throw error;
  }
  return { task: await loadSerializedTask(taskId, actor, now) };
}

export interface UpdateTaskInput extends SuggestionInput {
  description?: string;
  employeeId?: string;
  frequency?: TaskFrequency;
  /** Omitida: sin cambios. `null`: quitar la fecha. `YYYY-MM-DD`: fijarla (solo `ONE_TIME`). */
  scheduledDate?: string | null;
  /** Omitido: sin cambios. `null`: quitar el orden. Se conserva al cambiar de frecuencia. */
  executionOrder?: number | null;
}

/**
 * Reasignar, cambiar la frecuencia o reprogramar nunca reescribe ejecuciones
 * ya creadas: cada una conserva su `assignedEmployeeId` (snapshot) y su
 * `periodKey` (una «Una vez» sigue con la clave `ONE_TIME`, así que con la
 * fecha nueva tampoco se puede completar dos veces). Cada uno de esos cambios
 * cierra la versión de planificación vigente y abre otra, con la auditoría
 * del valor anterior y el nuevo. Pasar de «Una vez» a otra frecuencia quita
 * la fecha en la misma transacción (queda como antecedente en la versión
 * cerrada y en la auditoría).
 *
 * Orden de realización y programación sugerida: omitido = se conserva,
 * `null` = se quita; cambiar otro campo nunca los borra. Al cambiar de
 * frecuencia se limpia SOLO la sugerencia que deja de valer
 * (`resolveSuggestion`) y el orden se conserva. No cambian períodos ni
 * cálculos, así que no abren una versión de planificación: su historia es la
 * auditoría (valor anterior y nuevo).
 */
export async function updateTask(
  actor: TaskActor,
  taskId: string,
  input: UpdateTaskInput,
  meta: RequestMeta,
  now = new Date(),
) {
  requireAdmin(actor);
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.task.findUnique({
        where: { id: taskId },
        select: {
          description: true,
          employeeId: true,
          frequency: true,
          active: true,
          scheduledDate: true,
          executionOrder: true,
          ...suggestionSelect,
        },
      });
      if (!current) throw new NotFoundError('Tarea no encontrada.');

      const changes: UpdateTaskInput = {};
      const previous: UpdateTaskInput = {};
      for (const key of ['description', 'employeeId', 'frequency'] as const) {
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

      if (changes.employeeId) {
        await requireActiveEmployee(
          tx,
          changes.employeeId,
          'El responsable no existe o no está activo.',
        );
      }
      if (
        current.active &&
        (changes.employeeId || changes.frequency || changes.scheduledDate !== undefined)
      ) {
        await tx.taskPlanningInterval.updateMany({
          where: { taskId, validTo: null },
          data: { validTo: now },
        });
        await tx.taskPlanningInterval.create({
          data: {
            taskId,
            employeeId: changes.employeeId ?? current.employeeId,
            frequency,
            scheduledDate: scheduledDateValue(nextDate),
            validFrom: now,
          },
        });
      }
      const { scheduledDate, ...fields } = changes;
      await tx.task.update({
        where: { id: taskId },
        data: {
          ...fields,
          ...(scheduledDate !== undefined
            ? { scheduledDate: scheduledDateValue(scheduledDate) }
            : {}),
        },
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'task.updated',
        entityType: 'Task',
        entityId: taskId,
        previousState: { ...previous },
        newState: { ...changes },
        ...meta,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateTaskError();
    throw error;
  }
  return { task: await loadSerializedTask(taskId, actor, now) };
}

/** Sin borrado físico: desactivar conserva la tarea y todo su historial. */
export async function setTaskActive(
  actor: TaskActor,
  taskId: string,
  active: boolean,
  meta: RequestMeta,
  now = new Date(),
) {
  requireAdmin(actor);
  await prisma.$transaction(async (tx) => {
    const current = await tx.task.findUnique({
      where: { id: taskId },
      select: { active: true, employeeId: true, frequency: true, scheduledDate: true },
    });
    if (!current) throw new NotFoundError('Tarea no encontrada.');
    if (current.active === active) return;
    if (active) {
      await tx.taskPlanningInterval.create({
        data: {
          taskId,
          employeeId: current.employeeId,
          frequency: current.frequency,
          scheduledDate: current.scheduledDate,
          validFrom: now,
        },
      });
    } else {
      await tx.taskPlanningInterval.updateMany({
        where: { taskId, validTo: null },
        data: { validTo: now },
      });
    }
    await tx.task.update({ where: { id: taskId }, data: { active } });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: active ? 'task.activated' : 'task.deactivated',
      entityType: 'Task',
      entityId: taskId,
      previousState: { active: current.active },
      newState: { active },
      ...meta,
    });
  });
  return { task: await loadSerializedTask(taskId, actor, now) };
}

/**
 * Eliminación definitiva (ADMIN): solo para una tarea creada por error y
 * nunca usada. Cualquier ejecución (incluida una revertida) o archivo es
 * historia → `409 TASK_IN_USE` ("Desactivala"). Sus intervalos de
 * planificación son técnicos y se borran explícitamente en la misma
 * transacción; nada se borra en cascada. La auditoría (con snapshot) se
 * escribe antes del borrado y se revierte con él si algo falla. Dos DELETE
 * simultáneos: el segundo ve 0 filas → 404; una dependencia agregada en
 * paralelo rompe la clave foránea → 409.
 */
export async function deleteTask(actor: TaskActor, taskId: string, meta: RequestMeta) {
  requireAdmin(actor);
  await runEntityDeletion(
    async (tx) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        select: {
          description: true,
          employeeId: true,
          frequency: true,
          active: true,
          scheduledDate: true,
          executionOrder: true,
          ...suggestionSelect,
        },
      });
      if (!task) throw new TaskNotFoundError();
      const executions = await tx.taskExecution.count({ where: { taskId } });
      const files = await tx.fileAsset.count({ where: { taskId } });
      if (executions > 0 || files > 0) throw new TaskInUseError();
      const { scheduledDate, executionOrder, description, employeeId, frequency, active } = task;
      const snapshot = {
        description,
        employeeId,
        frequency,
        active,
        ...filledOf({ executionOrder, ...suggestionOf(task) }),
      };
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'task.deleted',
        entityType: 'Task',
        entityId: taskId,
        previousState: {
          ...snapshot,
          ...(scheduledDate ? { scheduledDate: scheduledDateText(scheduledDate) } : {}),
        },
        ...meta,
      });
      await tx.taskPlanningInterval.deleteMany({ where: { taskId } });
      const { count } = await tx.task.deleteMany({ where: { id: taskId } });
      if (count === 0) throw new TaskNotFoundError();
    },
    () => new TaskInUseError(),
  );
}

// ── Operación ─────────────────────────────────────────────────────────────

/**
 * Registra una finalización para el período vigente. El ejecutor sale de la
 * sesión para un EMPLOYEE (un `employeeId` distinto del propio se rechaza);
 * solo un ADMIN puede indicar otro empleado, que debe existir y estar
 * activo. La unicidad parcial `(task_id, period_key) WHERE reverted_at IS
 * NULL` es la defensa final: si dos requests compiten, la segunda viola el
 * índice, su transacción entera (incluida la auditoría) se revierte y se
 * responde un 409 controlado — nunca un error de Prisma crudo.
 */
export async function completeTask(
  actor: TaskActor,
  taskId: string,
  requestedEmployeeId: string | undefined,
  meta: RequestMeta,
  now = new Date(),
) {
  let executorId: string;
  if (actor.role === 'ADMIN') {
    const chosen = requestedEmployeeId ?? actor.employeeId;
    if (!chosen) {
      throw new ValidationError('Indicá qué empleado realizó la tarea.');
    }
    executorId = chosen;
  } else {
    if (!actor.employeeId) {
      throw new ForbiddenError('Tu usuario no está vinculado a un empleado activo.');
    }
    if (requestedEmployeeId !== undefined && requestedEmployeeId !== actor.employeeId) {
      throw new ForbiddenError('Solo podés registrar tareas completadas por vos.');
    }
    executorId = actor.employeeId;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        select: { id: true, active: true, employeeId: true, frequency: true },
      });
      if (!task) throw new NotFoundError('Tarea no encontrada.');
      if (!task.active) throw new TaskInactiveError();
      if (actor.role === 'ADMIN') {
        await requireActiveEmployee(
          tx,
          executorId,
          'El empleado indicado no existe o no está activo.',
        );
      }

      const periodKey = computePeriodKey(task.frequency, now, config.businessTimeZone);
      const execution = await tx.taskExecution.create({
        data: {
          taskId: task.id,
          periodKey,
          completed: true,
          completedAt: now,
          assignedEmployeeId: task.employeeId,
          completedByEmployeeId: executorId,
          recordedByUserId: actor.userId,
        },
        select: { id: true },
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'task.completed',
        entityType: 'TaskExecution',
        entityId: execution.id,
        newState: {
          taskId: task.id,
          periodKey,
          assignedEmployeeId: task.employeeId,
          completedByEmployeeId: executorId,
          actorRole: actor.role,
          registeredOnBehalf: executorId !== actor.employeeId,
        },
        ...meta,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new TaskAlreadyCompletedError();
    throw error;
  }
  return { task: await loadSerializedTask(taskId, actor, now) };
}

/**
 * Revertir nunca borra: marca la ejecución (quién, cuándo, por qué) y
 * libera el período para volver a completarlo con una fila nueva. La
 * actualización es condicional (`revertedAt: null`), así que dos reversiones
 * simultáneas no pueden aplicarse ambas.
 */
export async function revertTaskCompletion(
  actor: TaskActor,
  taskId: string,
  input: { executionId: string; reason?: string },
  meta: RequestMeta,
  now = new Date(),
) {
  if (actor.role === 'ADMIN' && !input.reason) {
    throw new ValidationError('Indicá el motivo de la corrección.');
  }

  await prisma.$transaction(async (tx) => {
    const execution = await tx.taskExecution.findUnique({
      where: { id: input.executionId },
      select: {
        id: true,
        taskId: true,
        periodKey: true,
        revertedAt: true,
        completedByEmployee: { select: { id: true } },
        task: { select: { frequency: true } },
      },
    });
    if (!execution || execution.taskId !== taskId) {
      throw new NotFoundError('Finalización no encontrada.');
    }
    if (execution.revertedAt) throw new TaskExecutionNotActiveError();

    const currentPeriodKey = computePeriodKey(
      execution.task.frequency,
      now,
      config.businessTimeZone,
    );
    if (!canRevertExecution(actor, execution, currentPeriodKey)) {
      throw new ForbiddenError(
        'Solo podés deshacer una tarea que completaste vos, dentro del período vigente.',
      );
    }

    const updated = await tx.taskExecution.updateMany({
      where: { id: execution.id, revertedAt: null },
      data: {
        completed: false,
        revertedAt: now,
        revertedByUserId: actor.userId,
        revertReason: input.reason ?? null,
      },
    });
    if (updated.count === 0) throw new TaskExecutionNotActiveError();

    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'task.completion_reverted',
      entityType: 'TaskExecution',
      entityId: execution.id,
      previousState: { completed: true },
      newState: {
        taskId,
        periodKey: execution.periodKey,
        completed: false,
        reason: input.reason ?? null,
        actorRole: actor.role,
        administrativeCorrection:
          actor.role === 'ADMIN' && execution.completedByEmployee?.id !== actor.employeeId,
      },
      ...meta,
    });
  });
  return { task: await loadSerializedTask(taskId, actor, now) };
}

// ── Historial semanal ─────────────────────────────────────────────────────

const historyTaskSelect = {
  id: true,
  description: true,
  frequency: true,
  active: true,
  createdAt: true,
  scheduledDate: true,
  employee: { select: employeeSummarySelect },
} as const;

type HistoryTaskRow = Prisma.TaskGetPayload<{ select: typeof historyTaskSelect }>;

function serializeHistoryTask(task: HistoryTaskRow) {
  return {
    id: task.id,
    description: task.description,
    frequency: task.frequency,
    active: task.active,
    assignee: task.employee,
    scheduledDate: scheduledDateText(task.scheduledDate),
  };
}

/**
 * Semana lunes-domingo en la zona de negocio. Diarias y semanales: un slot
 * por período esperado; "esperado" = la tarea está activa hoy, el período ya
 * empezó y la tarea ya existía. Así `completed / expected` es correcto y
 * nunca el 0% fijo del prototipo. Quincenales, mensuales, bimestrales,
 * anuales, urgentes y únicas: las finalizaciones cuya fecha local cae en la
 * semana — esos períodos no entran en una grilla de lunes a domingo, así que
 * no suman slots al denominador realizadas/esperadas. Solo ejecuciones
 * vigentes (las revertidas quedan en la base y en la auditoría). Incluye
 * tareas hoy desactivadas si tuvieron ejecuciones esa semana.
 *
 * Filtro por persona: un slot pertenece a quien lo tenía asignado (snapshot
 * de la ejecución, o el responsable actual si todavía no se completó) o a
 * quien lo completó.
 */
export async function getWeeklyHistory(
  actor: TaskActor,
  params: { week?: string; employeeId?: string },
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

  const recurringTasks = await prisma.task.findMany({
    where: {
      frequency: { in: ['DAILY', 'WEEKLY'] },
      OR: [
        { active: true },
        { executions: { some: { revertedAt: null, periodKey: { in: periodKeys } } } },
      ],
    },
    select: historyTaskSelect,
  });
  const recurringExecutions = recurringTasks.length
    ? await prisma.taskExecution.findMany({
        where: {
          revertedAt: null,
          taskId: { in: recurringTasks.map((task) => task.id) },
          periodKey: { in: periodKeys },
        },
        select: { ...executionSelect, taskId: true },
      })
    : [];
  const executionByKey = new Map(
    recurringExecutions.map((execution) => [
      `${execution.taskId}|${execution.periodKey}`,
      execution,
    ]),
  );

  const rangeStart = startOfLocalDay(weekStart, timeZone);
  const rangeEnd = startOfLocalDay(addDays(weekStart, 7), timeZone);
  const otherExecutions = await prisma.taskExecution.findMany({
    where: {
      revertedAt: null,
      completedAt: { gte: rangeStart, lt: rangeEnd },
      task: {
        frequency: { in: ['SEMI_MONTHLY', 'MONTHLY', 'BIMONTHLY', 'ANNUAL', 'URGENT', 'ONE_TIME'] },
      },
    },
    select: { ...executionSelect, task: { select: historyTaskSelect } },
    orderBy: { completedAt: 'asc' },
  });

  const matchesEmployee = (assigneeId: string, completedById: string | undefined): boolean =>
    !params.employeeId || assigneeId === params.employeeId || completedById === params.employeeId;

  let expected = 0;
  let completed = 0;
  const recurring = recurringTasks
    .sort(
      (a, b) =>
        FREQUENCY_ORDER[a.frequency] - FREQUENCY_ORDER[b.frequency] ||
        a.description.localeCompare(b.description, 'es'),
    )
    .map((task) => {
      const createdOn = toLocalDate(task.createdAt, timeZone);
      const currentPeriodKey = computePeriodKey(task.frequency, now, timeZone);
      const slotDates = task.frequency === 'DAILY' ? days : [weekStart];
      const slots = slotDates
        .map((date) => {
          const periodKey = formatLocalDate(date);
          const execution = executionByKey.get(`${task.id}|${periodKey}`) ?? null;
          const periodEnd = task.frequency === 'DAILY' ? date : addDays(weekStart, 6);
          const isExpected =
            task.active &&
            compareLocalDates(date, today) <= 0 &&
            compareLocalDates(createdOn, periodEnd) <= 0;
          const assigneeId = execution?.assignedEmployee.id ?? task.employee.id;
          if (!matchesEmployee(assigneeId, execution?.completedByEmployee?.id)) return null;
          if (isExpected) {
            expected += 1;
            if (execution) completed += 1;
          }
          return {
            periodKey,
            expected: isExpected,
            execution: execution
              ? serializeExecution(
                  execution,
                  canRevertExecution(actor, execution, currentPeriodKey),
                )
              : null,
          };
        })
        .filter((slot): slot is NonNullable<typeof slot> => slot !== null);
      return { task: serializeHistoryTask(task), slots };
    })
    .filter((row) => row.slots.some((slot) => slot.expected || slot.execution));

  const others = otherExecutions
    .filter((execution) =>
      matchesEmployee(execution.assignedEmployee.id, execution.completedByEmployee?.id),
    )
    .map((execution) => ({
      task: serializeHistoryTask(execution.task),
      execution: serializeExecution(
        execution,
        canRevertExecution(
          actor,
          execution,
          computePeriodKey(execution.task.frequency, now, timeZone),
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

// ── Calendario de Configuración ───────────────────────────────────────────

/**
 * Dónde ubicar en el calendario de un mes (`month` = `YYYY-MM`) las tareas
 * activas con programación sugerida: sus fechas sugeridas desde el período
 * vigente de cada una (`from`), una por período. Los días anteriores a `from`
 * no se atribuyen a la configuración actual (el calendario los marca como
 * siempre), y las tareas sin sugerencia no aparecen: siguen con la marca de
 * su frecuencia. Una sola consulta; el cálculo es el de `taskSuggestion.ts`.
 */
export async function getTaskCalendar(month: string, now = new Date()) {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const today = toLocalDate(now, config.businessTimeZone);
  const tasks = await prisma.task.findMany({
    where: {
      active: true,
      OR: SUGGESTION_FIELDS.map((field) => ({ [field]: { not: null } })),
    },
    select: { id: true, frequency: true, ...suggestionSelect },
  });
  const suggestions = tasks.flatMap((task) => {
    const placement = suggestedDatesInMonth(
      task.frequency,
      suggestionOf(task),
      year,
      monthNumber,
      today,
    );
    return placement
      ? [
          {
            taskId: task.id,
            from: formatLocalDate(placement.from),
            dates: placement.dates.map(formatLocalDate),
          },
        ]
      : [];
  });
  return { month, today: formatLocalDate(today), suggestions };
}
