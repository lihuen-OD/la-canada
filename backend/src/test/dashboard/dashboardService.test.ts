import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listTasks: vi.fn(),
  listTaskEmployees: vi.fn(),
  listUpcomingEvents: vi.fn(),
  stockItems: vi.fn(),
  eggs: vi.fn(),
  news: vi.fn(),
}));

vi.mock('../../tasks/tasksService', () => ({
  listTasks: mocks.listTasks,
  listTaskEmployees: mocks.listTaskEmployees,
}));
vi.mock('../../more/eventsService', () => ({ listUpcomingEvents: mocks.listUpcomingEvents }));
vi.mock('../../lib/prisma', () => ({
  prisma: {
    stockItem: { findMany: mocks.stockItems },
    eggCollection: { aggregate: mocks.eggs },
    newsReport: { findMany: mocks.news },
  },
}));

import { getDashboard } from '../../dashboard/dashboardService';

const employee = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Persona',
  colorHex: '#4a7c59',
};
const actor = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'EMPLOYEE' as const,
  employeeId: employee.id,
};

describe('getDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTaskEmployees.mockResolvedValue({ employees: [employee] });
    mocks.listUpcomingEvents.mockResolvedValue([]);
    mocks.stockItems.mockResolvedValue([]);
    mocks.eggs.mockResolvedValue({ _sum: { goodEggsCount: null } });
    mocks.news.mockResolvedValue([]);
  });

  it('calcula KPIs y avance con la finalización del período vigente', async () => {
    mocks.listTasks.mockResolvedValue({
      tasks: [
        {
          id: 't1',
          description: 'Urgente',
          frequency: 'URGENT',
          assignee: employee,
          currentExecution: null,
        },
        {
          id: 't2',
          description: 'Diaria',
          frequency: 'DAILY',
          assignee: employee,
          currentExecution: { id: 'x' },
        },
      ],
    });
    mocks.stockItems.mockResolvedValue([
      {
        id: 's1',
        name: 'Producto',
        area: 'HOUSE',
        unit: 'u',
        minimumQuantity: '10',
        currentQuantity: '0',
      },
    ]);
    mocks.eggs.mockResolvedValue({ _sum: { goodEggsCount: 6 } });
    const result = await getDashboard(actor, new Date('2026-09-25T12:00:00.000Z'));
    expect(result.kpis).toEqual({
      tasksCompleted: 1,
      tasksTotal: 2,
      urgentPending: 1,
      stockAlerts: 1,
      goodEggsToday: 6,
    });
    expect(result.teamProgress[0]).toMatchObject({ completed: 1, total: 2, percentage: 50 });
    expect(mocks.listTasks).toHaveBeenCalledWith(actor, { status: 'active' }, expect.any(Date));
  });

  it('resuelve las seis ramas en paralelo y limita eventos/novedades al contrato', async () => {
    mocks.listTasks.mockResolvedValue({ tasks: [] });
    await getDashboard(actor);
    expect(mocks.listUpcomingEvents).toHaveBeenCalledWith(3, expect.any(Date));
    expect(mocks.news).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
    expect(mocks.stockItems).toHaveBeenCalledTimes(1);
    expect(mocks.eggs).toHaveBeenCalledTimes(1);
  });
});
