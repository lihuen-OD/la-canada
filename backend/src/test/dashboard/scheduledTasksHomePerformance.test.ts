import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * «Una vez» con fecha y frecuencias bimestral/anual en Inicio y Desempeño:
 * se ejecutan las funciones REALES (`getPerformance` y `getDashboard`) sobre
 * un escenario simulado de Prisma, con resultados concretos. Solo se simulan
 * la base y las ramas ajenas a Tareas.
 */
const mocks = vi.hoisted(() => ({
  plans: vi.fn(),
  executions: vi.fn(),
  listTasks: vi.fn(),
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
vi.mock('../../tasks/tasksService', () => ({ listTasks: mocks.listTasks }));
vi.mock('../../more/eventsService', () => ({ listUpcomingEvents: async () => [] }));

import { getDashboard } from '../../dashboard/dashboardService';
import { defaultPerformanceRange, getPerformance } from '../../performance/performanceService';

/** Instante `HH:MM` de Buenos Aires (UTC−3) del día `YYYY-MM-DD`. */
const ar = (day: string, time = '12:00') => new Date(`${day}T${time}:00.000-03:00`);
/** Como lo devuelve Prisma para `@db.Date`: medianoche UTC de esa fecha. */
const dbDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

type Frequency = 'DAILY' | 'MONTHLY' | 'BIMONTHLY' | 'ANNUAL' | 'ONE_TIME';
const plan = (
  taskId: string,
  employeeId: string,
  frequency: Frequency,
  validFrom: Date,
  scheduledDate: string | null = null,
  validTo: Date | null = null,
) => ({
  id: `p-${taskId}-${validFrom.toISOString()}`,
  taskId,
  employeeId,
  frequency,
  scheduledDate: scheduledDate ? dbDate(scheduledDate) : null,
  validFrom,
  validTo,
  task: { description: `${taskId} (sintética)` },
});
const execution = (taskId: string, periodKey: string, assigned: string, by: string, at: Date) => ({
  id: `x-${taskId}-${periodKey}`,
  taskId,
  periodKey,
  assignedEmployeeId: assigned,
  completedByEmployeeId: by,
  completedAt: at,
});

const REPROGRAMMED_AT = ar('2026-10-20');
const v1Reprogrammed = (validTo: Date | null) =>
  plan('reprogramada', JUAN, 'ONE_TIME', ar('2026-10-01'), '2026-10-14', validTo);

/**
 * Todas «Una vez» salvo donde se indica:
 *  - futura (Juan, vence 30/10) · hoy (Juan, 22/10) · vencida (Juan, 12/10);
 *  - anticipada (Juan, vence 30/10, la hizo Juan el 20/10);
 *  - reprogramada: vencía el 14/10 (Juan); el 20/10 pasa al 05/11 y a Coke;
 *  - cubierta (Juan, 18/10, la hizo Coke el 19/10);
 *  - sin fecha (Coke): la regla de siempre.
 */
function scenario({ reprogrammed = true } = {}) {
  mocks.plans.mockResolvedValue([
    plan('futura', JUAN, 'ONE_TIME', ar('2026-10-10'), '2026-10-30'),
    plan('hoy', JUAN, 'ONE_TIME', ar('2026-10-10'), '2026-10-22'),
    plan('vencida', JUAN, 'ONE_TIME', ar('2026-10-05'), '2026-10-12'),
    plan('anticipada', JUAN, 'ONE_TIME', ar('2026-10-10'), '2026-10-30'),
    ...(reprogrammed
      ? [
          v1Reprogrammed(REPROGRAMMED_AT),
          plan('reprogramada', COKE, 'ONE_TIME', REPROGRAMMED_AT, '2026-11-05'),
        ]
      : [v1Reprogrammed(null)]),
    plan('cubierta', JUAN, 'ONE_TIME', ar('2026-10-10'), '2026-10-18'),
    plan('sin-fecha', COKE, 'ONE_TIME', ar('2026-10-10')),
  ]);
  mocks.executions.mockResolvedValue([
    execution('anticipada', 'ONE_TIME', JUAN, JUAN, ar('2026-10-20')),
    execution('cubierta', 'ONE_TIME', JUAN, COKE, ar('2026-10-19')),
  ]);
}

const admin = { userId: 'u-admin', role: 'ADMIN' as const, employeeId: null };
const juanActor = { userId: 'u-juan', role: 'EMPLOYEE' as const, employeeId: JUAN };
const metricsOf = (rows: { employee: { id: string } }[], id: string) =>
  rows.find((row) => row.employee.id === id);

// Jueves 22/10/2026 15:00 en Buenos Aires: Inicio y Desempeño usan 16/10–22/10.
const NOW = ar('2026-10-22', '15:00');
const JUAN_WEEK = {
  assigned: 4 + 1, // hoy, vencida, reprogramada (vencida del 16 al 20), anticipada, cubierta
  completedPersonally: 1,
  percentage: 20,
  pending: 3,
  coverageReceived: 1,
  coverageGiven: 0,
};
const COKE_WEEK = {
  assigned: 1,
  completedPersonally: 0,
  percentage: 0,
  pending: 1,
  coverageReceived: 0,
  coverageGiven: 1,
};

describe('«Una vez» con fecha — Desempeño e Inicio con el mismo cálculo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTasks.mockResolvedValue({ tasks: [] });
  });

  it('Desempeño 16–22/10: futura fuera; hoy, vencida y reprogramada pendientes; anticipada propia; cubierta', async () => {
    scenario();
    const range = defaultPerformanceRange(NOW);
    expect(range).toEqual({ from: '2026-10-16', to: '2026-10-22' });
    const result = await getPerformance(admin, range, undefined, NOW);
    expect(metricsOf(result.employees, JUAN)).toMatchObject(JUAN_WEEK);
    expect(metricsOf(result.employees, COKE)).toMatchObject(COKE_WEEK);
    expect(result.special).toMatchObject({ oneTimeCompleted: 2 });

    // Detalle de Juan: cada obligación una sola vez, con la fecha de la versión usada.
    const detail = await getPerformance(admin, range, JUAN, NOW);
    expect(
      detail.occurrences!.map((row) => [row.taskId, row.status, row.scheduledDate]).sort(),
    ).toEqual(
      [
        ['anticipada', 'personal', '2026-10-30'],
        ['cubierta', 'covered', '2026-10-18'],
        ['hoy', 'pending', '2026-10-22'],
        ['reprogramada', 'pending', '2026-10-14'],
        ['vencida', 'pending', '2026-10-12'],
      ].sort(),
    );
  });

  it('Inicio muestra exactamente las mismas cifras (ADMIN y EMPLOYEE)', async () => {
    scenario();
    const home = await getDashboard(admin, NOW);
    expect(metricsOf(home.performance!.employees, JUAN)).toMatchObject(JUAN_WEEK);
    expect(metricsOf(home.performance!.employees, COKE)).toMatchObject(COKE_WEEK);
    const homeJuan = await getDashboard(juanActor, NOW);
    expect(homeJuan.performance?.employees).toEqual([expect.objectContaining(JUAN_WEEK)]);
  });

  it('reprogramar no reescribe lo esperado antes: 13–19/10 da lo mismo antes y después del cambio', async () => {
    const range = { from: '2026-10-13', to: '2026-10-19' };
    scenario({ reprogrammed: false });
    const before = await getPerformance(admin, range, JUAN, ar('2026-10-19', '15:00'));
    scenario();
    const after = await getPerformance(admin, range, JUAN, ar('2026-10-29', '15:00'));
    const reprogrammed = (rows: typeof before.occurrences) =>
      rows!.filter((row) => row.taskId === 'reprogramada');
    expect(reprogrammed(before.occurrences)).toEqual([
      expect.objectContaining({ assignedEmployeeId: JUAN, status: 'pending' }),
    ]);
    expect(reprogrammed(after.occurrences)).toEqual(reprogrammed(before.occurrences));
  });

  it('una semana después (23–29/10): la reprogramada al 05/11 y la futura no son exigibles todavía', async () => {
    scenario();
    const later = ar('2026-10-29', '15:00');
    const result = await getPerformance(admin, defaultPerformanceRange(later), undefined, later);
    expect(metricsOf(result.employees, JUAN)).toMatchObject({
      assigned: 2, // hoy (22/10) y vencida (12/10) siguen pendientes
      completedPersonally: 0,
      percentage: 0,
      pending: 2,
    });
    expect(metricsOf(result.employees, COKE)).toMatchObject({ assigned: 1, pending: 1 });
  });

  it('30 días hasta el 05/11: la reprogramada es UNA sola obligación (de Coke, vigente al cierre)', async () => {
    scenario();
    const now = ar('2026-11-05', '15:00');
    const result = await getPerformance(admin, { from: '2026-10-07', to: '2026-11-05' }, COKE, now);
    expect(result.occurrences!.filter((row) => row.taskId === 'reprogramada')).toEqual([
      expect.objectContaining({ assignedEmployeeId: COKE, status: 'pending' }),
    ]);
  });

  it('KPI operativo de Inicio: la «Una vez» programada para después de hoy no cuenta', async () => {
    scenario();
    const task = (
      id: string,
      frequency: Frequency,
      scheduleStatus: string | null,
      done = false,
    ) => ({
      id,
      description: id,
      frequency,
      assignee: EMPLOYEES[1],
      scheduledDate: null,
      scheduleStatus,
      currentExecution: done ? { id: `x-${id}` } : null,
    });
    mocks.listTasks.mockResolvedValue({
      tasks: [
        task('futura', 'ONE_TIME', 'SCHEDULED'),
        task('reprogramada', 'ONE_TIME', 'SCHEDULED'),
        task('hoy', 'ONE_TIME', 'DUE_TODAY'),
        task('vencida', 'ONE_TIME', 'OVERDUE'),
        task('sin-fecha', 'ONE_TIME', null),
        task('diaria', 'DAILY', null, true),
      ],
    });
    const home = await getDashboard(admin, NOW);
    expect(home.kpis).toMatchObject({ tasksCompleted: 1, tasksTotal: 4 });
  });
});

