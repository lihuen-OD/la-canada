import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../errors/AppError';
import { parseLocalDate } from '../../lib/businessTime';
import {
  assertScheduledDateFits,
  scheduleStatusOf,
  scheduledDateText,
  scheduledDateValue,
} from '../../tasks/taskSchedule';
import {
  TASK_FREQUENCIES,
  createTaskBodySchema,
  listTasksQuerySchema,
  updateTaskBodySchema,
} from '../../tasks/taskSchemas';

const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111';
const today = parseLocalDate('2026-10-26')!;

describe('«Fecha para realizar» — estado de una «Una vez»', () => {
  it('sin completar: programada (futura), para hoy y vencida (pasada)', () => {
    expect(scheduleStatusOf('2026-10-27', today, false)).toBe('SCHEDULED');
    expect(scheduleStatusOf('2026-10-26', today, false)).toBe('DUE_TODAY');
    expect(scheduleStatusOf('2026-10-25', today, false)).toBe('OVERDUE');
    expect(scheduleStatusOf('2025-12-31', today, false)).toBe('OVERDUE');
  });

  it('sin fecha o ya completada: sin estado (presentación de siempre)', () => {
    expect(scheduleStatusOf(null, today, false)).toBeNull();
    expect(scheduleStatusOf('2026-10-20', today, true)).toBeNull();
    expect(scheduleStatusOf('2026-10-30', today, true)).toBeNull();
  });

  it('la columna `@db.Date` va y vuelve como fecha de calendario, sin correrse de día', () => {
    expect(scheduledDateValue('2026-10-26')?.toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(scheduledDateText(scheduledDateValue('2026-10-26'))).toBe('2026-10-26');
    expect(scheduledDateText(null)).toBeNull();
    expect(scheduledDateValue(null)).toBeNull();
  });

  it('solo una «Una vez» admite fecha; null siempre está permitido', () => {
    expect(() => assertScheduledDateFits('ONE_TIME', '2026-10-26')).not.toThrow();
    expect(() => assertScheduledDateFits('ONE_TIME', null)).not.toThrow();
    for (const frequency of TASK_FREQUENCIES.filter((value) => value !== 'ONE_TIME')) {
      expect(() => assertScheduledDateFits(frequency, '2026-10-26')).toThrow(ValidationError);
      expect(() => assertScheduledDateFits(frequency, null)).not.toThrow();
      expect(() => assertScheduledDateFits(frequency, undefined)).not.toThrow();
    }
  });
});

describe('taskSchemas — fecha y frecuencias nuevas', () => {
  const base = { description: 'Tarea sintética', employeeId: EMPLOYEE_ID };

  it('acepta BIMONTHLY y ANNUAL al crear, editar y filtrar', () => {
    for (const frequency of ['BIMONTHLY', 'ANNUAL'] as const) {
      expect(createTaskBodySchema.safeParse({ ...base, frequency }).success).toBe(true);
      expect(updateTaskBodySchema.safeParse({ frequency }).success).toBe(true);
      expect(listTasksQuerySchema.safeParse({ frequency }).success).toBe(true);
    }
    expect(listTasksQuerySchema.safeParse({ frequency: 'YEARLY' }).success).toBe(false);
  });

  it('fecha válida, pasada o futura; omitida y null son distintas al editar', () => {
    expect(
      createTaskBodySchema.parse({ ...base, frequency: 'ONE_TIME', scheduledDate: '2026-10-26' })
        .scheduledDate,
    ).toBe('2026-10-26');
    expect(
      createTaskBodySchema.parse({ ...base, frequency: 'ONE_TIME', scheduledDate: '2026-01-02' })
        .scheduledDate,
    ).toBe('2026-01-02');
    expect(createTaskBodySchema.parse({ ...base, frequency: 'ONE_TIME' })).not.toHaveProperty(
      'scheduledDate',
    );
    expect(updateTaskBodySchema.parse({ scheduledDate: null })).toEqual({ scheduledDate: null });
    expect(updateTaskBodySchema.parse({ description: 'Otra tarea' })).not.toHaveProperty(
      'scheduledDate',
    );
    expect(updateTaskBodySchema.parse({ scheduledDate: '2028-02-29' }).scheduledDate).toBe(
      '2028-02-29',
    );
  });

  it.each([
    ['inexistente (30 de febrero)', '2026-02-30'],
    ['29/02 de un año no bisiesto', '2027-02-29'],
    ['mes 13', '2026-13-01'],
    ['formato local', '26/10/2026'],
    ['con hora', '2026-10-26T10:00:00Z'],
    ['vacía', ''],
    ['un número', 20261026],
    ['año fuera de rango', '1999-12-31'],
    ['año demasiado lejano', '2101-01-01'],
  ])('rechaza una fecha %s', (_label, scheduledDate) => {
    const created = createTaskBodySchema.safeParse({
      ...base,
      frequency: 'ONE_TIME',
      scheduledDate,
    });
    expect(created.success).toBe(false);
    expect(created.error?.issues[0]?.message).toMatch(/fecha para realizar/i);
    expect(updateTaskBodySchema.safeParse({ scheduledDate }).success).toBe(false);
  });
});
