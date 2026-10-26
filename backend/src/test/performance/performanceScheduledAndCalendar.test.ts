import { describe, expect, it } from 'vitest';
import {
  buildRecurringOccurrences,
  buildSingleOccurrences,
  computeMetrics,
  type ExecutionRow,
  type PlanningRow,
} from '../../performance/performanceCalculator';
import { addDays, parseLocalDate, startOfLocalDay } from '../../lib/businessTime';

const zone = 'America/Argentina/Buenos_Aires';
const date = (value: string) => parseLocalDate(value)!;
/** Instante `HH:MM` de Buenos Aires (UTC−3) del día `YYYY-MM-DD`. */
const ar = (day: string, time = '12:00') => new Date(`${day}T${time}:00.000-03:00`);
const JUAN = 'employee-juan';
const COKE = 'employee-coke';

const plan = (overrides: Partial<PlanningRow> = {}): PlanningRow => ({
  id: 'plan-1',
  taskId: 'task-1',
  description: 'Tarea sintética',
  employeeId: JUAN,
  frequency: 'ONE_TIME',
  validFrom: ar('2026-10-01', '09:00'),
  validTo: null,
  ...overrides,
});
/** Versión «Una vez» con fecha: `dueFrom` es la medianoche de ese día en Buenos Aires. */
const dated = (scheduledDate: string, overrides: Partial<PlanningRow> = {}): PlanningRow =>
  plan({
    scheduledDate,
    dueFrom: startOfLocalDay(date(scheduledDate), zone),
    ...overrides,
  });
const exec = (overrides: Partial<ExecutionRow> = {}): ExecutionRow => ({
  id: 'x',
  taskId: 'task-1',
  periodKey: 'ONE_TIME',
  assignedEmployeeId: JUAN,
  completedByEmployeeId: JUAN,
  completedAt: ar('2026-10-20'),
  ...overrides,
});

/** Rango de 7 días (16–22/10/2026) visto el jueves 22/10 a las 15:00. */
const single = (
  plans: PlanningRow[],
  executions: ExecutionRow[] = [],
  range = { from: '2026-10-16', to: '2026-10-22', now: ar('2026-10-22', '15:00') },
) =>
  buildSingleOccurrences({
    plans,
    executions,
    rangeStart: startOfLocalDay(date(range.from), zone),
    rangeEnd: startOfLocalDay(addDays(date(range.to), 1), zone),
    now: range.now,
  });

