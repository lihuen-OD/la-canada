import { describe, expect, it } from 'vitest';
import {
  FREQUENCY_FILTER_LABEL,
  FREQUENCY_FILTER_ORDER,
  FREQUENCY_LABEL,
  FREQUENCY_ORDER,
  FREQUENCY_TONE,
  formatPeriodKey,
} from './taskLabels';

describe('taskLabels — quincenal', () => {
  it('ninguna lista de frecuencias omite SEMI_MONTHLY', () => {
    expect(FREQUENCY_ORDER).toContain('SEMI_MONTHLY');
    expect(FREQUENCY_FILTER_ORDER).toContain('SEMI_MONTHLY');
    expect(FREQUENCY_LABEL.SEMI_MONTHLY).toBe('Quincenal');
    expect(FREQUENCY_FILTER_LABEL.SEMI_MONTHLY).toBe('Quincenales');
    expect(FREQUENCY_TONE.SEMI_MONTHLY).toBe('info');
  });

  it('formatPeriodKey: quincenas con su último día real; fechas como dd/mm/aaaa', () => {
    expect(formatPeriodKey('2026-10-Q1')).toBe('01/10/2026 al 15/10/2026');
    expect(formatPeriodKey('2026-10-Q2')).toBe('16/10/2026 al 31/10/2026');
    expect(formatPeriodKey('2026-09-Q2')).toBe('16/09/2026 al 30/09/2026');
    expect(formatPeriodKey('2027-02-Q2')).toBe('16/02/2027 al 28/02/2027');
    expect(formatPeriodKey('2028-02-Q2')).toBe('16/02/2028 al 29/02/2028');
    expect(formatPeriodKey('2026-09-22')).toBe('22/09/2026');
  });
});
