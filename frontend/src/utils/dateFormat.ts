/**
 * Única utilidad de fechas VISIBLES de la app: formato argentino
 * `dd/mm/aaaa` y `dd/mm/aaaa HH:mm`. Es solo presentación: los contratos
 * técnicos (API ISO, `periodKey`, query params, claves de caché, `value` de
 * `<input type="date">`) siguen en ISO y no pasan por acá.
 */

/** Zona de negocio de La Cañada (`BUSINESS_TIME_ZONE` del backend). */
export const BUSINESS_TIME_ZONE = 'America/Argentina/Buenos_Aires';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` (campos `@db.Date`, `periodKey` diario) → `dd/mm/aaaa`, armado
 * a partir de año, mes y día: nunca `new Date('YYYY-MM-DD')`, que se
 * interpreta en UTC y puede correr el día. Un timestamp ISO completo se
 * formatea en la zona de negocio. `null`/vacío/inválido → `''`.
 */
export function formatDate(
  value: string | null | undefined,
  timeZone = BUSINESS_TIME_ZONE,
): string {
  if (!value) return '';
  const dateOnly = DATE_ONLY.exec(value.trim());
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const parts = zonedParts(value, timeZone);
  return parts ? `${parts.day}/${parts.month}/${parts.year}` : '';
}

/** Timestamp ISO → `dd/mm/aaaa HH:mm` en la zona de negocio (sin segundos). */
export function formatDateTime(
  value: string | null | undefined,
  timeZone = BUSINESS_TIME_ZONE,
): string {
  if (!value) return '';
  const parts = zonedParts(value, timeZone);
  return parts ? `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}` : '';
}

/** Rango de fechas → `dd/mm/aaaa al dd/mm/aaaa` (o una sola fecha si coinciden). */
export function formatDateRange(
  from: string | null | undefined,
  to: string | null | undefined,
  timeZone = BUSINESS_TIME_ZONE,
): string {
  const start = formatDate(from, timeZone);
  const end = formatDate(to, timeZone);
  if (!start || !end) return start || end;
  return start === end ? start : `${start} al ${end}`;
}

/** Porcentaje del backend (0–100, un decimal o `null`) con coma decimal argentina. */
export function formatPercentage(value: number | null): string {
  return value === null ? 'Sin datos' : `${value.toLocaleString('es-AR')}%`;
}

function zonedParts(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('es-AR', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute', string>;
}
