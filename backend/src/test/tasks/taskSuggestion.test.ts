import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../errors/AppError';
import { formatLocalDate, parseLocalDate } from '../../lib/businessTime';
import {
  EMPTY_SUGGESTION,
  SUGGESTION_PAIR_MESSAGE,
  resolveSuggestion,
  suggestedDateIn,
  suggestedDatesInMonth,
  type SuggestionValues,
} from '../../tasks/taskSuggestion';
import {
  createTaskBodySchema,
  taskCalendarQuerySchema,
  updateTaskBodySchema,
} from '../../tasks/taskSchemas';

const date = (value: string) => parseLocalDate(value)!;
const s = (values: Partial<SuggestionValues>): SuggestionValues => ({
  ...EMPTY_SUGGESTION,
  ...values,
});
const suggested = (
  frequency: Parameters<typeof suggestedDateIn>[0],
  values: Partial<SuggestionValues>,
  day: string,
) => {
  const result = suggestedDateIn(frequency, s(values), date(day));
  return result ? formatLocalDate(result) : null;
};

describe('programación sugerida — combinaciones válidas e inválidas por frecuencia', () => {
  it.each([
    ['WEEKLY', { suggestedWeekday: 1 }],
    ['WEEKLY', { suggestedWeekday: 7 }],
    ['SEMI_MONTHLY', { suggestedFirstHalfDay: 1, suggestedSecondHalfDay: 31 }],
    ['SEMI_MONTHLY', { suggestedFirstHalfDay: 15 }],
    ['SEMI_MONTHLY', { suggestedSecondHalfDay: 16 }],
    ['MONTHLY', { suggestedMonthDay: 31 }],
    ['BIMONTHLY', { suggestedMonth: 2, suggestedMonthDay: 31 }],
    ['ANNUAL', { suggestedMonth: 2, suggestedMonthDay: 29 }],
    ['ANNUAL', { suggestedMonth: 4, suggestedMonthDay: 31 }],
  ] as const)('%s acepta %j', (frequency, values) => {
    expect(resolveSuggestion(frequency, EMPTY_SUGGESTION, values)).toEqual(s(values));
  });

  it.each([
    ['DAILY', { suggestedWeekday: 1 }],
    ['URGENT', { suggestedMonthDay: 1 }],
    ['ONE_TIME', { suggestedMonthDay: 1 }],
    ['WEEKLY', { suggestedWeekday: 8 }],
    ['WEEKLY', { suggestedMonthDay: 3 }],
    ['SEMI_MONTHLY', { suggestedFirstHalfDay: 16 }],
    ['SEMI_MONTHLY', { suggestedSecondHalfDay: 15 }],
    ['SEMI_MONTHLY', { suggestedMonthDay: 10 }],
    ['MONTHLY', { suggestedWeekday: 3 }],
    ['MONTHLY', { suggestedMonth: 1, suggestedMonthDay: 1 }],
    ['BIMONTHLY', { suggestedMonth: 3, suggestedMonthDay: 1 }],
    ['ANNUAL', { suggestedMonth: 13, suggestedMonthDay: 1 }],
  ] as const)('%s rechaza %j', (frequency, values) => {
    expect(() => resolveSuggestion(frequency, EMPTY_SUGGESTION, values)).toThrow(ValidationError);
  });

  it.each(['BIMONTHLY', 'ANNUAL'] as const)(
    '%s exige mes y día juntos (o ninguno)',
    (frequency) => {
      expect(() => resolveSuggestion(frequency, EMPTY_SUGGESTION, { suggestedMonth: 1 })).toThrow(
        SUGGESTION_PAIR_MESSAGE,
      );
      expect(() =>
        resolveSuggestion(frequency, EMPTY_SUGGESTION, { suggestedMonthDay: 10 }),
      ).toThrow(SUGGESTION_PAIR_MESSAGE);
      expect(resolveSuggestion(frequency, EMPTY_SUGGESTION, {})).toEqual(EMPTY_SUGGESTION);
      // Quitar solo uno de los dos también se rechaza.
      expect(() =>
        resolveSuggestion(frequency, s({ suggestedMonth: 1, suggestedMonthDay: 10 }), {
          suggestedMonth: null,
        }),
      ).toThrow(SUGGESTION_PAIR_MESSAGE);
    },
  );

  it('quincenal: cada quincena es independiente (se quita una y la otra queda)', () => {
    const both = s({ suggestedFirstHalfDay: 5, suggestedSecondHalfDay: 20 });
    expect(resolveSuggestion('SEMI_MONTHLY', both, { suggestedFirstHalfDay: null })).toEqual(
      s({ suggestedSecondHalfDay: 20 }),
    );
    expect(resolveSuggestion('SEMI_MONTHLY', both, {})).toEqual(both);
  });
});

