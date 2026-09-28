import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Consistencia Inicio ↔ Tareas → Desempeño: se ejecutan las funciones REALES
 * (`getPerformance` y `getDashboard`) sobre el mismo escenario simulado de
 * Prisma. Solo se simulan la base y las ramas ajenas al desempeño.
 */
const mocks = vi.hoisted(() => ({
  plans: vi.fn(),
  executions: vi.fn(),
}));

const JUAN = '11111111-1111-4111-8111-111111111111';
const COKE = '22222222-2222-4222-8222-222222222222';
const EMPLOYEES = [
  { id: COKE, displayName: 'Coke (sintética)', role: 'Doméstica', colorHex: '#4a7c59' },
  { id: JUAN, displayName: 'Juan (sintético)', role: 'Parque', colorHex: '#2c5364' },
];

vi.mock('../../lib/prisma', () => ({
  prisma: {
    employee: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        EMPLOYEES.some((e) => e.id === where.id) ? { id: where.id } : null,
      findMany: async () => EMPLOYEES,
    },
    taskPlanningInterval: { findMany: mocks.plans },
    taskExecution: { findMany: mocks.executions },
    task: { count: async () => 0 },
    stockItem: { findMany: async () => [] },
    eggCollection: { aggregate: async () => ({ _sum: { goodEggsCount: null } }) },
    newsReport: { findMany: async () => [] },
  },
}));
vi.mock('../../tasks/tasksService', () => ({ listTasks: async () => ({ tasks: [] }) }));
vi.mock('../../more/eventsService', () => ({ listUpcomingEvents: async () => [] }));

import { getDashboard } from '../../dashboard/dashboardService';
import { defaultPerformanceRange, getPerformance } from '../../performance/performanceService';

// Jueves 03/09/2026 12:00 en Buenos Aires: la ventana de 7 días (28/08–03/09)
// incluye un lunes (31/08) y un primero de mes (01/09) — entran los cinco tipos.
const NOW = new Date('2026-09-03T15:00:00Z');
const DAILY_DAYS = [
  '2026-08-29',
  '2026-08-30',
  '2026-08-31',
  '2026-09-01',
  '2026-09-02',
  '2026-09-03',
];
type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'URGENT' | 'ONE_TIME';
const since = new Date('2026-08-29T03:00:00Z');
const plan = (taskId: string, employeeId: string, frequency: Frequency, validFrom = since) => ({
  id: `p-${taskId}`,
  taskId,
  employeeId,
  frequency,
  validFrom,
  validTo: null,
  task: { description: `${taskId} (sintética)` },
});
const execution = (taskId: string, periodKey: string, assigned: string, by: string) => ({
  id: `x-${taskId}-${periodKey}`,
  taskId,
  periodKey,
  assignedEmployeeId: assigned,
  completedByEmployeeId: by,
  completedAt: new Date('2026-09-02T15:00:00Z'),
});

/**
 * Juan: 6 diarias + 1 semanal + 1 mensual + 1 urgente + 1 única = 10
 * obligaciones. `covered` la cubre Coke; `pending` queda sin hacer; el resto
 * lo hace Juan. Coke: una semanal propia hecha por ella.
 */
function scenario(covered: Frequency, pending: Frequency, withCoverage = true) {
  mocks.plans.mockResolvedValue([
    plan('t-d', JUAN, 'DAILY'),
    plan('t-w', JUAN, 'WEEKLY', new Date('2026-08-20T03:00:00Z')),
    plan('t-m', JUAN, 'MONTHLY', new Date('2026-08-20T03:00:00Z')),
    plan('t-u', JUAN, 'URGENT'),
    plan('t-o', JUAN, 'ONE_TIME'),
    plan('t-cw', COKE, 'WEEKLY', new Date('2026-08-20T03:00:00Z')),
  ]);
  const juanItems: [Frequency, string, string][] = [
    ...DAILY_DAYS.map((day): [Frequency, string, string] => ['DAILY', 't-d', day]),
    ['WEEKLY', 't-w', '2026-08-31'],
    ['MONTHLY', 't-m', '2026-09-01'],
    ['URGENT', 't-u', 'URGENT'],
    ['ONE_TIME', 't-o', 'ONE_TIME'],
  ];
  // En DAILY, la cubierta es el primer día y la pendiente el último.
  const pick = (frequency: Frequency, index: number) =>
    juanItems.findIndex(([f]) => f === frequency) + (frequency === 'DAILY' ? index : 0);
  const coveredIndex = pick(covered, 0);
  const pendingIndex = pick(pending, DAILY_DAYS.length - 1);
  mocks.executions.mockResolvedValue([
    ...juanItems.flatMap(([, taskId, key], i) =>
      i === pendingIndex
        ? []
        : i === coveredIndex
          ? withCoverage
            ? [execution(taskId, key, JUAN, COKE)]
            : []
          : [execution(taskId, key, JUAN, JUAN)],
    ),
    execution('t-cw', '2026-08-31', COKE, COKE),
  ]);
}

