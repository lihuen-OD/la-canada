import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  employeeFindUnique: vi.fn(),
  employeeFindMany: vi.fn(),
  plans: vi.fn(),
  executions: vi.fn(),
  taskCount: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    employee: { findUnique: mocks.employeeFindUnique, findMany: mocks.employeeFindMany },
    taskPlanningInterval: { findMany: mocks.plans },
    taskExecution: { findMany: mocks.executions },
    task: { count: mocks.taskCount },
  },
}));

import { ForbiddenError } from '../../errors/AppError';
import { getPerformance } from '../../performance/performanceService';

const JUAN = '11111111-1111-4111-8111-111111111111';
const COKE = '22222222-2222-4222-8222-222222222222';
const employees = [
  { id: COKE, displayName: 'Coke (sintética)', role: 'Doméstica', colorHex: '#4a7c59' },
  { id: JUAN, displayName: 'Juan (sintético)', role: 'Parque', colorHex: '#2c5364' },
];
const admin = { userId: 'u-admin', role: 'ADMIN' as const, employeeId: null };
const juanActor = { userId: 'u-juan', role: 'EMPLOYEE' as const, employeeId: JUAN };
// Rango 20–24/09 cerrado; "ahora" es el 28/09 en Buenos Aires.
const NOW = new Date('2026-09-28T15:00:00Z');
const RANGE = { from: '2026-09-11', to: '2026-09-24' }; // 14 días
const DAYS = Array.from({ length: 10 }, (_, i) => `2026-09-${String(15 + i).padStart(2, '0')}`);

/** Juan: una DAILY (10 días en el rango). 8 las hace él, el día 9 lo cubre Coke, el 10 queda pendiente. */
function scenario() {
  mocks.plans.mockResolvedValue([
    {
      id: 'p1',
      taskId: 't-juan',
      employeeId: JUAN,
      frequency: 'DAILY',
      // Planificada desde el 15/09: 10 días dentro del rango de 14.
      validFrom: new Date('2026-09-15T03:00:00Z'),
      validTo: null,
      task: { description: 'Regar (sintética)' },
    },
    {
      id: 'p2',
      taskId: 't-coke',
      employeeId: COKE,
      frequency: 'WEEKLY',
      validFrom: new Date('2026-09-01T03:00:00Z'),
      validTo: null,
      task: { description: 'Cocina (sintética)' },
    },
  ]);
  mocks.executions.mockResolvedValue([
    ...DAYS.slice(0, 9).map((periodKey, i) => ({
      id: `x${i}`,
      taskId: 't-juan',
      periodKey,
      assignedEmployeeId: JUAN,
      completedByEmployeeId: i < 8 ? JUAN : COKE,
      completedAt: new Date(`${periodKey}T15:00:00Z`),
    })),
    {
      id: 'xc',
      taskId: 't-coke',
      periodKey: '2026-09-15',
      assignedEmployeeId: COKE,
      completedByEmployeeId: COKE,
      completedAt: new Date('2026-09-15T16:00:00Z'),
    },
  ]);
}

