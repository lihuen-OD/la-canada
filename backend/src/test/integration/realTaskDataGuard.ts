import { expect } from 'vitest';
import { prisma } from '../../lib/prisma';

/**
 * Guarda de datos REALES de Tareas para las pruebas de integración contra
 * `demo`, que la persona usuaria puede estar usando al mismo tiempo (p. ej.
 * probando la app). Distingue una fuga de la prueba de la actividad real
 * concurrente:
 *
 * - antes de limpiar: ningún actor sintético escribió sobre una entidad real
 *   (toda escritura de Tareas deja auditoría con su actor);
 * - después de limpiar: no queda nada sintético; los conteos de filas creadas
 *   ANTES de empezar no cambiaron; y las tareas reales que nadie tocó durante
 *   la prueba quedan idénticas, con sus ejecuciones e intervalos. Las que otra
 *   persona editó mientras corría la prueba se excluyen de la comparación y se
 *   informa cuántas son: no son una fuga.
 */

const realTask = { NOT: { description: { startsWith: '[test-' } } };

async function rowsCreatedBefore(startedAt: Date) {
  const tasks = { ...realTask, createdAt: { lt: startedAt } };
  const [taskRows, executions, intervals] = await Promise.all([
    prisma.task.findMany({
      where: tasks,
      select: {
        id: true,
        description: true,
        employeeId: true,
        frequency: true,
        active: true,
        scheduledDate: true,
        executionOrder: true,
        suggestedWeekday: true,
        suggestedFirstHalfDay: true,
        suggestedSecondHalfDay: true,
        suggestedMonthDay: true,
        suggestedMonth: true,
        updatedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    prisma.taskExecution.findMany({
      where: { createdAt: { lt: startedAt }, task: tasks },
      select: {
        id: true,
        taskId: true,
        periodKey: true,
        completed: true,
        revertedAt: true,
        updatedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    prisma.taskPlanningInterval.findMany({
      where: { createdAt: { lt: startedAt }, task: tasks },
      select: {
        id: true,
        taskId: true,
        employeeId: true,
        frequency: true,
        scheduledDate: true,
        validFrom: true,
        validTo: true,
      },
      orderBy: { id: 'asc' },
    }),
  ]);
  return { tasks: taskRows, executions, intervals };
}

function countsBefore(startedAt: Date) {
  const before = { createdAt: { lt: startedAt } };
  return Promise.all([
    prisma.task.count({ where: before }),
    prisma.taskExecution.count({ where: before }),
    prisma.taskPlanningInterval.count({ where: before }),
    prisma.auditLog.count({ where: before }),
    prisma.user.count({ where: before }),
    prisma.session.count({ where: before }),
    prisma.employee.count({ where: before }),
  ]);
}

export interface RealTaskState {
  startedAt: Date;
  counts: Awaited<ReturnType<typeof countsBefore>>;
  rows: Awaited<ReturnType<typeof rowsCreatedBefore>>;
}

export async function captureRealTaskState(): Promise<RealTaskState> {
  // Un milisegundo atrás: todo lo que ya existe queda estrictamente antes.
  const startedAt = new Date(Date.now() - 1);
  const [counts, rows] = await Promise.all([countsBefore(startedAt), rowsCreatedBefore(startedAt)]);
  return { startedAt, counts, rows };
}

/** Tareas reales que OTRA persona tocó mientras corría la prueba (auditoría de actores no sintéticos). */
async function touchedConcurrently(state: RealTaskState, syntheticUserIds: string[]) {
  const audits = await prisma.auditLog.findMany({
    where: {
      createdAt: { gte: state.startedAt },
      action: { startsWith: 'task.' },
      OR: [{ actorUserId: null }, { actorUserId: { notIn: syntheticUserIds } }],
    },
    select: { entityType: true, entityId: true },
  });
  const idsOf = (type: string) =>
    audits
      .filter((audit) => audit.entityType === type)
      .map((audit) => audit.entityId)
      .filter((id): id is string => id !== null);
  const executions = await prisma.taskExecution.findMany({
    where: { id: { in: idsOf('TaskExecution') } },
    select: { taskId: true },
  });
  return new Set([...idsOf('Task'), ...executions.map((execution) => execution.taskId)]);
}

/** ANTES de limpiar: ningún actor sintético escribió sobre una tarea o ejecución real. */
export async function assertNoSyntheticWritesOnRealData(
  state: RealTaskState,
  syntheticUserIds: string[],
  syntheticEntityIds: string[],
) {
  expect(
    await prisma.auditLog.count({
      where: {
        createdAt: { gte: state.startedAt },
        actorUserId: { in: syntheticUserIds },
        entityType: { in: ['Task', 'TaskExecution'] },
        entityId: { notIn: syntheticEntityIds },
      },
    }),
  ).toBe(0);
}

/**
 * DESPUÉS de limpiar. Devuelve cuántas tareas reales editó otra persona
 * durante la prueba (excluidas de la comparación).
 */
export async function assertRealTaskStateUnchanged(
  state: RealTaskState,
  syntheticUserIds: string[],
  runId: string,
): Promise<number> {
  expect(await prisma.task.count({ where: { description: { startsWith: `[${runId}]` } } })).toBe(0);
  expect(await prisma.user.count({ where: { username: { startsWith: runId } } })).toBe(0);
  expect(await prisma.employee.count({ where: { code: { startsWith: runId } } })).toBe(0);
  expect(await prisma.auditLog.count({ where: { actorUserId: { in: syntheticUserIds } } })).toBe(0);
  expect(await countsBefore(state.startedAt)).toEqual(state.counts);

  const touched = await touchedConcurrently(state, syntheticUserIds);
  const untouched = <T extends { taskId?: string; id: string }>(rows: T[]) =>
    rows.filter((row) => !touched.has(row.taskId ?? row.id));
  const now = await rowsCreatedBefore(state.startedAt);
  expect(untouched(now.tasks)).toEqual(untouched(state.rows.tasks));
  expect(untouched(now.executions)).toEqual(untouched(state.rows.executions));
  expect(untouched(now.intervals)).toEqual(untouched(state.rows.intervals));
  return state.rows.tasks.filter((task) => touched.has(task.id)).length;
}
