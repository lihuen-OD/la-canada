import { describe, expect, it } from 'vitest';
import { formatDayHeading } from './chickenCoopLabels';

describe('formatDayHeading', () => {
  it('día de la semana + dd/mm/aaaa con ceros iniciales, sin corrimiento por zona', () => {
    expect(formatDayHeading('2026-09-03')).toBe('Jueves 03/09/2026');
    expect(formatDayHeading('2026-01-01')).toBe('Jueves 01/01/2026');
    expect(formatDayHeading('2028-02-29')).toBe('Martes 29/02/2028');
  });
});
