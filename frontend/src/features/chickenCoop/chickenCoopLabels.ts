import type { ChickenCoopPeriodDays } from '../../api/chickenCoopTypes';
import type { BadgeTone } from '../../components/ui/Badge';

/** Chips de "Análisis por período" del prototipo. */
export const PERIOD_OPTIONS: readonly { days: ChickenCoopPeriodDays; label: string }[] = [
  { days: 7, label: '7 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: '3 meses' },
  { days: 365, label: '1 año' },
];

/** Día de la semana completo — corrige el `DIAS_ES` no declarado del prototipo. */
const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function parts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** "Viernes 25/09/2026" — fecha de calendario pura (sin zona horaria del navegador). */
export function formatDayHeading(date: string): string {
  const { year, month, day } = parts(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${day}/${pad(month)}/${year}`;
}

/** "25/09" — etiquetas del gráfico. */
export function formatShortDate(date: string): string {
  const { month, day } = parts(date);
  return `${pad(day)}/${pad(month)}`;
}

export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${rate}%`;
}

/** Umbrales del prototipo: ≥70% bien, ≥50% atención, menos alerta. Sin dato, neutro. */
export function layingTone(rate: number | null): BadgeTone {
  if (rate === null) return 'neutral';
  if (rate >= 70) return 'positive';
  if (rate >= 50) return 'warning';
  return 'danger';
}

export function eggsText(good: number, broken: number): string {
  return `${good} bueno${good === 1 ? '' : 's'}${broken > 0 ? `, ${broken} roto${broken === 1 ? '' : 's'}` : ''}`;
}
