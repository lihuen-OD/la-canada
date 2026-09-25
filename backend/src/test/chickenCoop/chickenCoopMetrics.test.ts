import { describe, expect, it } from 'vitest';
import {
  averagePerDay,
  computeCoopMetrics,
  layingRate,
  periodLayingRate,
} from '../../chickenCoop/chickenCoopMetrics';

const TODAY = { year: 2026, month: 9, day: 25 };

describe('fórmulas del prototipo (docs/BUSINESS_RULES.md §9)', () => {
  it('postura del día = round(buenos / gallinas × 100)', () => {
    expect(layingRate(7, 10)).toBe(70);
    expect(layingRate(2, 3)).toBe(67);
  });

  it('sin gallinas configuradas o con 0, la postura es null (no un 0% falso)', () => {
    expect(layingRate(5, null)).toBeNull();
    expect(layingRate(5, 0)).toBeNull();
    expect(periodLayingRate(5, 0, 3)).toBeNull();
    expect(periodLayingRate(5, 10, 0)).toBeNull();
  });

  it('postura del período = round(buenos / (gallinas × días con datos) × 100)', () => {
    expect(periodLayingRate(21, 10, 3)).toBe(70);
  });

  it('promedio por día con un decimal (toFixed(1)); sin datos, "0"', () => {
    expect(averagePerDay(10, 3)).toBe('3.3');
    expect(averagePerDay(9, 3)).toBe('3.0');
    expect(averagePerDay(0, 0)).toBe('0');
  });
});

describe('computeCoopMetrics', () => {
  it('período = últimos N días de calendario incluido hoy; ignora filas fuera del rango', () => {
    const result = computeCoopMetrics({
      today: TODAY,
      days: 7,
      hens: 10,
      totals: [
        { date: '2026-09-18', goodEggs: 100, brokenEggs: 9 }, // fuera (8 días atrás)
        { date: '2026-09-19', goodEggs: 6, brokenEggs: 1 },
        { date: '2026-09-25', goodEggs: 8, brokenEggs: 0 },
      ],
    });
    expect(result.period).toMatchObject({
      days: 7,
      from: '2026-09-19',
      to: '2026-09-25',
      goodEggs: 14,
      brokenEggs: 1,
      daysWithData: 2,
      averagePerDay: '7.0',
      layingRate: 70,
    });
    expect(result.today).toEqual({
      date: '2026-09-25',
      goodEggs: 8,
      brokenEggs: 0,
      layingRate: 80,
    });
  });

  it('un día solo con huevos rotos cuenta como día con datos (igual que el prototipo)', () => {
    const result = computeCoopMetrics({
      today: TODAY,
      days: 7,
      hens: 10,
      totals: [{ date: '2026-09-24', goodEggs: 0, brokenEggs: 2 }],
    });
    expect(result.period.daysWithData).toBe(1);
    expect(result.period.layingRate).toBe(0);
    expect(result.today).toEqual({ date: '2026-09-25', goodEggs: 0, brokenEggs: 0, layingRate: 0 });
  });

  it('el gráfico muestra min(N, 14) días en orden cronológico, con 0 en días sin registros', () => {
    const week = computeCoopMetrics({ today: TODAY, days: 7, hens: 1, totals: [] });
    expect(week.period.daily.map((day) => day.date)).toEqual([
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
    ]);
    const year = computeCoopMetrics({
      today: TODAY,
      days: 365,
      hens: 1,
      totals: [{ date: '2026-09-12', goodEggs: 4, brokenEggs: 0 }],
    });
    expect(year.period.daily).toHaveLength(14);
    expect(year.period.daily[0]).toEqual({ date: '2026-09-12', goodEggs: 4 });
    expect(year.period.from).toBe('2025-09-26');
  });

  it('cruza fin de mes y de año sin depender de la zona horaria del proceso', () => {
    const result = computeCoopMetrics({
      today: { year: 2027, month: 1, day: 2 },
      days: 7,
      hens: null,
      totals: [],
    });
    expect(result.period.from).toBe('2026-12-27');
    expect(result.today.layingRate).toBeNull();
  });
});
