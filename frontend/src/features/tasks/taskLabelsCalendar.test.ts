import { describe, expect, it } from 'vitest';
import { formatDateWithWeekday } from '../../utils/dateFormat';
import {
  FREQUENCY_FILTER_LABEL,
  FREQUENCY_FILTER_ORDER,
  FREQUENCY_HINT,
  FREQUENCY_LABEL,
  FREQUENCY_ORDER,
  SCHEDULE_STATUS_LABEL,
  formatPeriodKey,
} from './taskLabels';

describe('taskLabels — bimestral, anual y fecha para realizar', () => {
  it('bimestral y anual en todas las listas, después de mensual', () => {
    expect(FREQUENCY_ORDER.slice(-3)).toEqual(['MONTHLY', 'BIMONTHLY', 'ANNUAL']);
    expect(FREQUENCY_FILTER_ORDER.indexOf('BIMONTHLY')).toBe(
      FREQUENCY_FILTER_ORDER.indexOf('MONTHLY') + 1,
    );
    expect(FREQUENCY_LABEL.BIMONTHLY).toBe('Bimestral');
    expect(FREQUENCY_LABEL.ANNUAL).toBe('Anual');
    expect(FREQUENCY_FILTER_LABEL.BIMONTHLY).toBe('Bimestrales');
    expect(FREQUENCY_FILTER_LABEL.ANNUAL).toBe('Anuales');
    expect(FREQUENCY_HINT.BIMONTHLY).toBe('Una vez por bimestre calendario: ene–feb, mar–abr…');
    expect(FREQUENCY_HINT.ANNUAL).toBe('Una vez por año calendario');
    expect(SCHEDULE_STATUS_LABEL).toEqual({
      SCHEDULED: 'Programada',
      DUE_TODAY: 'Para hoy',
      OVERDUE: 'Vencida',
    });
  });

  it('formatPeriodKey: bimestres y años como rango de fechas reales', () => {
    expect(formatPeriodKey('2026-B1')).toBe('01/01/2026 al 28/02/2026');
    expect(formatPeriodKey('2028-B1')).toBe('01/01/2028 al 29/02/2028');
    expect(formatPeriodKey('2026-B5')).toBe('01/09/2026 al 31/10/2026');
    expect(formatPeriodKey('2026-B6')).toBe('01/11/2026 al 31/12/2026');
    expect(formatPeriodKey('2026-A')).toBe('01/01/2026 al 31/12/2026');
    // Lo de antes no cambia.
    expect(formatPeriodKey('2026-10-Q2')).toBe('16/10/2026 al 31/10/2026');
    expect(formatPeriodKey('2026-09-22')).toBe('22/09/2026');
  });

  it('formatDateWithWeekday: el día de la semana de esa fecha, sin correrse por zona horaria', () => {
    expect(formatDateWithWeekday('2026-10-26')).toBe('Lunes 26/10/2026');
    expect(formatDateWithWeekday('2026-10-25')).toBe('Domingo 25/10/2026');
    expect(formatDateWithWeekday('2028-02-29')).toBe('Martes 29/02/2028');
    expect(formatDateWithWeekday('2026-12-31')).toBe('Jueves 31/12/2026');
    expect(formatDateWithWeekday('26/10/2026')).toBe('');
    expect(formatDateWithWeekday(null)).toBe('');
  });
});
