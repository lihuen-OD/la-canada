import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listTasks: vi.fn(),
  listTaskEmployees: vi.fn(),
  listUpcomingEvents: vi.fn(),
  stockItems: vi.fn(),
  eggs: vi.fn(),
  news: vi.fn(),
  getPerformance: vi.fn(),
}));

vi.mock('../../tasks/tasksService', () => ({
  listTasks: mocks.listTasks,
  listTaskEmployees: mocks.listTaskEmployees,
}));
vi.mock('../../more/eventsService', () => ({ listUpcomingEvents: mocks.listUpcomingEvents }));
vi.mock('../../performance/performanceService', () => ({
  getPerformance: mocks.getPerformance,
  defaultPerformanceRange: () => ({ from: '2026-09-19', to: '2026-09-25' }),
}));
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
    mocks.getPerformance.mockResolvedValue({
      range: { from: '2026-09-19', to: '2026-09-25', timeZone: 'America/Argentina/Buenos_Aires' },
      employees: [
        {
          employee: { ...employee, role: 'Rol' },
          assigned: 10,
          completedPersonally: 8,
          percentage: 80,
          pending: 1,
          coverageReceived: 1,
          coverageGiven: 0,
          operationalCompleted: 8,
        },
      ],
    });
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
        targetQuantity: '30',
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
    // El desempeño viene tal cual del calculador canónico, sin campos operativos ni detalle.
    expect(mocks.getPerformance).toHaveBeenCalledWith(
      actor,
      { from: '2026-09-19', to: '2026-09-25' },
      undefined,
      expect.any(Date),
    );
    expect(result.performance).toEqual({
      scope: 'self',
      range: { from: '2026-09-19', to: '2026-09-25', timeZone: 'America/Argentina/Buenos_Aires' },
      employees: [
        {
          employee,
          assigned: 10,
          completedPersonally: 8,
          percentage: 80,
          pending: 1,
          coverageReceived: 1,
          coverageGiven: 0,
        },
      ],
    });
    expect(mocks.listTasks).toHaveBeenCalledWith(actor, { status: 'active' }, expect.any(Date));
  });

  it('alertas de reposición: solo críticos (igual al mínimo incluido), nunca bajos; activos', async () => {
    mocks.listTasks.mockResolvedValue({ tasks: [] });
    const item = (id: string, currentQuantity: string, targetQuantity: string | null) => ({
      id,
      name: `Producto sintético ${id}`,
      area: 'HOUSE',
      unit: 'kg',
      minimumQuantity: '20',
      targetQuantity,
      currentQuantity,
    });
    mocks.stockItems.mockResolvedValue([
      item('igual-al-minimo', '20', '50'),
      item('debajo', '19', '50'),
      item('bajo', '35', '50'),
      item('normal', '35.01', '50'),
      item('sin-objetivo-critico', '3', null),
      item('sin-objetivo-pendiente', '25', null),
    ]);
    const result = await getDashboard(actor, new Date('2026-09-25T12:00:00.000Z'));
    expect(mocks.stockItems).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
    expect(result.stockAlerts.map((alert) => alert.id)).toEqual([
      'igual-al-minimo',
      'debajo',
      'sin-objetivo-critico',
    ]);
    expect(result.kpis.stockAlerts).toBe(3);
    expect(result.stockAlerts.every((alert) => alert.stockLevel === 'critical')).toBe(true);
    expect(result.stockAlerts.find((alert) => alert.id === 'debajo')).toMatchObject({
      targetQuantity: '50',
      suggestedPurchaseQuantity: '31',
    });
    expect(
      result.stockAlerts.find((alert) => alert.id === 'sin-objetivo-critico')
        ?.suggestedPurchaseQuantity,
    ).toBeNull();
  });

  it('EMPLOYEE sin empleado vinculado: sin desempeño y sin consultarlo', async () => {
    mocks.listTasks.mockResolvedValue({ tasks: [] });
    const result = await getDashboard({ ...actor, employeeId: null });
    expect(result.performance).toBeNull();
    expect(mocks.getPerformance).not.toHaveBeenCalled();
  });

  it('resuelve las seis ramas en paralelo y limita eventos/novedades al contrato', async () => {
    mocks.listTasks.mockResolvedValue({ tasks: [] });
    await getDashboard(actor);
    expect(mocks.listUpcomingEvents).toHaveBeenCalledWith(expect.anything(), 3, expect.any(Date));
    expect(mocks.news).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
    expect(mocks.stockItems).toHaveBeenCalledTimes(1);
    expect(mocks.eggs).toHaveBeenCalledTimes(1);
  });
});
