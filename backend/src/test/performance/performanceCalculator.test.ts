import { describe, expect, it } from 'vitest';
import {
  buildRecurringOccurrences,
  computeDailyStreak,
  percentage,
  type PlanningRow,
} from '../../performance/performanceCalculator';
import { parseLocalDate } from '../../lib/businessTime';

const zone = 'America/Argentina/Buenos_Aires';
const date = (value: string) => parseLocalDate(value)!;
const plan = (overrides: Partial<PlanningRow> = {}): PlanningRow => ({
  id: 'plan-1',
  taskId: 'task-1',
  description: 'Tarea',
  employeeId: 'employee-1',
  frequency: 'DAILY',
  validFrom: new Date('2026-09-20T03:00:00.000Z'),
  validTo: null,
  ...overrides,
});
const build = (
  plans: PlanningRow[],
  now = new Date('2026-09-24T15:00:00.000Z'),
  executions: Parameters<typeof buildRecurringOccurrences>[0]['executions'] = [],
) =>
  buildRecurringOccurrences({
    plans,
    executions,
    from: date('2026-09-20'),
    to: date('2026-09-24'),
    today: date('2026-09-24'),
    now,
    timeZone: zone,
  });

describe('performanceCalculator', () => {
  it('genera DAILY por día desde la creación y no genera futuro', () =>
    expect(build([plan()])).toHaveLength(5));
  it('genera WEEKLY los lunes', () =>
    expect(build([plan({ frequency: 'WEEKLY' })]).map((x) => x.periodKey)).toEqual(['2026-09-21']));
  it('genera MONTHLY el primer día', () => {
    const rows = buildRecurringOccurrences({
      plans: [plan({ frequency: 'MONTHLY', validFrom: new Date('2026-09-01T03:00:00Z') })],
      executions: [],
      from: date('2026-09-01'),
      to: date('2026-09-24'),
      today: date('2026-09-24'),
      now: new Date('2026-09-24T15:00:00Z'),
      timeZone: zone,
    });
    expect(rows.map((x) => x.periodKey)).toEqual(['2026-09-01']);
  });
  it.each(['URGENT', 'ONE_TIME'] as const)('excluye %s del denominador', (frequency) =>
    expect(build([plan({ frequency })])).toHaveLength(0),
  );
  it('respeta desactivación', () =>
    expect(
      build([plan({ validTo: new Date('2026-09-22T12:00:00Z') })]).map((x) => x.periodKey),
    ).toEqual(['2026-09-20', '2026-09-21']));
  it('respeta reactivación', () =>
    expect(
      build([
        plan({ validTo: new Date('2026-09-21T03:00:00Z') }),
        plan({ id: 'plan-2', validFrom: new Date('2026-09-23T03:00:00Z') }),
      ]).map((x) => x.periodKey),
    ).toEqual(['2026-09-20', '2026-09-23', '2026-09-24']));
  it('usa el responsable vigente al cierre', () =>
    expect(
      build([
        plan({ validTo: new Date('2026-09-22T12:00:00Z') }),
        plan({
          id: 'plan-2',
          employeeId: 'employee-2',
          validFrom: new Date('2026-09-22T12:00:00Z'),
        }),
      ]).find((x) => x.periodKey === '2026-09-22')?.assignedEmployeeId,
    ).toBe('employee-2'));
  it('el snapshot de ejecución prevalece y registra cobertura', () => {
    const rows = build([plan()], undefined, [
      {
        id: 'execution-1',
        taskId: 'task-1',
        periodKey: '2026-09-22',
        assignedEmployeeId: 'employee-1',
        completedByEmployeeId: 'employee-2',
        completedAt: new Date('2026-09-22T15:00:00Z'),
      },
    ]);
    expect(rows.find((x) => x.periodKey === '2026-09-22')).toMatchObject({
      completed: true,
      assignedEmployeeId: 'employee-1',
      completedByEmployeeId: 'employee-2',
    });
  });
  it('no duplica al cambiar frecuencia dentro del período', () => {
    const rows = build([
      plan({ frequency: 'WEEKLY', validTo: new Date('2026-09-23T12:00:00Z') }),
      plan({ id: 'plan-2', frequency: 'DAILY', validFrom: new Date('2026-09-23T12:00:00Z') }),
    ]);
    expect(new Set(rows.map((x) => `${x.taskId}:${x.periodKey}`)).size).toBe(rows.length);
  });
  it('porcentaje es null sin esperadas y ponderado por totales', () => {
    expect(percentage(0, 0)).toBeNull();
    expect(percentage(2, 3)).toBe(66.7);
  });
  it('racha completa, día sin tareas y día actual parcial', () => {
    const complete = build(
      [plan()],
      undefined,
      ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23'].map((periodKey, i) => ({
        id: String(i),
        taskId: 'task-1',
        periodKey,
        assignedEmployeeId: 'employee-1',
        completedByEmployeeId: 'employee-1',
        completedAt: new Date(`${periodKey}T15:00:00Z`),
      })),
    );
    expect(computeDailyStreak(complete, 'employee-1', date('2026-09-24'))).toBe(4);
    expect(computeDailyStreak([], 'employee-1', date('2026-09-24'))).toBeNull();
  });
  it('corta la racha ante un día pasado pendiente', () =>
    expect(computeDailyStreak(build([plan()]), 'employee-1', date('2026-09-24'))).toBe(0));
  it('usa la fecha argentina cerca de medianoche UTC', () =>
    expect(build([plan()], new Date('2026-09-25T02:30:00Z')).at(-1)?.periodKey).toBe('2026-09-24'));
});
