import { describe, expect, it } from 'vitest';
import type { TaskFrequency } from '../../generated/prisma/enums';
import { formatLocalDate, parseLocalDate, type LocalDate } from '../../lib/businessTime';
import { periodBounds } from '../../performance/performanceCalculator';
import { PERFORMANCE_RANGE_DAYS, lateCompletionWindow } from '../../performance/performanceService';
import {
  canRevertExecution,
  executionFrequency,
  isCompletedOneOffVisible,
  lateCompletionBounds,
  type RevertableExecution,
} from '../../tasks/completionRules';

const TZ = 'America/Argentina/Buenos_Aires';
/** Instante de Buenos Aires (UTC-3, sin horario de verano). */
const ar = (date: string, time = '12:00') => new Date(`${date}T${time}:00-03:00`);
const day = (text: string) => parseLocalDate(text) as LocalDate;
const range = (frequency: TaskFrequency, key: string) => {
  const bounds = periodBounds(frequency, key);
  return bounds ? [formatLocalDate(bounds.start), formatLocalDate(bounds.end)] : null;
};

// Viernes 30/10/2026 al mediodía en Buenos Aires: la ventana va del 01/10 al 30/10.
const NOW = ar('2026-10-30');
const TODAY = day('2026-10-30');
const WINDOW_FROM = day('2026-10-01');
const JUAN = 'juan';
const COKE = 'coke';

const plan = (
  frequency: TaskFrequency,
  validFrom: Date,
  validTo: Date | null = null,
  employeeId = JUAN,
) => ({ taskId: 't', frequency, validFrom, validTo, employeeId });

const bounds = (
  frequency: TaskFrequency,
  periodKey: string,
  plans: ReturnType<typeof plan>[],
  overrides: { completed?: boolean; now?: Date; today?: LocalDate; windowFrom?: LocalDate } = {},
) =>
  lateCompletionBounds({
    occurrence: { taskId: 't', frequency, periodKey, completed: overrides.completed ?? false },
    plans,
    windowFrom: overrides.windowFrom ?? WINDOW_FROM,
    today: overrides.today ?? TODAY,
    now: overrides.now ?? NOW,
    timeZone: TZ,
  });

describe('periodBounds — primer y último día de cada clave', () => {
  it.each([
    ['DAILY', '2026-10-29', ['2026-10-29', '2026-10-29']],
    ['WEEKLY', '2026-10-26', ['2026-10-26', '2026-11-01']],
    ['WEEKLY', '2026-12-28', ['2026-12-28', '2027-01-03']],
    ['SEMI_MONTHLY', '2026-10-Q1', ['2026-10-01', '2026-10-15']],
    ['SEMI_MONTHLY', '2026-10-Q2', ['2026-10-16', '2026-10-31']],
    ['SEMI_MONTHLY', '2026-02-Q2', ['2026-02-16', '2026-02-28']],
    ['SEMI_MONTHLY', '2028-02-Q2', ['2028-02-16', '2028-02-29']],
    ['MONTHLY', '2026-10-01', ['2026-10-01', '2026-10-31']],
    ['MONTHLY', '2026-11-01', ['2026-11-01', '2026-11-30']],
    ['BIMONTHLY', '2026-B5', ['2026-09-01', '2026-10-31']],
    ['BIMONTHLY', '2026-B6', ['2026-11-01', '2026-12-31']],
    ['BIMONTHLY', '2028-B1', ['2028-01-01', '2028-02-29']],
    ['ANNUAL', '2026-A', ['2026-01-01', '2026-12-31']],
  ] as const)('%s %s', (frequency, key, expected) => {
    expect(range(frequency, key)).toEqual(expected);
  });

  it.each([
    ['WEEKLY', '2026-10-28'], // miércoles: no empieza una semana
    ['MONTHLY', '2026-10-02'],
    ['DAILY', '2026-02-30'],
    ['SEMI_MONTHLY', '2026-10-Q3'],
    ['BIMONTHLY', '2026-B7'],
    ['DAILY', '2026-10-Q1'], // clave de otra frecuencia
    ['URGENT', 'URGENT'],
    ['ONE_TIME', 'ONE_TIME'],
  ] as const)('%s %s no es un período válido', (frequency, key) => {
    expect(periodBounds(frequency, key)).toBeNull();
  });
});