describe('programación sugerida — edición y cambio de frecuencia', () => {
  it('omitido conserva, null quita', () => {
    const monthly = s({ suggestedMonthDay: 12 });
    expect(resolveSuggestion('MONTHLY', monthly, {})).toEqual(monthly);
    expect(resolveSuggestion('MONTHLY', monthly, { suggestedMonthDay: null })).toEqual(
      EMPTY_SUGGESTION,
    );
  });

  it.each([
    // [de, configuración, a, enviado, resultado]
    ['WEEKLY', { suggestedWeekday: 3 }, 'MONTHLY', {}, {}],
    [
      'ANNUAL',
      { suggestedMonth: 4, suggestedMonthDay: 31 },
      'MONTHLY',
      {},
      { suggestedMonthDay: 31 },
    ],
    [
      'MONTHLY',
      { suggestedMonthDay: 31 },
      'ANNUAL',
      { suggestedMonth: 2 },
      { suggestedMonth: 2, suggestedMonthDay: 31 },
    ],
    // El día solo, sin mes, no es una sugerencia anual válida: se limpia.
    ['MONTHLY', { suggestedMonthDay: 31 }, 'ANNUAL', {}, {}],
    // Mes 5 no existe en un bimestre: se limpia y, sin mes, también el día.
    ['ANNUAL', { suggestedMonth: 5, suggestedMonthDay: 10 }, 'BIMONTHLY', {}, {}],
    [
      'ANNUAL',
      { suggestedMonth: 2, suggestedMonthDay: 10 },
      'BIMONTHLY',
      {},
      { suggestedMonth: 2, suggestedMonthDay: 10 },
    ],
    ['SEMI_MONTHLY', { suggestedFirstHalfDay: 5, suggestedSecondHalfDay: 20 }, 'WEEKLY', {}, {}],
    ['BIMONTHLY', { suggestedMonth: 1, suggestedMonthDay: 3 }, 'DAILY', {}, {}],
  ] as const)('%s %j → %s (enviado %j): queda %j', (_from, current, to, input, expected) => {
    expect(resolveSuggestion(to, s(current), input)).toEqual(s(expected));
  });

  it('un valor enviado que no corresponde a la frecuencia nueva se rechaza (no se descarta en silencio)', () => {
    expect(() =>
      resolveSuggestion('MONTHLY', s({ suggestedWeekday: 2 }), { suggestedWeekday: 2 }),
    ).toThrow(ValidationError);
  });
});

describe('fecha sugerida del período (zona de negocio, calendario)', () => {
  it('semanal: el día elegido de la semana lunes–domingo que contiene la fecha', () => {
    expect(suggested('WEEKLY', { suggestedWeekday: 3 }, '2026-10-26')).toBe('2026-10-28');
    expect(suggested('WEEKLY', { suggestedWeekday: 3 }, '2026-11-01')).toBe('2026-10-28');
    expect(suggested('WEEKLY', { suggestedWeekday: 7 }, '2026-12-28')).toBe('2027-01-03');
  });

  it('quincenal: cada quincena con su día; el 31 en un mes de 30 días o febrero es el último', () => {
    const values = { suggestedFirstHalfDay: 10, suggestedSecondHalfDay: 31 };
    expect(suggested('SEMI_MONTHLY', values, '2026-10-02')).toBe('2026-10-10');
    expect(suggested('SEMI_MONTHLY', values, '2026-10-20')).toBe('2026-10-31');
    expect(suggested('SEMI_MONTHLY', values, '2026-11-20')).toBe('2026-11-30');
    expect(suggested('SEMI_MONTHLY', values, '2027-02-20')).toBe('2027-02-28');
    expect(suggested('SEMI_MONTHLY', values, '2028-02-20')).toBe('2028-02-29');
    // Solo la 2.ª quincena cargada: la 1.ª no tiene sugerencia.
    expect(suggested('SEMI_MONTHLY', { suggestedSecondHalfDay: 20 }, '2026-10-05')).toBeNull();
  });

  it('mensual: 31 → último día del mes (abril 30, febrero 28/29)', () => {
    expect(suggested('MONTHLY', { suggestedMonthDay: 31 }, '2026-04-10')).toBe('2026-04-30');
    expect(suggested('MONTHLY', { suggestedMonthDay: 31 }, '2027-02-10')).toBe('2027-02-28');
    expect(suggested('MONTHLY', { suggestedMonthDay: 31 }, '2028-02-10')).toBe('2028-02-29');
    expect(suggested('MONTHLY', { suggestedMonthDay: 15 }, '2026-10-31')).toBe('2026-10-15');
  });

  it('bimestral: primer o segundo mes del bimestre, también nov–dic y ene–feb', () => {
    const second = { suggestedMonth: 2, suggestedMonthDay: 31 };
    expect(suggested('BIMONTHLY', second, '2026-09-03')).toBe('2026-10-31');
    expect(suggested('BIMONTHLY', second, '2026-11-15')).toBe('2026-12-31');
    expect(suggested('BIMONTHLY', second, '2027-01-02')).toBe('2027-02-28');
    expect(suggested('BIMONTHLY', second, '2028-01-02')).toBe('2028-02-29');
    expect(suggested('BIMONTHLY', { suggestedMonth: 1, suggestedMonthDay: 31 }, '2026-04-20')).toBe(
      '2026-03-31',
    );
  });

  it('anual: mes y día; 29/02 en año no bisiesto → 28/02; 31/04 → 30/04', () => {
    const leapDay = { suggestedMonth: 2, suggestedMonthDay: 29 };
    expect(suggested('ANNUAL', leapDay, '2027-07-01')).toBe('2027-02-28');
    expect(suggested('ANNUAL', leapDay, '2028-07-01')).toBe('2028-02-29');
    expect(suggested('ANNUAL', { suggestedMonth: 4, suggestedMonthDay: 31 }, '2026-12-31')).toBe(
      '2026-04-30',
    );
  });

  it.each(['DAILY', 'URGENT', 'ONE_TIME'] as const)('%s no tiene fecha sugerida', (frequency) => {
    expect(
      suggested(frequency, { suggestedMonthDay: 1, suggestedWeekday: 1 }, '2026-10-26'),
    ).toBeNull();
  });
});

