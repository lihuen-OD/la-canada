import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Orden de realización en el listado operativo (`listTasks`, con Prisma
 * simulado): dentro de cada frecuencia, primero las numeradas de menor a
 * mayor y después las sin orden; en empates, el criterio de siempre con un
 * desempate estable por id. Las tareas sin orden quedan como antes.
 */
const mocks = vi.hoisted(() => ({ tasks: vi.fn(), executions: vi.fn() }));
vi.mock('../../lib/prisma', () => ({
  prisma: {
    task: { findMany: mocks.tasks },
    taskExecution: { findMany: mocks.executions },
  },
}));

import { listTasks } from '../../tasks/tasksService';

const admin = { userId: 'u-admin', role: 'ADMIN' as const, employeeId: null };
const NOW = new Date('2026-10-26T15:00:00.000Z'); // lunes 26/10 12:00 AR
const employee = { id: 'e-1', displayName: 'Persona sintética', colorHex: '#4a7c59', active: true };
let id = 0;
const row = (
  description: string,
  frequency: string,
  extra: Partial<Record<string, unknown>> = {},
) => ({
  id: `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  description,
  frequency,
  active: true,
  scheduledDate: null,
  executionOrder: null,
  suggestedWeekday: null,
  suggestedFirstHalfDay: null,
  suggestedSecondHalfDay: null,
  suggestedMonthDay: null,
  suggestedMonth: null,
  employee,
  ...extra,
});

beforeEach(() => {
  id = 0;
  mocks.tasks.mockReset();
  mocks.executions.mockResolvedValue([]);
});

const names = async () =>
  (await listTasks(admin, { status: 'active' }, NOW)).tasks.map((task) => task.description);

describe('orden de realización', () => {
  it('sin orden en ninguna tarea: exactamente el orden anterior (frecuencia y descripción)', async () => {
    mocks.tasks.mockResolvedValue([
      row('Mensual B', 'MONTHLY'),
      row('Diaria Z', 'DAILY'),
      row('Urgente', 'URGENT'),
      row('Diaria A', 'DAILY'),
      row('Semanal', 'WEEKLY'),
    ]);
    expect(await names()).toEqual(['Urgente', 'Diaria A', 'Diaria Z', 'Semanal', 'Mensual B']);
  });

  it('dentro de cada frecuencia: numeradas ascendentes, repetidas por descripción, después las sin orden', async () => {
    mocks.tasks.mockResolvedValue([
      row('Diaria sin orden A', 'DAILY'),
      row('Diaria orden 2 B', 'DAILY', { executionOrder: 2 }),
      row('Diaria orden 10', 'DAILY', { executionOrder: 10 }),
      row('Diaria orden 2 A', 'DAILY', { executionOrder: 2 }),
      row('Diaria orden 1', 'DAILY', { executionOrder: 1 }),
      row('Diaria sin orden B', 'DAILY'),
      row('Semanal orden 1', 'WEEKLY', { executionOrder: 1 }),
      row('Urgente orden 5', 'URGENT', { executionOrder: 5 }),
    ]);
    expect(await names()).toEqual([
      'Urgente orden 5',
      'Diaria orden 1',
      'Diaria orden 2 A',
      'Diaria orden 2 B',
      'Diaria orden 10',
      'Diaria sin orden A',
      'Diaria sin orden B',
      'Semanal orden 1',
    ]);
  });

  it('empate total (misma descripción, otro responsable): desempate estable por id, sin importar el orden de llegada', async () => {
    const first = row('Regar', 'DAILY', { executionOrder: 3 });
    const second = row('Regar', 'DAILY', {
      executionOrder: 3,
      employee: { ...employee, id: 'e-2' },
    });
    mocks.tasks.mockResolvedValue([second, first]);
    const a = (await listTasks(admin, { status: 'active' }, NOW)).tasks.map((task) => task.id);
    mocks.tasks.mockResolvedValue([first, second]);
    const b = (await listTasks(admin, { status: 'active' }, NOW)).tasks.map((task) => task.id);
    expect(a).toEqual([first.id, second.id]);
    expect(b).toEqual(a);
  });

  it('«Una vez»: el orden manda primero; sin orden, el criterio de fechas de siempre', async () => {
    mocks.tasks.mockResolvedValue([
      row('Única sin fecha', 'ONE_TIME'),
      row('Única con fecha', 'ONE_TIME', { scheduledDate: new Date('2026-10-30T00:00:00Z') }),
      row('Única orden 1 sin fecha', 'ONE_TIME', { executionOrder: 1 }),
    ]);
    expect(await names()).toEqual([
      'Única orden 1 sin fecha',
      'Única con fecha',
      'Única sin fecha',
    ]);
  });

  it('el DTO trae el orden, la sugerencia y la fecha sugerida del período (solo informativa)', async () => {
    mocks.tasks.mockResolvedValue([
      row('Semanal', 'WEEKLY', { executionOrder: 4, suggestedWeekday: 3 }),
      row('Diaria', 'DAILY'),
    ]);
    const { tasks } = await listTasks(admin, { status: 'active' }, NOW);
    expect(tasks.find((task) => task.description === 'Semanal')).toMatchObject({
      executionOrder: 4,
      suggestedWeekday: 3,
      suggestedDate: '2026-10-28',
      canComplete: true,
      scheduleStatus: null,
    });
    expect(tasks.find((task) => task.description === 'Diaria')).toMatchObject({
      executionOrder: null,
      suggestedDate: null,
    });
  });
});
