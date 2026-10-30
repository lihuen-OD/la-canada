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
  TaskObligationAlreadyCompletedError,
  TaskObligationUnavailableError,
  ValidationError,
} from '../errors/AppError';
import { loadObligationInputs, lateCompletionWindow } from '../performance/performanceService';
import { buildRecurringOccurrences } from '../performance/performanceCalculator';
import { runEntityDeletion } from '../lib/deletion';
import {
  assertScheduledDateFits,
  scheduleStatusOf,
  scheduledDateText,
  scheduledDateValue,
} from './taskSchedule';
import { FREQUENCY_ORDER, compareOperationalOrder } from './taskOrder';
import { canRevertExecution, executionFrequency, lateCompletionBounds } from './completionRules';
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
  performedOn: true,
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

/**
 * `completedAt` = momento real del registro; `performedOn` = fecha real de
 * realización de una carga olvidada (solo el día, sin hora), `null` en el
 * flujo normal (se realizó cuando se registró).
 */
function serializeExecution(execution: ExecutionRow, canRevert: boolean) {
  return {
    id: execution.id,
    periodKey: execution.periodKey,
    completedAt: execution.completedAt?.toISOString() ?? null,
    performedOn: scheduledDateText(execution.performedOn),
    assignedEmployee: execution.assignedEmployee,
    completedByEmployee: execution.completedByEmployee,
    canRevert,
  };
}