describe('calendario: una fecha por período, desde el período vigente', () => {
  const placement = (
    frequency: Parameters<typeof suggestedDatesInMonth>[0],
    values: Partial<SuggestionValues>,
    month: string,
    today: string,
  ) => {
    const [year, monthNumber] = month.split('-').map(Number) as [number, number];
    const result = suggestedDatesInMonth(frequency, s(values), year, monthNumber, date(today));
    return result
      ? { from: formatLocalDate(result.from), dates: result.dates.map(formatLocalDate) }
      : null;
  };

  it('semanal: un día por semana, sin duplicados, solo desde la semana vigente', () => {
    expect(placement('WEEKLY', { suggestedWeekday: 3 }, '2026-10', '2026-10-21')).toEqual({
      from: '2026-10-19',
      dates: ['2026-10-21', '2026-10-28'],
    });
    expect(placement('WEEKLY', { suggestedWeekday: 3 }, '2026-11', '2026-10-21')!.dates).toEqual([
      '2026-11-04',
      '2026-11-11',
      '2026-11-18',
      '2026-11-25',
    ]);
  });

  it('quincenal con las dos quincenas; anual solo en su mes; sin sugerencia → null', () => {
    expect(
      placement(
        'SEMI_MONTHLY',
        { suggestedFirstHalfDay: 10, suggestedSecondHalfDay: 31 },
        '2026-11',
        '2026-10-21',
      )!.dates,
    ).toEqual(['2026-11-10', '2026-11-30']);
    expect(
      placement('ANNUAL', { suggestedMonth: 2, suggestedMonthDay: 29 }, '2027-02', '2026-10-21')!
        .dates,
    ).toEqual(['2027-02-28']);
    expect(
      placement('ANNUAL', { suggestedMonth: 2, suggestedMonthDay: 29 }, '2027-03', '2026-10-21')!
        .dates,
    ).toEqual([]);
    expect(placement('MONTHLY', {}, '2026-10', '2026-10-21')).toBeNull();
  });

  it('el período vigente ya empezado sí se ubica; los anteriores no se atribuyen', () => {
    // Mensual día 5, hoy 21/10: la de octubre (5/10) es del período vigente.
    expect(placement('MONTHLY', { suggestedMonthDay: 5 }, '2026-10', '2026-10-21')!.dates).toEqual([
      '2026-10-05',
    ]);
    expect(placement('MONTHLY', { suggestedMonthDay: 5 }, '2026-09', '2026-10-21')!.dates).toEqual(
      [],
    );
  });
});

describe('esquemas: orden de realización, sugerencia y mes del calendario', () => {
  const base = {
    description: 'Tarea sintética',
    employeeId: '11111111-1111-4111-8111-111111111111',
  };

  it('orden: entero positivo hasta 9999; null quita; 0, negativos, decimales y texto se rechazan', () => {
    for (const executionOrder of [1, 2, 9999, null]) {
      expect(
        createTaskBodySchema.safeParse({ ...base, frequency: 'DAILY', executionOrder }).success,
      ).toBe(true);
    }
    for (const executionOrder of [0, -1, 1.5, '2', 10_000]) {
      const result = updateTaskBodySchema.safeParse({ executionOrder });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toMatch(/orden de realización/);
    }
    expect(updateTaskBodySchema.parse({ executionOrder: null })).toEqual({ executionOrder: null });
    expect(updateTaskBodySchema.parse({ description: 'Otra' })).not.toHaveProperty(
      'executionOrder',
    );
  });

  it('sugerencia: enteros 1–31 o null; el resto lo decide el servicio', () => {
    expect(updateTaskBodySchema.safeParse({ suggestedMonthDay: 31 }).success).toBe(true);
    expect(updateTaskBodySchema.safeParse({ suggestedWeekday: null }).success).toBe(true);
    for (const value of [0, 32, 2.5, '3']) {
      expect(updateTaskBodySchema.safeParse({ suggestedMonthDay: value }).success).toBe(false);
    }
  });

  it('mes del calendario: YYYY-MM real', () => {
    expect(taskCalendarQuerySchema.safeParse({ month: '2026-10' }).success).toBe(true);
    for (const month of ['2026-13', '2026-1', '10-2026', '2026-10-01']) {
      expect(taskCalendarQuerySchema.safeParse({ month }).success).toBe(false);
    }
  });
});