describe('«Una vez» con fecha para realizar — Desempeño', () => {
  it('programada para después de hoy: no es exigible, no entra al rango', () => {
    expect(single([dated('2026-10-30')])).toEqual([]);
  });

  it('para hoy (22/10): entra como pendiente', () => {
    expect(single([dated('2026-10-22')])).toEqual([
      expect.objectContaining({ completed: false, scheduledDate: '2026-10-22' }),
    ]);
  });

  it('vencida desde antes del rango: entra como pendiente una sola vez', () => {
    const rows = single([dated('2026-10-12')]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ assignedEmployeeId: JUAN, completed: false });
  });

  it('vence el día siguiente al fin del rango: no entra (la medianoche no se cuenta dos veces)', () => {
    expect(
      single([dated('2026-10-23')], [], {
        from: '2026-10-16',
        to: '2026-10-22',
        now: ar('2026-10-25'),
      }),
    ).toEqual([]);
  });

  it('completada ANTES de la fecha: cuenta en el rango de su finalización y nunca antes como pendiente', () => {
    const early = exec({ completedAt: ar('2026-10-20') });
    expect(single([dated('2026-10-30')], [early])).toEqual([
      expect.objectContaining({ completed: true, completedByEmployeeId: JUAN }),
    ]);
    // Semana anterior (09–15/10): todavía no era exigible ni estaba hecha → no entra.
    expect(
      single([dated('2026-10-30')], [early], {
        from: '2026-10-09',
        to: '2026-10-15',
        now: ar('2026-10-22'),
      }),
    ).toEqual([]);
  });

  it('completada DESPUÉS de vencer: en el rango en que estuvo vencida cuenta como pendiente', () => {
    const late = exec({ completedAt: ar('2026-10-20') });
    const before = single([dated('2026-10-10')], [late], {
      from: '2026-10-09',
      to: '2026-10-15',
      now: ar('2026-10-22'),
    });
    expect(before).toEqual([expect.objectContaining({ completed: false })]);
    expect(single([dated('2026-10-10')], [late])).toEqual([
      expect.objectContaining({ completed: true }),
    ]);
  });

  it('reprogramada: lo que se esperaba antes no cambia y sigue siendo UNA sola obligación', () => {
    // Vencía el 14/10 (Juan); el 20/10 12:00 se reprograma al 05/11 y se reasigna a Coke.
    const rescheduled = [
      dated('2026-10-14', { validTo: ar('2026-10-20') }),
      dated('2026-11-05', { id: 'plan-2', employeeId: COKE, validFrom: ar('2026-10-20') }),
    ];
    // 16–22/10: estuvo vencida del 16 al 20 (versión de Juan) → pendiente de Juan, una vez.
    expect(single(rescheduled)).toEqual([
      expect.objectContaining({
        assignedEmployeeId: JUAN,
        completed: false,
        scheduledDate: '2026-10-14',
      }),
    ]);
    // 23–29/10 visto el 29: ya no era exigible (vence el 05/11) → no entra.
    expect(
      single(rescheduled, [], { from: '2026-10-23', to: '2026-10-29', now: ar('2026-10-29') }),
    ).toEqual([]);
    // 30 días (07/10–05/11) visto el 05/11: una sola obligación, de Coke (versión vigente al cierre).
    expect(
      single(rescheduled, [], { from: '2026-10-07', to: '2026-11-05', now: ar('2026-11-05') }),
    ).toEqual([expect.objectContaining({ assignedEmployeeId: COKE, scheduledDate: '2026-11-05' })]);
  });

  it('cambio de responsable sin cambiar la fecha: pendiente del responsable vigente al cierre', () => {
    const rows = single([
      dated('2026-10-18', { validTo: ar('2026-10-21') }),
      dated('2026-10-18', { id: 'plan-2', employeeId: COKE, validFrom: ar('2026-10-21') }),
    ]);
    expect(rows).toEqual([expect.objectContaining({ assignedEmployeeId: COKE })]);
  });

  it('fecha quitada: vuelve a la regla de siempre (pendiente desde su creación)', () => {
    const rows = single([
      dated('2026-10-30', { validTo: ar('2026-10-21') }),
      plan({ id: 'plan-2', validFrom: ar('2026-10-21') }),
    ]);
    expect(rows).toEqual([expect.objectContaining({ completed: false })]);
    expect(rows[0]).not.toHaveProperty('scheduledDate');
  });

  it('desactivada antes de vencer y reactivada después: el hueco respeta la fecha de la versión cerrada', () => {
    const rows = single(
      [
        dated('2026-10-30', { validTo: ar('2026-10-05') }),
        dated('2026-10-30', { id: 'plan-2', validFrom: ar('2026-11-05') }),
      ],
      [],
      { from: '2026-10-16', to: '2026-10-22', now: ar('2026-11-06') },
    );
    expect(rows).toEqual([]);
  });

  it('sin fecha: idéntica a la regla anterior (ni `scheduledDate` en la salida)', () => {
    const rows = single([plan()]);
    expect(rows).toEqual([
      {
        taskId: 'task-1',
        description: 'Tarea sintética',
        frequency: 'ONE_TIME',
        periodKey: 'ONE_TIME',
        assignedEmployeeId: JUAN,
        completed: false,
        completedByEmployeeId: null,
        completedAt: null,
      },
    ]);
  });

  it('resultado personal concreto: futura 0, hoy 1, vencida 1, anticipada 1 propia, cubierta 1', () => {
    const rows = [
      ...single([dated('2026-10-30', { taskId: 'futura' })]),
      ...single([dated('2026-10-22', { taskId: 'hoy' })]),
      ...single([dated('2026-10-12', { taskId: 'vencida' })]),
      ...single(
        [dated('2026-10-30', { taskId: 'anticipada' })],
        [exec({ taskId: 'anticipada', completedAt: ar('2026-10-20') })],
      ),
      ...single(
        [dated('2026-10-18', { taskId: 'cubierta' })],
        [exec({ taskId: 'cubierta', completedByEmployeeId: COKE, completedAt: ar('2026-10-19') })],
      ),
    ];
    expect(computeMetrics(rows, JUAN)).toEqual({
      assigned: 4,
      completedPersonally: 1,
      percentage: 25,
      pending: 2,
      coverageReceived: 1,
      coverageGiven: 0,
      operationalCompleted: 1,
    });
    expect(computeMetrics(rows, COKE)).toMatchObject({ assigned: 0, coverageGiven: 1 });
  });
});