describe('BIMONTHLY y ANNUAL en Inicio y Desempeño (criterio de las mensuales)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTasks.mockResolvedValue({ tasks: [] });
  });

  it('martes 03/11/2026 (7 días 28/10–03/11): mensual del 01/11 y bimestre nov–dic; una cubierta', async () => {
    mocks.plans.mockResolvedValue([
      plan('mensual', JUAN, 'MONTHLY', ar('2026-09-01')),
      plan('bimestral', JUAN, 'BIMONTHLY', ar('2026-09-10')),
      plan('anual', COKE, 'ANNUAL', ar('2026-03-01')),
    ]);
    mocks.executions.mockResolvedValue([
      execution('mensual', '2026-11-01', JUAN, JUAN, ar('2026-11-02')),
      execution('bimestral', '2026-B6', JUAN, COKE, ar('2026-11-02')),
      // Ejecución del bimestre anterior: no cumple el actual.
      execution('bimestral', '2026-B5', JUAN, JUAN, ar('2026-10-02')),
    ]);
    const now = ar('2026-11-03', '15:00');
    const range = defaultPerformanceRange(now);
    const result = await getPerformance(admin, range, JUAN, now);
    // Ambos períodos empiezan el 01/11: se ordenan por descripción.
    expect(result.occurrences!.map((row) => [row.periodKey, row.status])).toEqual([
      ['2026-B6', 'covered'],
      ['2026-11-01', 'personal'],
    ]);
    expect(result.employees).toEqual([
      expect.objectContaining({ assigned: 2, completedPersonally: 1, percentage: 50 }),
    ]);
    // La anual de Coke no empieza en el rango: no hay obligación.
    const team = await getPerformance(admin, range, undefined, now);
    expect(metricsOf(team.employees, COKE)).toMatchObject({ assigned: 0, coverageGiven: 1 });
    const home = await getDashboard(admin, now);
    expect(metricsOf(home.performance!.employees, JUAN)).toMatchObject({
      assigned: 2,
      completedPersonally: 1,
      percentage: 50,
    });

    // Las claves de bimestre que empiezan en el rango van en la MISMA consulta de ejecuciones.
    const where = mocks.executions.mock.calls[0]![0].where;
    expect(where.OR[2].periodKey).toEqual({ in: ['2026-11-Q1', '2026-B6'] });
  });

  it('domingo 03/01/2027 (7 días 28/12–03/01): la anual del año nuevo cuenta; la del año anterior no la cumple', async () => {
    mocks.plans.mockResolvedValue([plan('anual', COKE, 'ANNUAL', ar('2026-03-01'))]);
    mocks.executions.mockResolvedValue([
      execution('anual', '2026-A', COKE, COKE, ar('2026-12-30')),
    ]);
    const now = ar('2027-01-03', '15:00');
    const result = await getPerformance(admin, defaultPerformanceRange(now), COKE, now);
    expect(result.occurrences!.map((row) => [row.periodKey, row.status])).toEqual([
      ['2027-A', 'pending'],
    ]);
    const where = mocks.executions.mock.calls[0]![0].where;
    expect(where.OR[2].periodKey).toEqual({ in: ['2027-01-Q1', '2027-B1', '2027-A'] });
    const home = await getDashboard({ userId: 'u-coke', role: 'EMPLOYEE', employeeId: COKE }, now);
    expect(home.performance?.employees).toEqual([
      expect.objectContaining({ assigned: 1, completedPersonally: 0, pending: 1 }),
    ]);
  });
});
