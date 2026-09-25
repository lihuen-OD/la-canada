import { addDays, formatLocalDate, type LocalDate } from '../lib/businessTime';

/**
 * Cálculos de 🐔 Gallinero — única definición (Etapa 5G). Fórmulas del
 * prototipo (docs/BUSINESS_RULES.md §9, `rndGallinero`/`rndGallStats`),
 * ahora en el backend:
 *
 *  - Postura del día = round(buenos_hoy / gallinas_activas × 100).
 *  - Promedio/día   = buenos_período / días_con_datos, con 1 decimal.
 *  - Postura período = round(buenos_período / (gallinas × días_con_datos) × 100).
 *
 * Diferencias deliberadas (defectos evidentes del prototipo):
 *  - Sin gallinas configuradas (o con 0) la postura es `null` ("—") en lugar
 *    de un 0% que se leía como alerta roja: dividir por cero no es un dato.
 *  - El período es explícito: los últimos N días de calendario de
 *    `BUSINESS_TIME_ZONE` incluido hoy (el prototipo comparaba contra
 *    "ahora − N días" en la hora del navegador, con bordes ambiguos).
 *
 * Se conserva a propósito una limitación del prototipo: la postura de días
 * pasados usa la cantidad ACTUAL de gallinas (no hay historial de la
 * cantidad por fecha).
 */

/** Totales vigentes (sin anuladas) de un día de calendario. */
export interface DailyEggTotals {
  date: string;
  goodEggs: number;
  brokenEggs: number;
}

/** El gráfico de barras del prototipo muestra como máximo 14 días. */
export const CHART_MAX_DAYS = 14;

export function layingRate(goodEggs: number, hens: number | null): number | null {
  if (!hens || hens <= 0) return null;
  return Math.round((goodEggs / hens) * 100);
}

export function periodLayingRate(
  goodEggs: number,
  hens: number | null,
  daysWithData: number,
): number | null {
  if (!hens || hens <= 0 || daysWithData <= 0) return null;
  return Math.round((goodEggs / (hens * daysWithData)) * 100);
}

/** `toFixed(1)` del prototipo; sin días con datos, "0". */
export function averagePerDay(goodEggs: number, daysWithData: number): string {
  return daysWithData > 0 ? (goodEggs / daysWithData).toFixed(1) : '0';
}

/** Primer día del período de N días que termina hoy (inclusive). */
export function periodStart(today: LocalDate, days: number): LocalDate {
  return addDays(today, -(days - 1));
}

export interface CoopMetricsInput {
  today: LocalDate;
  days: number;
  hens: number | null;
  /** Una fila por fecha con registros vigentes dentro del período. */
  totals: readonly DailyEggTotals[];
}

export function computeCoopMetrics({ today, days, hens, totals }: CoopMetricsInput) {
  const todayText = formatLocalDate(today);
  const from = formatLocalDate(periodStart(today, days));
  const inPeriod = totals.filter((row) => row.date >= from && row.date <= todayText);
  const byDate = new Map(inPeriod.map((row) => [row.date, row]));
  const todayRow = byDate.get(todayText);
  const goodEggs = inPeriod.reduce((sum, row) => sum + row.goodEggs, 0);
  const brokenEggs = inPeriod.reduce((sum, row) => sum + row.brokenEggs, 0);
  // Como `new Set(periodRecs.map(r => r.fecha)).size` del prototipo: días
  // con al menos un registro (toda recolección tiene al menos un huevo).
  const daysWithData = inPeriod.length;

  const chartDays = Math.min(days, CHART_MAX_DAYS);
  const daily = Array.from({ length: chartDays }, (_, index) => {
    const date = formatLocalDate(addDays(today, index - (chartDays - 1)));
    return { date, goodEggs: byDate.get(date)?.goodEggs ?? 0 };
  });

  return {
    today: {
      date: todayText,
      goodEggs: todayRow?.goodEggs ?? 0,
      brokenEggs: todayRow?.brokenEggs ?? 0,
      layingRate: layingRate(todayRow?.goodEggs ?? 0, hens),
    },
    period: {
      days,
      from,
      to: todayText,
      goodEggs,
      brokenEggs,
      daysWithData,
      averagePerDay: averagePerDay(goodEggs, daysWithData),
      layingRate: periodLayingRate(goodEggs, hens, daysWithData),
      daily,
    },
  };
}