describe('BIMONTHLY y ANNUAL — mismo criterio que las mensuales', () => {
  const recurring = (
    plans: PlanningRow[],
    from: string,
    to: string,
    now: Date,
    executions: ExecutionRow[] = [],
  ) =>
    buildRecurringOccurrences({
      plans,
      executions,
      from: date(from),
      to: date(to),
      today: date(to),
      now,
      timeZone: zone,
    });

  it('bimestral: una obligación por bimestre que EMPIEZA en el rango (el 1 de un mes impar)', () => {
    const plans = [plan({ frequency: 'BIMONTHLY', validFrom: ar('2026-07-10') })];
    // 30 días 24/08–22/09: empieza sep–oct (01/09); jul–ago empezó antes.
    expect(
      recurring(plans, '2026-08-24', '2026-09-22', ar('2026-09-22', '18:00')).map(
        (row) => row.periodKey,
      ),
    ).toEqual(['2026-B5']);
    // 7 días 02/09–08/09: ningún bimestre empieza → ninguna obligación (como la mensual).
    expect(recurring(plans, '2026-09-02', '2026-09-08', ar('2026-09-08', '18:00'))).toEqual([]);
  });

  it('bimestral creada a mitad del bimestre: ese bimestre cuenta, igual que una mensual a mitad de mes', () => {
    const plans = [plan({ frequency: 'BIMONTHLY', validFrom: ar('2026-09-10') })];
    const rows = recurring(plans, '2026-09-01', '2026-09-30', ar('2026-09-30', '18:00'), [
      exec({ periodKey: '2026-B5', completedAt: ar('2026-09-15') }),
    ]);
    expect(rows).toEqual([expect.objectContaining({ periodKey: '2026-B5', completed: true })]);
    const monthly = recurring(
      [plan({ frequency: 'MONTHLY', validFrom: ar('2026-09-10') })],
      '2026-09-01',
      '2026-09-30',
      ar('2026-09-30', '18:00'),
    );
    expect(monthly.map((row) => row.periodKey)).toEqual(['2026-09-01']);
  });

  it('anual: entra solo el rango que incluye el 1 de enero', () => {
    const plans = [plan({ frequency: 'ANNUAL', validFrom: ar('2026-03-01') })];
    expect(
      recurring(plans, '2026-12-26', '2027-01-01', ar('2027-01-01', '18:00')).map(
        (row) => row.periodKey,
      ),
    ).toEqual(['2027-A']);
    expect(recurring(plans, '2027-01-02', '2027-01-08', ar('2027-01-08', '18:00'))).toEqual([]);
  });

  it('cambio BIMONTHLY → MONTHLY: la ejecución bimestral no cumple el mes (claves distintas)', () => {
    const plans = [
      plan({ frequency: 'BIMONTHLY', validFrom: ar('2026-08-01'), validTo: ar('2026-09-05') }),
      plan({ id: 'plan-2', frequency: 'MONTHLY', validFrom: ar('2026-09-05') }),
    ];
    const rows = recurring(plans, '2026-09-01', '2026-09-30', ar('2026-09-30', '18:00'), [
      exec({ periodKey: '2026-B5', completedAt: ar('2026-09-02') }),
    ]);
    // Al cierre de septiembre manda la mensual: una obligación mensual, pendiente.
    expect(rows).toEqual([
      expect.objectContaining({ frequency: 'MONTHLY', periodKey: '2026-09-01', completed: false }),
    ]);
  });

  it('reasignación de una anual: responsable vigente al cierre; el snapshot de la ejecución manda', () => {
    const plans = [
      plan({
        frequency: 'ANNUAL',
        validFrom: ar('2026-06-01'),
        validTo: ar('2027-01-01', '10:00'),
      }),
      plan({
        id: 'plan-2',
        frequency: 'ANNUAL',
        employeeId: COKE,
        validFrom: ar('2027-01-01', '10:00'),
      }),
    ];
    const pending = recurring(plans, '2026-12-26', '2027-01-01', ar('2027-01-01', '18:00'));
    expect(pending).toEqual([
      expect.objectContaining({ periodKey: '2027-A', assignedEmployeeId: COKE }),
    ]);
    const done = recurring(plans, '2026-12-26', '2027-01-01', ar('2027-01-01', '18:00'), [
      exec({
        periodKey: '2027-A',
        assignedEmployeeId: JUAN,
        completedAt: ar('2027-01-01', '09:00'),
      }),
    ]);
    expect(done).toEqual([
      expect.objectContaining({ assignedEmployeeId: JUAN, completedByEmployeeId: JUAN }),
    ]);
  });
});