/** Regla compartida (`completionRules.canRevertExecution`) con el día de negocio de `now`. */
function canRevertAt(
  actor: TaskActor,
  execution: ExecutionRow,
  currentPeriodKey: string,
  now: Date,
): boolean {
  const timeZone = config.businessTimeZone;
  return canRevertExecution(
    actor,
    execution,
    currentPeriodKey,
    toLocalDate(now, timeZone),
    timeZone,
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
      ? serializeExecution(
          execution,
          canRevertExecution(actor, execution, periodKey, today, config.businessTimeZone),
        )
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
        completedAt: true,
        performedOn: true,
        recordedByUserId: true,
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
    if (
      !canRevertExecution(
        actor,
        execution,
        currentPeriodKey,
        toLocalDate(now, config.businessTimeZone),
        config.businessTimeZone,
      )
    ) {
      throw new ForbiddenError(
        'Solo podés deshacer una tarea que completaste vos, dentro del período vigente o el mismo día en que la registraste desde Desempeño.',
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

// ── Carga olvidada (Desempeño → Detalle) ──────────────────────────────────

export interface LateCompletionInput {
  /** Período de la obligación elegida en el detalle: el servidor lo vuelve a validar. */
  periodKey: string;
  /** Fecha real de realización (`YYYY-MM-DD`, `BUSINESS_TIME_ZONE`). */
  performedOn: string;
  /** Solo ADMIN (obligatorio): quién la realizó. */
  employeeId?: string;
}

/**
 * «Marcar como realizada» una obligación recurrente que se hizo y no se
 * marcó (docs/BUSINESS_RULES.md, "Tareas realizadas que se olvidaron
 * marcar"). Nunca usa el período vigente como `completeTask`: reconstruye la
 * obligación pedida con la MISMA lectura y el MISMO calculador que Desempeño
 * (`loadObligationInputs` + `buildRecurringOccurrences`, ventana de 30 días)
 * y no confía en nada del cliente salvo la identificación (tarea + período)
 * y la fecha: responsable y frecuencia salen de la planificación histórica,
 * el estado pendiente de las ejecuciones vigentes, y si ya no está pendiente
 * o dejó de existir se responde 409.
 *
 * - EMPLOYEE: solo una obligación que le correspondía (responsable
 *   histórico), a su nombre; nunca la de otra persona.
 * - ADMIN: elige explícitamente quién la realizó (empleado activo); si no es
 *   el responsable, queda como cobertura.
 * - Fecha: dentro del período, nunca futura ni anterior a que la tarea
 *   tuviera esa frecuencia (`lateCompletionBounds`). Se guarda sin hora en
 *   `performedOn`; `completedAt` es el momento real del registro y el autor
 *   sale de la sesión.
 * - Una sola ejecución vigente por tarea y período: la unicidad parcial es la
 *   defensa final (doble clic, solicitudes simultáneas o alguien que la
 *   completó mientras tanto → 409, nunca se reemplaza otra ejecución).
 * - Una desactivación posterior no la invalida: cuenta la planificación de
 *   ese período.
 */
export async function registerLateCompletion(
  actor: TaskActor,
  taskId: string,
  input: LateCompletionInput,
  meta: RequestMeta,
  now = new Date(),
) {
  let executorId: string;
  if (actor.role === 'ADMIN') {
    if (!input.employeeId) throw new ValidationError('Indicá quién realizó la tarea.');
    executorId = input.employeeId;
  } else {
    if (!actor.employeeId) {
      throw new ForbiddenError('Tu usuario no está vinculado a un empleado activo.');
    }
    if (input.employeeId !== undefined && input.employeeId !== actor.employeeId) {
      throw new ForbiddenError('Solo podés registrar tareas realizadas por vos.');
    }
    executorId = actor.employeeId;
  }

  const timeZone = config.businessTimeZone;
  const window = lateCompletionWindow(now);
  const performedOn = parseLocalDate(input.performedOn);
  if (!performedOn) throw new ValidationError('La fecha en que se realizó no es válida.');
  if (compareLocalDates(performedOn, window.today) > 0) {
    throw new ValidationError('La fecha en que se realizó no puede ser futura.');
  }

  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
  if (!task) throw new NotFoundError('Tarea no encontrada.');

  const inputs = await loadObligationInputs(
    {
      from: window.from,
      to: window.to,
      rangeStart: startOfLocalDay(window.from, timeZone),
      rangeEnd: startOfLocalDay(addDays(window.to, 1), timeZone),
    },
    taskId,
  );
  const occurrence = buildRecurringOccurrences({
    plans: inputs.planRows,
    executions: inputs.executions,
    from: window.from,
    to: window.to,
    today: window.today,
    now,
    timeZone,
  }).find((item) => item.periodKey === input.periodKey);
  if (!occurrence) throw new TaskObligationUnavailableError();
  if (occurrence.completed) throw new TaskObligationAlreadyCompletedError();
  if (actor.role !== 'ADMIN' && occurrence.assignedEmployeeId !== actor.employeeId) {
    throw new ForbiddenError('Solo podés registrar tareas que te correspondían a vos.');
  }
  const bounds = lateCompletionBounds({
    occurrence,
    plans: inputs.planRows,
    windowFrom: window.from,
    today: window.today,
    now,
    timeZone,
  });
  if (!bounds) throw new TaskObligationUnavailableError();
  if (input.performedOn < bounds.periodStart || input.performedOn > bounds.periodEnd) {
    throw new ValidationError('La fecha tiene que estar dentro del período de la tarea.');
  }
  if (input.performedOn < bounds.earliest) {
    throw new ValidationError(
      `Ese día la tarea todavía no estaba planificada así. Elegí una fecha desde el ${formatDisplayDate(bounds.earliest)}.`,
    );
  }

  const status = executorId === occurrence.assignedEmployeeId ? 'personal' : 'covered';
  try {
    await prisma.$transaction(async (tx) => {
      if (actor.role === 'ADMIN') {
        await requireActiveEmployee(
          tx,
          executorId,
          'El empleado indicado no existe o no está activo.',
        );
      }
      const execution = await tx.taskExecution.create({
        data: {
          taskId,
          periodKey: occurrence.periodKey,
          completed: true,
          completedAt: now,
          performedOn: scheduledDateValue(input.performedOn),
          assignedEmployeeId: occurrence.assignedEmployeeId,
          completedByEmployeeId: executorId,
          recordedByUserId: actor.userId,
        },
        select: { id: true },
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'task.completed_late',
        entityType: 'TaskExecution',
        entityId: execution.id,
        newState: {
          taskId,
          periodKey: occurrence.periodKey,
          frequency: occurrence.frequency,
          performedOn: input.performedOn,
          assignedEmployeeId: occurrence.assignedEmployeeId,
          completedByEmployeeId: executorId,
          actorRole: actor.role,
          registeredOnBehalf: executorId !== actor.employeeId,
        },
        ...meta,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new TaskObligationAlreadyCompletedError();
    throw error;
  }
  return {
    completion: {
      taskId,
      periodKey: occurrence.periodKey,
      frequency: occurrence.frequency,
      performedOn: input.performedOn,
      recordedAt: now.toISOString(),
      assignedEmployeeId: occurrence.assignedEmployeeId,
      completedByEmployeeId: executorId,
      status,
    },
  };
}

/** `YYYY-MM-DD` → `dd/mm/aaaa` (mensajes de error). */
const formatDisplayDate = (date: string) => date.split('-').reverse().join('/');

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

/** `frequency`: la de la fila (la que tenía la tarea en esas ejecuciones), no necesariamente la actual. */
function serializeHistoryTask(task: HistoryTaskRow, frequency: TaskFrequency = task.frequency) {
  return {
    id: task.id,
    description: task.description,
    frequency,
    active: task.active,
    assignee: task.employee,
    scheduledDate: scheduledDateText(task.scheduledDate),
  };
}

/**
 * Instante con el que se ubica y ordena una finalización: el registro en el
 * flujo normal; en una carga olvidada, el último instante del día en que se
 * realizó (solo se conoce el día).
 */
function realizationInstant(
  execution: { completedAt: Date | null; performedOn: Date | null },
  timeZone: string,
): number {
  const performedOn = execution.performedOn
    ? parseLocalDate(scheduledDateText(execution.performedOn) ?? '')
    : null;
  if (performedOn) return startOfLocalDay(addDays(performedOn, 1), timeZone).getTime() - 1;
  return execution.completedAt?.getTime() ?? 0;
}

/**
 * Semana lunes-domingo en la zona de negocio. Diarias y semanales: un slot
 * por período; "esperado" = la tarea está activa hoy con esa frecuencia, el
 * período ya empezó y la tarea ya existía. Así `completed / expected` es
 * correcto y nunca el 0% fijo del prototipo. Quincenales, mensuales,
 * bimestrales, anuales, urgentes y únicas: las finalizaciones REALIZADAS en
 * la semana (fecha real de una carga olvidada, o el registro) — esos
 * períodos no entran en una grilla de lunes a domingo, así que no suman slots
 * al denominador realizadas/esperadas. Solo ejecuciones vigentes (las
 * revertidas quedan en la base y en la auditoría). Incluye tareas hoy
 * desactivadas si tuvieron ejecuciones esa semana.
 *
 * Cada ejecución se interpreta con la frecuencia que tenía la tarea cuando se
 * registró (`executionFrequency`, sobre su planificación histórica), nunca
 * solo con la actual: si cambió de frecuencia, sus ejecuciones anteriores
 * quedan en una fila propia (o entre las finalizaciones) y no ocupan un slot
 * de la frecuencia nueva.
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
  const weekEnd = dayKeys[6] as string;
  const rangeStart = startOfLocalDay(weekStart, timeZone);
  const rangeEnd = startOfLocalDay(addDays(weekStart, 7), timeZone);

  const [currentTasks, executions] = await Promise.all([
    prisma.task.findMany({
      where: { active: true, frequency: { in: ['DAILY', 'WEEKLY'] } },
      select: historyTaskSelect,
    }),
    // Las ejecuciones vigentes con clave de un día de la semana (diarias,
    // semanales y mensuales del 1) o realizadas en la semana.
    prisma.taskExecution.findMany({
      where: {
        revertedAt: null,
        OR: [
          { periodKey: { in: dayKeys } },
          { performedOn: null, completedAt: { gte: rangeStart, lt: rangeEnd } },
          {
            performedOn: {
              gte: scheduledDateValue(weekKey) as Date,
              lte: scheduledDateValue(weekEnd) as Date,
            },
          },
        ],
      },
      select: { ...executionSelect, taskId: true, task: { select: historyTaskSelect } },
      orderBy: { completedAt: 'asc' },
    }),
  ]);
  const plans = executions.length
    ? await prisma.taskPlanningInterval.findMany({
        where: { taskId: { in: Array.from(new Set(executions.map((row) => row.taskId))) } },
        select: { taskId: true, frequency: true, validFrom: true },
      })
    : [];

  const matchesEmployee = (assigneeId: string, completedById: string | undefined): boolean =>
    !params.employeeId || assigneeId === params.employeeId || completedById === params.employeeId;

  type RowFrequency = 'DAILY' | 'WEEKLY';
  const rowKey = (taskId: string, frequency: RowFrequency) => `${taskId}|${frequency}`;
  const rows = new Map<
    string,
    { task: HistoryTaskRow; frequency: RowFrequency; expected: boolean }
  >();
  for (const task of currentTasks) {
    const frequency = task.frequency as RowFrequency;
    rows.set(rowKey(task.id, frequency), { task, frequency, expected: true });
  }
  const slotExecutions = new Map<string, (typeof executions)[number]>();
  const others: { execution: (typeof executions)[number]; frequency: TaskFrequency }[] = [];
  for (const execution of executions) {
    const frequency = executionFrequency(
      plans.filter((plan) => plan.taskId === execution.taskId),
      execution,
      execution.task.frequency,
      timeZone,
    );
    if (frequency === 'DAILY' || frequency === 'WEEKLY') {
      const inWeek =
        frequency === 'DAILY'
          ? dayKeys.includes(execution.periodKey)
          : execution.periodKey === weekKey;
      if (!inWeek) continue;
      const key = rowKey(execution.taskId, frequency);
      if (!rows.has(key)) rows.set(key, { task: execution.task, frequency, expected: false });
      slotExecutions.set(`${key}|${execution.periodKey}`, execution);
      continue;
    }
    const realized = realizationInstant(execution, timeZone);
    if (realized >= rangeStart.getTime() && realized < rangeEnd.getTime()) {
      others.push({ execution, frequency });
    }
  }

  let expected = 0;
  let completed = 0;
  const recurring = Array.from(rows.values())
    .sort(
      (a, b) =>
        FREQUENCY_ORDER[a.frequency] - FREQUENCY_ORDER[b.frequency] ||
        a.task.description.localeCompare(b.task.description, 'es') ||
        a.task.id.localeCompare(b.task.id),
    )
    .map((row) => {
      const createdOn = toLocalDate(row.task.createdAt, timeZone);
      const currentPeriodKey = computePeriodKey(row.task.frequency, now, timeZone);
      const slotDates = row.frequency === 'DAILY' ? days : [weekStart];
      const slots = slotDates
        .map((date) => {
          const periodKey = formatLocalDate(date);
          const execution =
            slotExecutions.get(`${rowKey(row.task.id, row.frequency)}|${periodKey}`) ?? null;
          const periodEnd = row.frequency === 'DAILY' ? date : addDays(weekStart, 6);
          const isExpected =
            row.expected &&
            compareLocalDates(date, today) <= 0 &&
            compareLocalDates(createdOn, periodEnd) <= 0;
          const assigneeId = execution?.assignedEmployee.id ?? row.task.employee.id;
          if (!matchesEmployee(assigneeId, execution?.completedByEmployee?.id)) return null;
          if (isExpected) {
            expected += 1;
            if (execution) completed += 1;
          }
          return {
            periodKey,
            expected: isExpected,
            execution: execution
              ? serializeExecution(execution, canRevertAt(actor, execution, currentPeriodKey, now))
              : null,
          };
        })
        .filter((slot): slot is NonNullable<typeof slot> => slot !== null);
      return { task: serializeHistoryTask(row.task, row.frequency), slots };
    })
    .filter((row) => row.slots.some((slot) => slot.expected || slot.execution));

  const otherLines = others
    .filter(({ execution }) =>
      matchesEmployee(execution.assignedEmployee.id, execution.completedByEmployee?.id),
    )
    .sort(
      (a, b) =>
        realizationInstant(a.execution, timeZone) - realizationInstant(b.execution, timeZone),
    )
    .map(({ execution, frequency }) => ({
      task: serializeHistoryTask(execution.task, frequency),
      execution: serializeExecution(
        execution,
        canRevertAt(
          actor,
          execution,
          computePeriodKey(execution.task.frequency, now, timeZone),
          now,
        ),
      ),
    }));

  return {
    week: {
      start: weekKey,
      end: weekEnd,
      days: dayKeys,
      isCurrent: weekKey === formatLocalDate(startOfWeek(today)),
      timeZone,
    },
    summary: { expected, completed },
    recurring,
    others: otherLines,
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