describe('lateCompletionWindow — el rango más largo de Desempeño, sin ampliarlo', () => {
  it('30 días hasta hoy en la zona de negocio', () => {
    expect(Math.max(...PERFORMANCE_RANGE_DAYS)).toBe(30);
    const window = lateCompletionWindow(NOW);
    expect(window.from).toEqual(WINDOW_FROM);
    expect(window.today).toEqual(TODAY);
  });

  it('a las 23:30 de Buenos Aires (02:30 UTC del día siguiente) sigue siendo hoy', () => {
    const window = lateCompletionWindow(new Date('2026-10-31T02:30:00Z'));
    expect(window.today).toEqual(TODAY);
    expect(window.from).toEqual(WINDOW_FROM);
  });
});

describe('lateCompletionBounds — qué obligación se puede registrar y entre qué fechas', () => {
  const sinceSeptember = [plan('DAILY', ar('2026-09-01'))];

  it('diaria de ayer: la fecha queda fijada por la fila', () => {
    expect(bounds('DAILY', '2026-10-29', sinceSeptember)).toEqual({
      periodStart: '2026-10-29',
      periodEnd: '2026-10-29',
      earliest: '2026-10-29',
      latest: '2026-10-29',
    });
  });

  it('semana en curso: del lunes a hoy (nunca futuro)', () => {
    expect(bounds('WEEKLY', '2026-10-26', [plan('WEEKLY', ar('2026-09-01'))])).toEqual({
      periodStart: '2026-10-26',
      periodEnd: '2026-11-01',
      earliest: '2026-10-26',
      latest: '2026-10-30',
    });
  });

  it('semana cerrada: del lunes al domingo', () => {
    expect(bounds('WEEKLY', '2026-10-19', [plan('WEEKLY', ar('2026-09-01'))])).toMatchObject({
      earliest: '2026-10-19',
      latest: '2026-10-25',
    });
  });

  it('quincena cerrada, mes con 31 días y bimestre/año en curso', () => {
    expect(bounds('SEMI_MONTHLY', '2026-10-Q1', [plan('SEMI_MONTHLY', ar('2026-01-01'))])).toEqual({
      periodStart: '2026-10-01',
      periodEnd: '2026-10-15',
      earliest: '2026-10-01',
      latest: '2026-10-15',
    });
    expect(bounds('MONTHLY', '2026-10-01', [plan('MONTHLY', ar('2026-01-01'))])).toMatchObject({
      periodEnd: '2026-10-31',
      latest: '2026-10-30',
    });
  });

  it('tarea creada a mitad de semana: no antes de que existiera', () => {
    expect(
      bounds('WEEKLY', '2026-10-26', [plan('WEEKLY', ar('2026-10-28', '10:00'))]),
    ).toMatchObject({ periodStart: '2026-10-26', earliest: '2026-10-28', latest: '2026-10-30' });
  });

  it('el día de creación se toma en Argentina, no en UTC (23:30 del 27 = 02:30 UTC del 28)', () => {
    expect(
      bounds('WEEKLY', '2026-10-26', [plan('WEEKLY', new Date('2026-10-28T02:30:00Z'))]),
    ).toMatchObject({ earliest: '2026-10-27' });
  });

  it('cambio de diaria a semanal el miércoles: la semanal desde el miércoles; las diarias anteriores conservan su día', () => {
    const plans = [
      plan('DAILY', ar('2026-09-01'), ar('2026-10-28', '12:00')),
      plan('WEEKLY', ar('2026-10-28', '12:00')),
    ];
    expect(bounds('WEEKLY', '2026-10-26', plans)).toMatchObject({ earliest: '2026-10-28' });
    expect(bounds('DAILY', '2026-10-27', plans)).toMatchObject({ earliest: '2026-10-27' });
  });

  it('reasignada a mitad de semana: la obligación existía desde el lunes', () => {
    const plans = [
      plan('WEEKLY', ar('2026-09-01'), ar('2026-10-28'), JUAN),
      plan('WEEKLY', ar('2026-10-28'), null, COKE),
    ];
    expect(bounds('WEEKLY', '2026-10-26', plans)).toMatchObject({ earliest: '2026-10-26' });
  });

  it('desactivada después: la obligación de cuando estaba planificada sigue registrable', () => {
    const plans = [plan('DAILY', ar('2026-09-01'), ar('2026-10-29', '18:00'))];
    expect(bounds('DAILY', '2026-10-28', plans)).toMatchObject({ earliest: '2026-10-28' });
  });

  it('período que empezó antes de la ventana, ya realizado, urgente o «Una vez»: no', () => {
    const monthly = [plan('MONTHLY', ar('2026-01-01'))];
    expect(bounds('MONTHLY', '2026-09-01', monthly)).toBeNull();
    // El 31/10 la ventana empieza el 02/10: la mensual de octubre ya no está en ningún rango.
    expect(
      bounds('MONTHLY', '2026-10-01', monthly, {
        now: ar('2026-10-31'),
        today: day('2026-10-31'),
        windowFrom: lateCompletionWindow(ar('2026-10-31')).from,
      }),
    ).toBeNull();
    expect(bounds('DAILY', '2026-10-29', sinceSeptember, { completed: true })).toBeNull();
    expect(bounds('URGENT', 'URGENT', [plan('URGENT', ar('2026-09-01'))])).toBeNull();
    expect(bounds('ONE_TIME', 'ONE_TIME', [plan('ONE_TIME', ar('2026-09-01'))])).toBeNull();
  });

  it('sin planificación de esa frecuencia en el período: no existe la obligación', () => {
    expect(bounds('WEEKLY', '2026-10-26', [plan('DAILY', ar('2026-09-01'))])).toBeNull();
    expect(bounds('DAILY', '2026-10-29', [plan('DAILY', ar('2026-10-30', '08:00'))])).toBeNull();
  });
});