const admin = { userId: 'u-admin', role: 'ADMIN' as const, employeeId: null };
const juanActor = { userId: 'u-juan', role: 'EMPLOYEE' as const, employeeId: JUAN };
const cokeActor = { userId: 'u-coke', role: 'EMPLOYEE' as const, employeeId: COKE };
const canonical = {
  assigned: 10,
  completedPersonally: 8,
  percentage: 80,
  pending: 1,
  coverageReceived: 1,
  coverageGiven: 0,
};

describe('Inicio y Desempeño comparten el mismo cálculo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('el rango de Inicio es el predeterminado de Desempeño (7 días en la zona de negocio)', () => {
    expect(defaultPerformanceRange(NOW)).toEqual({ from: '2026-08-28', to: '2026-09-03' });
  });

  const pairs: [Frequency, Frequency][] = [
    ['DAILY', 'ONE_TIME'],
    ['WEEKLY', 'DAILY'],
    ['MONTHLY', 'URGENT'],
    ['URGENT', 'MONTHLY'],
    ['ONE_TIME', 'WEEKLY'],
  ];
  it.each(pairs)(
    'cobertura en %s, pendiente en %s: Juan 8/10 = 80% en ambas pantallas',
    async (covered, pending) => {
      scenario(covered, pending);
      const range = defaultPerformanceRange(NOW);

      const performanceAdmin = await getPerformance(admin, range, undefined, NOW);
      const juanRow = performanceAdmin.employees.find((row) => row.employee.id === JUAN)!;
      const cokeRow = performanceAdmin.employees.find((row) => row.employee.id === COKE)!;
      expect(juanRow).toMatchObject(canonical);
      expect(cokeRow).toMatchObject({
        assigned: 1,
        completedPersonally: 1,
        percentage: 100,
        coverageGiven: 1,
      });

      const dashboardAdmin = await getDashboard(admin, NOW);
      expect(dashboardAdmin.performance?.scope).toBe('team');
      expect(dashboardAdmin.performance?.range).toMatchObject(range);
      expect(
        dashboardAdmin.performance?.employees.find((row) => row.employee.id === JUAN),
      ).toMatchObject(canonical);
      expect(
        dashboardAdmin.performance?.employees.find((row) => row.employee.id === COKE),
      ).toMatchObject({
        percentage: 100,
        coverageGiven: 1,
      });

      // Juan autenticado: mismas cifras en Desempeño y en Inicio, y nada de Coke.
      const performanceJuan = await getPerformance(juanActor, range, undefined, NOW);
      const dashboardJuan = await getDashboard(juanActor, NOW);
      expect(performanceJuan.employees).toHaveLength(1);
      expect(performanceJuan.employees[0]).toMatchObject(canonical);
      expect(dashboardJuan.performance).toEqual({
        scope: 'self',
        range: { ...range, timeZone: expect.any(String) },
        employees: [
          {
            employee: { id: JUAN, displayName: 'Juan (sintético)', colorHex: '#2c5364' },
            ...canonical,
          },
        ],
      });
      const serialized = JSON.stringify(dashboardJuan.performance);
      expect(serialized).not.toContain(COKE);
      expect(serialized).not.toContain('Coke');
    },
  );

  it('cubrir a Juan no cambia el porcentaje de Coke', async () => {
    scenario('URGENT', 'ONE_TIME', false);
    const without = await getDashboard(cokeActor, NOW);
    scenario('URGENT', 'ONE_TIME', true);
    const withCoverage = await getDashboard(cokeActor, NOW);
    expect(without.performance?.employees[0]).toMatchObject({ percentage: 100, coverageGiven: 0 });
    expect(withCoverage.performance?.employees[0]).toMatchObject({
      percentage: 100,
      coverageGiven: 1,
    });
    expect(JSON.stringify(withCoverage.performance)).not.toContain(JUAN);
  });
});
