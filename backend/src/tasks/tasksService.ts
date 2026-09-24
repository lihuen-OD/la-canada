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
  ValidationError,
} from '../errors/AppError';

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

/** Orden operativo del prototipo: urgente → única → diaria → semanal → mensual. */
const FREQUENCY_ORDER: Record<TaskFrequency, number> = {
  URGENT: 0,
  ONE_TIME: 1,
  DAILY: 2,
  WEEKLY: 3,
  MONTHLY: 4,
};

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
  employee: { select: { ...employeeSummarySelect, active: true } },
} as const;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Actor de la request: rol ya validado por `requireAuth`, empleado leído de la base (nunca del body). */
export async function resolveActor(auth: AuthContext): Promise<TaskActor> {
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

function serializeTask(
  task: TaskRow,
  periodKey: string,
  execution: ExecutionRow | null,
  actor: TaskActor,
) {
  const canActOnTasks = actor.role === 'ADMIN' || actor.employeeId !== null;
  return {
    id: task.id,
    description: task.description,
    frequency: task.frequency,
    active: task.active,
    assignee: task.employee,
    periodKey,
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
  return serializeTask(task, periodKey, executions.get(task.id) ?? null, actor);
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
  const serialized = tasks
    .map((task) =>
      serializeTask(
        task,
        computePeriodKey(task.frequency, now, config.businessTimeZone),
        executions.get(task.id) ?? null,
        actor,
      ),
    )
    // Una tarea única ya completada sale del listado operativo (como en el
    // prototipo): se conserva en base y en el historial, y un ADMIN la ve
    // con `status=all`.
    .filter(
      (task) =>
        !(filters.status === 'active' && task.frequency === 'ONE_TIME' && task.currentExecution),
    )
    .sort(
      (a, b) =>
        FREQUENCY_ORDER[a.frequency] - FREQUENCY_ORDER[b.frequency] ||
        a.description.localeCompare(b.description, 'es'),
    );

  const today = toLocalDate(now, config.businessTimeZone);
  return {
    period: {
      today: formatLocalDate(today),
      weekStart: formatLocalDate(startOfWeek(today)),
      timeZone: config.businessTimeZone,
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

export interface CreateTaskInput {
  description: string;
  employeeId: string;
  frequency: TaskFrequency;
}

export async function createTask(
  actor: TaskActor,
  input: CreateTaskInput,
  meta: RequestMeta,
  now = new Date(),
) {
  requireAdmin(actor);
  let taskId: string;
  try {
    taskId = await prisma.$transaction(async (tx) => {
      await requireActiveEmployee(
        tx,
        input.employeeId,
        'El responsable no existe o no está activo.',
      );
      const task = await tx.task.create({ data: input, select: { id: true } });
      await tx.taskPlanningInterval.create({
        data: {
          taskId: task.id,
          employeeId: input.employeeId,
          frequency: input.frequency,
          validFrom: now,
        },
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'task.created',
        entityType: 'Task',
        entityId: task.id,
        newState: { ...input, active: true },
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

export interface UpdateTaskInput {
  description?: string;
  employeeId?: string;
  frequency?: TaskFrequency;
}

/**
 * Reasignar o cambiar la frecuencia nunca reescribe ejecuciones ya creadas:
 * cada una conserva su `assignedEmployeeId` (snapshot) y su `periodKey`.
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
        select: { description: true, employeeId: true, frequency: true, active: true },
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
      if (Object.keys(changes).length === 0) return;

      if (changes.employeeId) {
        await requireActiveEmployee(
          tx,
          changes.employeeId,
          'El responsable no existe o no está activo.',
        );
      }
      if (current.active && (changes.employeeId || changes.frequency)) {
        await tx.taskPlanningInterval.updateMany({
          where: { taskId, validTo: null },
          data: { validTo: now },
        });
        await tx.taskPlanningInterval.create({
          data: {
            taskId,
            employeeId: changes.employeeId ?? current.employeeId,
            frequency: changes.frequency ?? current.frequency,
            validFrom: now,
          },
        });
      }
      await tx.task.update({ where: { id: taskId }, data: changes });
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
      select: { active: true, employeeId: true, frequency: true },
    });
    if (!current) throw new NotFoundError('Tarea no encontrada.');
    if (current.active === active) return;
    if (active) {
      await tx.taskPlanningInterval.create({
        data: {
          taskId,
          employeeId: current.employeeId,
          frequency: current.frequency,
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
  employee: { select: employeeSummarySelect },
} as const;

/**
 * Semana lunes-domingo en la zona de negocio. Diarias y semanales: un slot
 * por período esperado; "esperado" = la tarea está activa hoy, el período ya
 * empezó y la tarea ya existía. Así `completed / expected` es correcto y
 * nunca el 0% fijo del prototipo. Mensuales, urgentes y únicas: las
 * finalizaciones cuya fecha local cae en la semana. Solo ejecuciones
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
      task: { frequency: { in: ['MONTHLY', 'URGENT', 'ONE_TIME'] } },
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
      return {
        task: {
          id: task.id,
          description: task.description,
          frequency: task.frequency,
          active: task.active,
          assignee: task.employee,
        },
        slots,
      };
    })
    .filter((row) => row.slots.some((slot) => slot.expected || slot.execution));

  const others = otherExecutions
    .filter((execution) =>
      matchesEmployee(execution.assignedEmployee.id, execution.completedByEmployee?.id),
    )
    .map((execution) => ({
      task: {
        id: execution.task.id,
        description: execution.task.description,
        frequency: execution.task.frequency,
        active: execution.task.active,
        assignee: execution.task.employee,
      },
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