describe('canRevertExecution — deshacer sin abrir ejecuciones antiguas', () => {
  const employee = { userId: 'u-juan', role: 'EMPLOYEE' as const, employeeId: JUAN };
  const admin = { userId: 'u-admin', role: 'ADMIN' as const, employeeId: null };
  const late: RevertableExecution = {
    periodKey: '2026-10-29',
    completedAt: ar('2026-10-30', '09:00'),
    performedOn: new Date('2026-10-29T00:00:00.000Z'),
    recordedByUserId: 'u-juan',
    completedByEmployee: { id: JUAN },
  };
  const can = (actor: typeof employee | typeof admin, execution = late, today = TODAY) =>
    canRevertExecution(actor, execution, '2026-10-30', today, TZ);

  it('EMPLOYEE: su carga olvidada, el mismo día en que la registró', () => {
    expect(can(employee)).toBe(true);
  });

  it('EMPLOYEE: al día siguiente ya no (ni ninguna ejecución vieja del flujo normal)', () => {
    expect(can(employee, late, day('2026-10-31'))).toBe(false);
    expect(can(employee, { ...late, performedOn: null })).toBe(false);
  });

  it('EMPLOYEE: no la que registró un ADMIN a su nombre, ni la de otra persona', () => {
    expect(can(employee, { ...late, recordedByUserId: 'u-admin' })).toBe(false);
    expect(can(employee, { ...late, completedByEmployee: { id: COKE } })).toBe(false);
  });

  it('EMPLOYEE: lo propio del período vigente, como siempre', () => {
    expect(can(employee, { ...late, periodKey: '2026-10-30', performedOn: null })).toBe(true);
  });

  it('ADMIN corrige cualquier ejecución (con motivo, lo exige la reversión)', () => {
    expect(can(admin, { ...late, recordedByUserId: 'u-juan' }, day('2026-12-01'))).toBe(true);
  });
});

