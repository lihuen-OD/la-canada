import type {
  Age,
  BirthdayOrigin,
  EventType,
  FamilyRelation,
  GalleryCategory,
} from '../../api/moreTypes';
import { formatDate } from '../../utils/dateFormat';

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

/** `dd/mm/aaaa` en fichas y listas (utilidad única de fechas). */
export function shortDate(date: string): string {
  return formatDate(date);
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

/** 👨‍👩‍👧‍👦 Mi familia (Etapa 5F): relación controlada, sin "yo" (la fecha propia es aparte). */
export const FAMILY_RELATIONS: readonly FamilyRelation[] = ['PARTNER', 'CHILD', 'FAMILY', 'OTHER'];
export const FAMILY_RELATION_LABEL: Record<FamilyRelation, string> = {
  PARTNER: 'Pareja',
  CHILD: 'Hijo/a',
  FAMILY: 'Familia',
  OTHER: 'Otro',
};
export const FAMILY_RELATION_ICON: Record<FamilyRelation, string> = {
  PARTNER: '💑',
  CHILD: '👶',
  FAMILY: '👪',
  OTHER: '🧑',
};

/** `YYYY-MM-DD` → `dd/mm/aaaa`; `--MM-DD` (año desconocido) → `dd/mm`, sin inventar un año. */
export function familyBirthDateLabel(birthDate: string): string {
  if (!birthDate.startsWith('--')) return formatDate(birthDate);
  const [month, day] = birthDate.slice(2).split('-');
  return `${day}/${month}`;
}

/**
 * De dónde se calcula un cumpleaños derivado (Eventos), en lenguaje humano.
 * Perfil y familia personales hablan en primera persona solo para su dueño
 * (`sourceRef` MY_PROFILE); para el resto, en tercera.
 */
export function birthdayOriginLabel(origin: BirthdayOrigin, own: boolean): string {
  if (origin === 'USER_PROFILE')
    return own ? 'desde Mi perfil' : 'desde el perfil del administrador';
  if (origin === 'USER_FAMILY') {
    return own ? 'desde Mi familia' : 'desde la familia del administrador';
  }
  return BIRTHDAY_ORIGIN_LABEL[origin];
}

const BIRTHDAY_ORIGIN_LABEL: Record<BirthdayOrigin, string> = {
  USER_PROFILE: 'desde el perfil del administrador',
  USER_FAMILY: 'desde la familia del administrador',
  EMPLOYEE: 'desde el perfil del equipo',
  EMPLOYEE_CHILD: 'desde el perfil del equipo',
  ANIMAL: 'desde la ficha de la mascota',
  GLOBAL_RECURRING: 'desde los datos originales',
};