describe('getPerformance — regla personal y permisos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.employeeFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      employees.some((e) => e.id === where.id) ? { id: where.id } : null,
    );
    mocks.employeeFindMany.mockResolvedValue(employees);
    mocks.taskCount.mockResolvedValue(0);
    scenario();
  });

  it('ADMIN ve a todos: Juan 8/10 = 80% con 1 cobertura recibida; Coke 1 cobertura realizada sin cambiar su %', async () => {
    const result = await getPerformance(admin, RANGE, undefined, NOW);
    const juan = result.employees.find((row) => row.employee.id === JUAN)!;
    const coke = result.employees.find((row) => row.employee.id === COKE)!;
    expect(juan).toMatchObject({
      assigned: 10,
      completedPersonally: 8,
      percentage: 80,
      pending: 1,
      coverageReceived: 1,
      coverageGiven: 0,
      operationalCompleted: 8,
    });
    // WEEKLY de Coke: semanas del 14/09 (fuera del inicio del rango, cierra dentro) y del 21/09.
    expect(coke).toMatchObject({ coverageGiven: 1, coverageReceived: 0 });
    expect(coke.percentage).toBe(
      Math.round((coke.completedPersonally / coke.assigned) * 1000) / 10,
    );
    expect(coke.operationalCompleted).toBe(coke.completedPersonally + 1);
    expect(result.occurrences).toBeUndefined();
  });

  it('ADMIN puede pedir el detalle de cualquier persona, con el estado de cada obligación', async () => {
    const result = await getPerformance(admin, RANGE, JUAN, NOW);
    expect(result.employees.map((row) => row.employee.id)).toEqual([JUAN]);
    const statuses = result
      .occurrences!.filter((o) => o.assignedEmployeeId === JUAN)
      .map((o) => o.status);
    expect(statuses.filter((s) => s === 'personal')).toHaveLength(8);
    expect(statuses.filter((s) => s === 'covered')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'pending')).toHaveLength(1);
  });

  it('EMPLOYEE no puede consultar a otra persona', async () => {
    await expect(getPerformance(juanActor, RANGE, COKE, NOW)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mocks.executions).not.toHaveBeenCalled();
  });

  it('EMPLOYEE solo recibe su propio desempeño aunque no indique persona', async () => {
    const result = await getPerformance(juanActor, RANGE, undefined, NOW);
    expect(result.employees.map((row) => row.employee.id)).toEqual([JUAN]);
    expect(result.employees[0]).toMatchObject({ percentage: 80, coverageReceived: 1 });
    // El detalle no revela otras personas salvo quien cubrió su propia tarea.
    expect(result.occurrences!.every((o) => o.assignedEmployeeId === JUAN)).toBe(true);
  });

  it('consultas constantes: 4 en paralelo (+1 de existencia con persona), solo ejecuciones vigentes y URGENT/ONE_TIME en la misma sentencia', async () => {
    await getPerformance(admin, RANGE, undefined, NOW);
    expect(mocks.employeeFindUnique).not.toHaveBeenCalled();
    for (const fn of [mocks.employeeFindMany, mocks.plans, mocks.executions, mocks.taskCount]) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
    const where = mocks.executions.mock.calls[0]![0].where;
    expect(where.revertedAt).toBeNull();
    expect(where.OR[0].periodKey).toEqual({ gte: '2026-09-11', lte: '2026-09-24' });
    expect(where.OR[1].periodKey).toEqual({ in: ['URGENT', 'ONE_TIME'] });
    expect(where.OR[1].task.planningIntervals.some.frequency).toEqual({
      in: ['URGENT', 'ONE_TIME'],
    });
    // Quincenas que EMPIEZAN en el rango (11–24/09: solo la del 16), con su clave propia.
    expect(where.OR[2].periodKey).toEqual({ in: ['2026-09-Q2'] });
  });

  it('SEMI_MONTHLY: una obligación por quincena que empieza en el rango, con su propia clave', async () => {
    mocks.plans.mockResolvedValue([
      {
        id: 'pq',
        taskId: 't-q',
        employeeId: JUAN,
        frequency: 'SEMI_MONTHLY',
        validFrom: new Date('2026-08-20T12:00:00Z'),
        validTo: null,
        task: { description: 'Quincenal (sintética)' },
      },
    ]);
    mocks.executions.mockResolvedValue([
      {
        id: 'xq',
        taskId: 't-q',
        periodKey: '2026-09-Q2',
        assignedEmployeeId: JUAN,
        completedByEmployeeId: JUAN,
        completedAt: new Date('2026-09-20T12:00:00Z'),
      },
    ]);
    const result = await getPerformance(admin, RANGE, JUAN, NOW);
    expect(result.occurrences!.map((o) => [o.periodKey, o.status])).toEqual([
      ['2026-09-Q2', 'personal'],
    ]);
    expect(result.employees[0]).toMatchObject({ assigned: 1, completedPersonally: 1 });
    expect(result.trend).toEqual([
      { periodKey: '2026-09-Q2', assigned: 1, completedPersonally: 1, percentage: 100 },
    ]);
  });

  it('URGENT y ONE_TIME entran al porcentaje una sola vez, con cobertura', async () => {
    mocks.plans.mockResolvedValue([
      {
        id: 'pu',
        taskId: 't-u',
        employeeId: JUAN,
        frequency: 'URGENT',
        validFrom: new Date('2026-09-10T12:00:00Z'),
        validTo: null,
        task: { description: 'Urgente (sintética)' },
      },
      {
        id: 'po',
        taskId: 't-o',
        employeeId: JUAN,
        frequency: 'ONE_TIME',
        validFrom: new Date('2026-09-16T12:00:00Z'),
        validTo: null,
        task: { description: 'Única (sintética)' },
      },
    ]);
    mocks.executions.mockResolvedValue([
      {
        id: 'xu',
        taskId: 't-u',
        periodKey: 'URGENT',
        assignedEmployeeId: JUAN,
        completedByEmployeeId: COKE,
        completedAt: new Date('2026-09-18T12:00:00Z'),
      },
    ]);
    const result = await getPerformance(admin, RANGE, undefined, NOW);
    expect(result.employees.find((row) => row.employee.id === JUAN)).toMatchObject({
      assigned: 2,
      completedPersonally: 0,
      pending: 1,
      coverageReceived: 1,
    });
    expect(result.special).toMatchObject({ urgentCompleted: 1, oneTimeCompleted: 0 });
    expect(result.trend).toEqual([]);
  });

  it.each([7, 14, 30])('acepta exactamente %i días', async (days) => {
    const to = new Date(Date.UTC(2026, 8, 24));
    const from = new Date(to.getTime() - (days - 1) * 86_400_000);
    await expect(
      getPerformance(
        admin,
        { from: from.toISOString().slice(0, 10), to: '2026-09-24' },
        undefined,
        NOW,
      ),
    ).resolves.toMatchObject({ range: { maxDays: 30 } });
  });

  it.each([
    ['90 días (ya no es público)', '2026-06-27'],
    ['10 días', '2026-09-15'],
    ['31 días', '2026-08-25'],
  ])('rechaza %s', async (_label, from) => {
    await expect(getPerformance(admin, { from, to: '2026-09-24' }, undefined, NOW)).rejects.toThrow(
      'El rango debe ser de 7, 14 o 30 días.',
    );
    expect(mocks.executions).not.toHaveBeenCalled();
  });

  it('ya no expone racha en ninguna fila', async () => {
    const result = await getPerformance(admin, RANGE, undefined, NOW);
    for (const row of result.employees) expect(row).not.toHaveProperty('dailyStreak');
  });
});

