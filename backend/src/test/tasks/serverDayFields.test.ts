import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fecha de negocio y hora del servidor en las respuestas que usa el reloj del
 * día del frontend (docs/ARCHITECTURE.md §39.1): el backend es la autoridad.
 */
const mocks = vi.hoisted(() => ({
  tasks: vi.fn(),
  employees: vi.fn(),
  plans: vi.fn(),
  executions: vi.fn(),
  taskCount: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    task: { findMany: mocks.tasks, count: mocks.taskCount },
    employee: { findMany: mocks.employees, findUnique: vi.fn() },
    taskPlanningInterval: { findMany: mocks.plans },
    taskExecution: { findMany: mocks.executions },
  },
}));

import { listTasks } from '../../tasks/tasksService';
import { getPerformance } from '../../performance/performanceService';

const admin = { userId: 'u-admin', role: 'ADMIN' as const, employeeId: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tasks.mockResolvedValue([]);
  mocks.employees.mockResolvedValue([]);
  mocks.plans.mockResolvedValue([]);
  mocks.executions.mockResolvedValue([]);
  mocks.taskCount.mockResolvedValue(0);
});

describe('fecha y hora del servidor para el reloj del día', () => {
  it('Tareas: 23:59 en Buenos Aires sigue siendo el día local, con la hora exacta del servidor', async () => {
    const now = new Date('2026-10-26T02:59:30.000Z'); // 25/10 23:59:30 AR
    const { period } = await listTasks(admin, { status: 'active' }, now);
    expect(period).toMatchObject({
      today: '2026-10-25',
      weekStart: '2026-10-19',
      generatedAt: '2026-10-26T02:59:30.000Z',
    });
  });

  it('Desempeño: `range.today` es el día del servidor aunque el rango pedido termine después', async () => {
    const now = new Date('2026-10-26T02:59:30.000Z'); // todavía 25/10 en AR
    // Un dispositivo adelantado pediría un rango que termina el 26/10.
    const result = await getPerformance(
      admin,
      { from: '2026-10-20', to: '2026-10-26' },
      undefined,
      now,
    );
    expect(result.generatedAt).toBe('2026-10-26T02:59:30.000Z');
    expect(result.range).toMatchObject({
      to: '2026-10-25',
      today: '2026-10-25',
      includesCurrentDay: true,
    });
    const closed = await getPerformance(
      admin,
      { from: '2026-10-13', to: '2026-10-19' },
      undefined,
      new Date('2026-10-26T03:00:01.000Z'),
    );
    expect(closed.range).toMatchObject({ to: '2026-10-19', today: '2026-10-26' });
  });
});
