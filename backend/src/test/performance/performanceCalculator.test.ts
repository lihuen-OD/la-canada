import { describe, expect, it } from 'vitest';
import {
  buildRecurringOccurrences,
  buildSingleOccurrences,
  computeDailyStreak,
  computeMetrics,
  percentage,
  type ExecutionRow,
  type Occurrence,
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
  it.each(['URGENT', 'ONE_TIME'] as const)('%s no genera una obligación por período', (frequency) =>
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

// ── Regla definitiva: cumplimiento personal + coberturas (Etapa 5D) ────────

const JUAN = 'employee-juan';
const COKE = 'employee-coke';
const RANGE_START = new Date('2026-09-20T03:00:00Z'); // 20/09 00:00 en Buenos Aires
const RANGE_END = new Date('2026-09-25T03:00:00Z'); // fin del 24/09
const NOW = new Date('2026-09-24T15:00:00Z');
const exec = (overrides: Partial<ExecutionRow>): ExecutionRow => ({
  id: 'x',
  taskId: 'task-1',
  periodKey: '2026-09-22',
  assignedEmployeeId: JUAN,
  completedByEmployeeId: JUAN,
  completedAt: new Date('2026-09-22T15:00:00Z'),
  ...overrides,
});
const single = (plans: PlanningRow[], executions: ExecutionRow[] = []) =>
  buildSingleOccurrences({
    plans,
    executions,
    rangeStart: RANGE_START,
    rangeEnd: RANGE_END,
    now: NOW,
  });
const occurrence = (overrides: Partial<Occurrence>): Occurrence => ({
  taskId: 'task-1',
  description: 'Tarea',
  frequency: 'DAILY',
  periodKey: '2026-09-22',
  assignedEmployeeId: JUAN,
  completed: false,
  completedByEmployeeId: null,
  completedAt: null,
  ...overrides,
});

/** Una obligación de cada tipo, asignada a Juan, completada por `by` (o pendiente). */
function oneOfEachType(by: string | null) {
  const monthly = buildRecurringOccurrences({
    plans: [
      plan({
        taskId: 't-m',
        frequency: 'MONTHLY',
        employeeId: JUAN,
        validFrom: new Date('2026-09-01T03:00:00Z'),
      }),
    ],
    executions: by
      ? [
          exec({
            taskId: 't-m',
            periodKey: '2026-09-01',
            completedByEmployeeId: by,
            completedAt: new Date('2026-09-01T15:00:00Z'),
          }),
        ]
      : [],
    from: date('2026-09-01'),
    to: date('2026-09-24'),
    today: date('2026-09-24'),
    now: NOW,
    timeZone: zone,
  });
  const daily = build(
    [
      plan({
        taskId: 't-d',
        employeeId: JUAN,
        validFrom: new Date('2026-09-22T03:00:00Z'),
        validTo: new Date('2026-09-23T03:00:00Z'),
      }),
    ],
    NOW,
    by ? [exec({ taskId: 't-d', completedByEmployeeId: by })] : [],
  );
  const weekly = build(
    [plan({ taskId: 't-w', frequency: 'WEEKLY', employeeId: JUAN })],
    NOW,
    by ? [exec({ taskId: 't-w', periodKey: '2026-09-21', completedByEmployeeId: by })] : [],
  );
  const singles = single(
    [
      plan({ taskId: 't-u', frequency: 'URGENT', employeeId: JUAN }),
      plan({ taskId: 't-o', frequency: 'ONE_TIME', employeeId: JUAN }),
    ],
    by
      ? [
          exec({ taskId: 't-u', periodKey: 'URGENT', completedByEmployeeId: by }),
          exec({ taskId: 't-o', periodKey: 'ONE_TIME', completedByEmployeeId: by }),
        ]
      : [],
  );
  return [...daily, ...weekly, ...monthly, ...singles];
}

describe('Desempeño personal: los cinco tipos y las coberturas', () => {
  it('cada tipo propio completado por el responsable suma una vez (DAILY, WEEKLY, MONTHLY, URGENT, ONE_TIME)', () => {
    const rows = oneOfEachType(JUAN);
    expect(rows.map((row) => row.frequency).sort()).toEqual([
      'DAILY',
      'MONTHLY',
      'ONE_TIME',
      'URGENT',
      'WEEKLY',
    ]);
    expect(computeMetrics(rows, JUAN)).toMatchObject({
      assigned: 5,
      completedPersonally: 5,
      percentage: 100,
      pending: 0,
      coverageReceived: 0,
      coverageGiven: 0,
      operationalCompleted: 5,
    });
  });

  it('tarea propia pendiente: denominador sí, numerador no (en los cinco tipos)', () => {
    expect(computeMetrics(oneOfEachType(null), JUAN)).toMatchObject({
      assigned: 5,
      completedPersonally: 0,
      percentage: 0,
      pending: 5,
    });
  });

  it('cobertura en cada uno de los cinco tipos: queda en el denominador de Juan y no toca el % de Coke', () => {
    const rows = oneOfEachType(COKE);
    expect(computeMetrics(rows, JUAN)).toMatchObject({
      assigned: 5,
      completedPersonally: 0,
      percentage: 0,
      pending: 0,
      coverageReceived: 5,
    });
    expect(computeMetrics(rows, COKE)).toMatchObject({
      assigned: 0,
      completedPersonally: 0,
      percentage: null,
      coverageGiven: 5,
      operationalCompleted: 5,
    });
  });

  it('ejemplo obligatorio: Juan 10 asignadas, 8 propias, 1 cubierta por Coke, 1 pendiente → 80%', () => {
    const juan = Array.from({ length: 10 }, (_, i) =>
      occurrence({
        taskId: `j-${i}`,
        completed: i < 9,
        completedByEmployeeId: i < 8 ? JUAN : i === 8 ? COKE : null,
      }),
    );
    const coke = Array.from({ length: 4 }, (_, i) =>
      occurrence({
        taskId: `c-${i}`,
        assignedEmployeeId: COKE,
        completed: i < 3,
        completedByEmployeeId: i < 3 ? COKE : null,
      }),
    );
    const rows = [...juan, ...coke];
    expect(computeMetrics(rows, JUAN)).toEqual({
      assigned: 10,
      completedPersonally: 8,
      percentage: 80,
      pending: 1,
      coverageReceived: 1,
      coverageGiven: 0,
      operationalCompleted: 8,
    });
    expect(computeMetrics(rows, COKE)).toEqual({
      assigned: 4,
      completedPersonally: 3,
      percentage: 75, // igual que sin la cobertura
      pending: 1,
      coverageReceived: 0,
      coverageGiven: 1,
      operationalCompleted: 4,
    });
    expect(computeMetrics(coke, COKE).percentage).toBe(75);
    // Equipo: 11 obligaciones propias cumplidas de 14; la cobertura se informa aparte.
    expect(computeMetrics(rows)).toMatchObject({
      assigned: 14,
      completedPersonally: 11,
      coverageReceived: 1,
      coverageGiven: 1,
      operationalCompleted: 12,
    });
  });

  it('ejecución revertida (no llega a la consulta vigente): no suma ni cuenta como cobertura', () => {
    // El servicio filtra `revertedAt: null`; sin ejecución vigente la obligación queda pendiente.
    const rows = [
      ...build([plan({ employeeId: JUAN })]),
      ...single([plan({ taskId: 't-u', frequency: 'URGENT', employeeId: JUAN })]),
    ];
    expect(computeMetrics(rows, JUAN)).toMatchObject({
      completedPersonally: 0,
      coverageReceived: 0,
    });
    expect(computeMetrics(rows, COKE)).toMatchObject({ coverageGiven: 0, operationalCompleted: 0 });
  });

  it('reasignación: usa el snapshot histórico de la ejecución, no el responsable actual', () => {
    const plans = [
      plan({ employeeId: JUAN, validTo: new Date('2026-09-23T12:00:00Z') }),
      plan({ id: 'plan-2', employeeId: COKE, validFrom: new Date('2026-09-23T12:00:00Z') }),
    ];
    const rows = build(plans, NOW, [
      exec({ periodKey: '2026-09-22', assignedEmployeeId: JUAN, completedByEmployeeId: JUAN }),
    ]);
    const day22 = rows.find((row) => row.periodKey === '2026-09-22')!;
    expect(day22).toMatchObject({ assignedEmployeeId: JUAN, completedByEmployeeId: JUAN });
    expect(rows.find((row) => row.periodKey === '2026-09-24')?.assignedEmployeeId).toBe(COKE);
    expect(computeMetrics(rows, JUAN).completedPersonally).toBe(1);
    expect(computeMetrics(rows, COKE).coverageGiven).toBe(0);

    // Urgente reasignada después de completarse: la obligación sigue siendo de Juan.
    const urgent = single(
      [
        plan({
          taskId: 't-u',
          frequency: 'URGENT',
          employeeId: JUAN,
          validTo: new Date('2026-09-23T12:00:00Z'),
        }),
        plan({
          id: 'p2',
          taskId: 't-u',
          frequency: 'URGENT',
          employeeId: COKE,
          validFrom: new Date('2026-09-23T12:00:00Z'),
        }),
      ],
      [
        exec({
          taskId: 't-u',
          periodKey: 'URGENT',
          assignedEmployeeId: JUAN,
          completedByEmployeeId: JUAN,
        }),
      ],
    );
    expect(urgent).toHaveLength(1);
    expect(urgent[0]).toMatchObject({ assignedEmployeeId: JUAN, completed: true });
  });

  it('intervalos parciales dentro del rango: solo los días planificados', () => {
    const rows = build([
      plan({
        employeeId: JUAN,
        validFrom: new Date('2026-09-21T13:00:00Z'),
        validTo: new Date('2026-09-23T13:00:00Z'),
      }),
    ]);
    expect(rows.map((row) => row.periodKey)).toEqual(['2026-09-21', '2026-09-22']);
  });

  describe('URGENT / ONE_TIME: una sola obligación por tarea dentro del rango', () => {
    it.each(['URGENT', 'ONE_TIME'] as const)(
      '%s completada antes del rango: no entra',
      (frequency) => {
        const rows = single(
          [
            plan({
              taskId: 't',
              frequency,
              employeeId: JUAN,
              validFrom: new Date('2026-09-10T12:00:00Z'),
            }),
          ],
          [
            exec({
              taskId: 't',
              periodKey: frequency,
              completedAt: new Date('2026-09-15T12:00:00Z'),
            }),
          ],
        );
        expect(rows).toHaveLength(0);
      },
    );

    it.each(['URGENT', 'ONE_TIME'] as const)(
      '%s pendiente desde antes y durante todo el rango: entra una sola vez',
      (frequency) => {
        const rows = single([
          plan({
            taskId: 't',
            frequency,
            employeeId: JUAN,
            validFrom: new Date('2026-09-01T12:00:00Z'),
          }),
        ]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ frequency, periodKey: frequency, completed: false });
      },
    );

    it.each(['URGENT', 'ONE_TIME'] as const)(
      '%s creada después del rango: no entra',
      (frequency) => {
        const rows = buildSingleOccurrences({
          plans: [plan({ taskId: 't', frequency, validFrom: new Date('2026-09-26T12:00:00Z') })],
          executions: [],
          rangeStart: RANGE_START,
          rangeEnd: RANGE_END,
          now: new Date('2026-09-28T12:00:00Z'),
        });
        expect(rows).toHaveLength(0);
      },
    );

    it.each(['URGENT', 'ONE_TIME'] as const)(
      '%s completada después de terminar el rango: dentro del rango cuenta como pendiente',
      (frequency) => {
        const rows = buildSingleOccurrences({
          plans: [
            plan({
              taskId: 't',
              frequency,
              employeeId: JUAN,
              validFrom: new Date('2026-09-21T12:00:00Z'),
            }),
          ],
          executions: [
            exec({
              taskId: 't',
              periodKey: frequency,
              completedAt: new Date('2026-09-27T12:00:00Z'),
            }),
          ],
          rangeStart: RANGE_START,
          rangeEnd: RANGE_END,
          now: new Date('2026-09-28T12:00:00Z'),
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ completed: false, completedByEmployeeId: null });
      },
    );

    it('desactivada antes del rango estando pendiente: no entra; desactivada durante el rango: entra', () => {
      expect(
        single([
          plan({
            taskId: 't',
            frequency: 'URGENT',
            validFrom: new Date('2026-09-01T12:00:00Z'),
            validTo: new Date('2026-09-10T12:00:00Z'),
          }),
        ]),
      ).toHaveLength(0);
      expect(
        single([
          plan({
            taskId: 't',
            frequency: 'URGENT',
            validFrom: new Date('2026-09-01T12:00:00Z'),
            validTo: new Date('2026-09-22T12:00:00Z'),
          }),
        ]),
      ).toHaveLength(1);
    });
  });

  it('la racha diaria solo cuenta días hechos por la propia persona', () => {
    const days = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23'];
    const rows = build(
      [plan({ employeeId: JUAN })],
      undefined,
      days.map((periodKey, i) =>
        exec({
          id: String(i),
          periodKey,
          completedByEmployeeId: periodKey === '2026-09-22' ? COKE : JUAN,
          completedAt: new Date(`${periodKey}T15:00:00Z`),
        }),
      ),
    );
    expect(computeDailyStreak(rows, JUAN, date('2026-09-24'))).toBe(1);
  });
});