describe('getPerformance — acciones del detalle (carga olvidada), decididas en el backend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.employeeFindUnique.mockResolvedValue({ id: JUAN });
    mocks.employeeFindMany.mockResolvedValue(employees);
    mocks.taskCount.mockResolvedValue(0);
    scenario();
  });

  const pendingOf = (result: Awaited<ReturnType<typeof getPerformance>>) =>
    result.occurrences!.filter((o) => o.status === 'pending');

  it('EMPLOYEE: su diaria pendiente del 24/09 se puede marcar, con la fecha fijada por la fila', async () => {
    const result = await getPerformance(juanActor, RANGE, undefined, NOW);
    const [pending] = pendingOf(result);
    expect(pending).toMatchObject({
      periodKey: '2026-09-24',
      lateCompletion: {
        periodStart: '2026-09-24',
        periodEnd: '2026-09-24',
        earliest: '2026-09-24',
        latest: '2026-09-24',
      },
    });
    // Las realizadas o cubiertas no tienen acción.
    for (const done of result.occurrences!.filter((o) => o.status !== 'pending')) {
      expect(done).not.toHaveProperty('lateCompletion');
      expect(done).not.toHaveProperty('completeInTasks');
    }
  });

  it('ADMIN ve la misma acción en el detalle de cualquier persona; el resumen sin detalle no trae filas', async () => {
    const detail = await getPerformance(admin, RANGE, JUAN, NOW);
    expect(pendingOf(detail)[0]).toHaveProperty('lateCompletion');
    expect((await getPerformance(admin, RANGE, undefined, NOW)).occurrences).toBeUndefined();
  });

  it('obligaciones fuera de los 30 días del rango más largo: sin acción', async () => {
    // "Ahora" el 30/10: el período del 24/09 quedó fuera de la ventana (01/10–30/10).
    const result = await getPerformance(
      juanActor,
      { from: '2026-09-11', to: '2026-09-24' },
      undefined,
      new Date('2026-10-30T15:00:00Z'),
    );
    expect(pendingOf(result)[0]).not.toHaveProperty('lateCompletion');
  });

  it('carga olvidada registrada: fecha real, momento de registro y quién la puede deshacer', async () => {
    mocks.executions.mockResolvedValue([
      {
        id: 'x-late',
        taskId: 't-juan',
        periodKey: '2026-09-24',
        assignedEmployeeId: JUAN,
        completedByEmployeeId: JUAN,
        completedAt: new Date('2026-09-28T13:00:00Z'),
        performedOn: new Date('2026-09-24T00:00:00.000Z'),
        recordedByUserId: 'u-juan',
      },
    ]);
    const own = await getPerformance(juanActor, RANGE, undefined, NOW);
    const row = own.occurrences!.find((o) => o.periodKey === '2026-09-24')!;
    expect(row).toMatchObject({
      status: 'personal',
      lateRegistration: {
        executionId: 'x-late',
        performedOn: '2026-09-24',
        recordedAt: '2026-09-28T13:00:00.000Z',
        canRevert: true,
      },
    });
    expect(row).not.toHaveProperty('lateCompletion');
    // Al día siguiente el EMPLOYEE ya no la deshace; un ADMIN sí (con motivo).
    const nextDay = new Date('2026-09-29T15:00:00Z');
    const later = await getPerformance(
      juanActor,
      { from: '2026-09-12', to: '2026-09-25' },
      undefined,
      nextDay,
    );
    expect(
      later.occurrences!.find((o) => o.periodKey === '2026-09-24')!.lateRegistration,
    ).toMatchObject({ canRevert: false });
    const byAdmin = await getPerformance(admin, RANGE, JUAN, nextDay);
    expect(
      byAdmin.occurrences!.find((o) => o.periodKey === '2026-09-24')!.lateRegistration,
    ).toMatchObject({ canRevert: true });
  });

  it('«Una vez» y urgentes pendientes se completan en Tareas (si siguen activas); nunca con período inventado', async () => {
    const single = (taskId: string, frequency: 'URGENT' | 'ONE_TIME', validTo: Date | null) => ({
      id: `p-${taskId}`,
      taskId,
      employeeId: JUAN,
      frequency,
      validFrom: new Date('2026-09-16T12:00:00Z'),
      validTo,
      task: { description: `${frequency} ${taskId} (sintética)` },
    });
    mocks.plans.mockResolvedValue([
      single('t-u', 'URGENT', null),
      single('t-o', 'ONE_TIME', null),
      single('t-off', 'ONE_TIME', new Date('2026-09-20T12:00:00Z')),
    ]);
    mocks.executions.mockResolvedValue([]);
    const result = await getPerformance(juanActor, RANGE, undefined, NOW);
    const byTask = new Map(result.occurrences!.map((o) => [o.taskId, o]));
    expect(byTask.get('t-u')).toMatchObject({ completeInTasks: true });
    expect(byTask.get('t-o')).toMatchObject({ completeInTasks: true });
    expect(byTask.get('t-off')).not.toHaveProperty('completeInTasks');
    for (const row of byTask.values()) expect(row).not.toHaveProperty('lateCompletion');
  });
});