describe('executionFrequency — la frecuencia de la planificación, nunca solo la actual', () => {
  const plans = [
    { frequency: 'WEEKLY' as const, validFrom: ar('2026-09-01') },
    { frequency: 'DAILY' as const, validFrom: ar('2026-10-28', '12:00') },
  ];
  const execution = (periodKey: string, completedAt: Date, performedOn: string | null = null) => ({
    periodKey,
    completedAt,
    performedOn: performedOn ? new Date(`${performedOn}T00:00:00.000Z`) : null,
  });

  it('una semanal completada antes del cambio a diaria sigue siendo semanal', () => {
    expect(
      executionFrequency(plans, execution('2026-10-26', ar('2026-10-26', '10:00')), 'DAILY', TZ),
    ).toBe('WEEKLY');
  });

  it('una diaria completada después del cambio es diaria', () => {
    expect(
      executionFrequency(plans, execution('2026-10-29', ar('2026-10-29', '10:00')), 'DAILY', TZ),
    ).toBe('DAILY');
  });

  it('carga olvidada: la frecuencia del día en que se realizó, no la del registro', () => {
    const changed = [
      { frequency: 'DAILY' as const, validFrom: ar('2026-09-01') },
      { frequency: 'WEEKLY' as const, validFrom: ar('2026-10-30', '08:00') },
    ];
    expect(
      executionFrequency(
        changed,
        execution('2026-10-29', ar('2026-10-30', '09:00'), '2026-10-29'),
        'WEEKLY',
        TZ,
      ),
    ).toBe('DAILY');
  });

  it('si la planificación no coincide con la clave, usa la actual o la forma de la clave', () => {
    expect(executionFrequency([], execution('2026-10-Q2', ar('2026-10-20')), 'DAILY', TZ)).toBe(
      'SEMI_MONTHLY',
    );
    expect(executionFrequency([], execution('2026-10-26', ar('2026-10-26')), 'WEEKLY', TZ)).toBe(
      'WEEKLY',
    );
    expect(executionFrequency([], execution('2026-10-28', ar('2026-10-28')), 'WEEKLY', TZ)).toBe(
      'DAILY',
    );
  });
});

describe('«Una vez» y urgentes completadas: visibles hasta el fin de la semana de su finalización', () => {
  // Semana de negocio del lunes 26/10 al domingo 01/11/2026 (Buenos Aires, UTC-3).
  const visibleOn = (completedAt: Date | null, today: string) =>
    isCompletedOneOffVisible(completedAt, day(today), TZ);

  it('completada hoy, o antes en la misma semana: visible (tachada) hasta el domingo', () => {
    expect(visibleOn(ar('2026-10-30', '09:15'), '2026-10-30')).toBe(true);
    expect(visibleOn(ar('2026-10-26', '00:00'), '2026-10-30')).toBe(true);
    expect(visibleOn(ar('2026-10-26', '00:00'), '2026-11-01')).toBe(true);
    expect(visibleOn(ar('2026-11-01', '23:59'), '2026-11-01')).toBe(true);
  });

  it('desde el lunes siguiente, fuera; una semana anterior, también', () => {
    expect(visibleOn(ar('2026-10-30', '09:15'), '2026-11-02')).toBe(false);
    expect(visibleOn(ar('2026-10-25', '23:59'), '2026-10-26')).toBe(false);
    expect(visibleOn(ar('2026-10-19', '10:00'), '2026-10-30')).toBe(false);
  });

  it('completada un domingo: se oculta al comenzar el lunes en Argentina, no a las 21 h (medianoche UTC)', () => {
    // Domingo 01/11 a las 21:30 de Buenos Aires = lunes 02/11 00:30 UTC.
    const sundayNight = new Date('2026-11-02T00:30:00Z');
    expect(visibleOn(sundayNight, '2026-11-01')).toBe(true);
    expect(visibleOn(sundayNight, '2026-11-02')).toBe(false);
    // Lunes 02/11 a las 00:30 de Buenos Aires (03:30 UTC): semana nueva, visible toda la semana.
    expect(visibleOn(new Date('2026-11-02T03:30:00Z'), '2026-11-08')).toBe(true);
    expect(visibleOn(new Date('2026-11-02T02:59:59Z'), '2026-11-02')).toBe(false);
  });

  it('sin `completedAt` (filas anteriores) queda fuera, como antes', () => {
    expect(visibleOn(null, '2026-10-30')).toBe(false);
  });
});
