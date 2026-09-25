import type { Age, EventType, GalleryCategory } from '../../api/moreTypes';

/** Textos y emojis del prototipo (`EV_LBL`, `EV_IC`, `MESC`, `DIAS3`, `ago`, `calcEdad`). */

export const EVENT_LABEL: Record<EventType, string> = {
  VISIT: 'Visita',
  BIRTHDAY: 'Cumpleaños',
  MAINTENANCE: 'Mantenimiento',
  OTHER: 'Otro',
};

export const EVENT_ICON: Record<EventType, string> = {
  VISIT: '🏡',
  BIRTHDAY: '🎂',
  MAINTENANCE: '🔧',
  OTHER: '📌',
};

/** Chips de `chips-ev`. */
export const EVENT_FILTERS: readonly { value: EventType | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'VISIT', label: 'Visitas' },
  { value: 'BIRTHDAY', label: 'Cumpleaños' },
  { value: 'MAINTENANCE', label: 'Mantenimiento' },
  { value: 'OTHER', label: 'Otros' },
];

export const PHOTO_FILTERS: readonly { value: GalleryCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'TASK_EVIDENCE', label: 'Tareas' },
  { value: 'MEMORY', label: 'Recuerdos' },
];

/** Formatos que el backend acepta (el tipo real se valida por bytes allá). */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const PHOTO_CATEGORY_OPTION: Record<GalleryCategory, string> = {
  MEMORY: '📷 Recuerdo',
  TASK_EVIDENCE: '✅ Tarea',
};
export const PHOTO_CATEGORY_ICON: Record<GalleryCategory, string> = {
  MEMORY: '📷',
  TASK_EVIDENCE: '✅',
};
export const PHOTO_CATEGORY_TEXT: Record<GalleryCategory, string> = {
  MEMORY: 'recuerdo',
  TASK_EVIDENCE: 'tarea',
};

const MONTHS_SHORT = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];
export const MONTHS_LONG = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
const WEEKDAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Partes de una fecha de calendario pura (`YYYY-MM-DD`), sin zona del navegador. */
export function dateParts(date: string) {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return {
    year,
    month,
    day,
    monthShort: MONTHS_SHORT[month - 1] ?? '',
    weekdayShort: WEEKDAYS_SHORT[weekday] ?? '',
  };
}

/** "Hoy" / "Mañana" / "En N días" / "Hace N días" (`rndEv`). */
export function relativeDays(days: number): string {
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  if (days > 0) return `En ${days} días`;
  return `Hace ${Math.abs(days)} día${days === -1 ? '' : 's'}`;
}

/** `ago()` del prototipo: "hace un momento", "hace 5 min", "hace 3 h", "hace 2 días". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'hace un momento';
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `hace ${Math.floor(seconds / 3600)} h`;
  const days = Math.floor(seconds / 86_400);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
}

/** "4/5/1990" (formato del prototipo en fichas y listas). */
export function shortDate(date: string): string {
  const { year, month, day } = dateParts(date);
  return `${day}/${month}/${year}`;
}

/** `calcEdad`: años si tiene al menos uno; si no, meses. */
export function ageLabel(age: Age | null): string {
  if (!age) return '';
  if (age.years >= 1) return `${age.years} año${age.years !== 1 ? 's' : ''}`;
  return `${age.months} mes${age.months !== 1 ? 'es' : ''}`;
}

/** Solo para el `max` de un selector de fecha; el backend vuelve a validar con `BUSINESS_TIME_ZONE`. */
export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();
