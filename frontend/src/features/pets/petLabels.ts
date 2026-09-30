import type { BadgeTone } from '../../components/ui/Badge';
import type { DueStatus, MedicalRecordType, NextDue, Pet } from '../../api/petTypes';

/** Textos y emojis del prototipo para los 5 tipos de registro clínico. */
export const RECORD_OPTION_LABEL: Record<MedicalRecordType, string> = {
  VACCINE: '💉 Vacuna',
  WEIGHT: '⚖️ Peso',
  DEWORMING: '🪱 Desparasitación',
  CHECKUP: '🩺 Chequeo sanitario',
  CLINICAL_EVENT: '📋 Evento clínico',
};

/** Etiqueta del historial (`TIPO_REG`). */
export const RECORD_TAG_LABEL: Record<MedicalRecordType, string> = {
  VACCINE: '💉 Vacuna',
  WEIGHT: '⚖️ Peso',
  DEWORMING: '🪱 Desparasitación',
  CHECKUP: '🩺 Chequeo',
  CLINICAL_EVENT: '📋 Evento',
};

/** Chips de filtro del historial. */
export const RECORD_FILTERS: readonly { value: MedicalRecordType | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'VACCINE', label: '💉 Vacunas' },
  { value: 'WEIGHT', label: '⚖️ Peso' },
  { value: 'DEWORMING', label: '🪱 Desparasitación' },
  { value: 'CHECKUP', label: '🩺 Chequeos' },
  { value: 'CLINICAL_EVENT', label: '📋 Eventos' },
];

export const RECORD_TYPES: readonly MedicalRecordType[] = [
  'VACCINE',
  'WEIGHT',
  'DEWORMING',
  'CHECKUP',
  'CLINICAL_EVENT',
];

/** `calcEdad` del prototipo: años si tiene al menos uno; si no, meses. */
export function ageText(age: Pet['age']): string {
  if (!age) return '';
  if (age.years >= 1) return `${age.years} año${age.years !== 1 ? 's' : ''}`;
  return `${age.months} mes${age.months !== 1 ? 'es' : ''}`;
}

/** Aviso del listado: solo hoy o dentro de los próximos 30 días. */
export function birthdayNotice(days: number | null): string {
  if (days === null) return '';
  if (days === 0) return '🎂 ¡Cumpleaños hoy!';
  if (days <= 30) return `🎂 Cumple en ${days} día${days !== 1 ? 's' : ''}`;
  return '';
}

/** "25/09/2026" — la utilidad única de fechas de la app. */
export { formatDate } from '../../utils/dateFormat';

/** "12.5" → "12,5" (decimal del backend, sin pasar por float). */
export function formatKg(kg: string): string {
  return kg.replace('.', ',');
}

/** Línea "🐕 Perro · Labrador · 3 años" de la tarjeta. */
export function petSummary(pet: Pet, withAge = true): string {
  return [`${pet.type.icon} ${pet.type.name}`, pet.breed, withAge ? ageText(pet.age) : '']
    .filter(Boolean)
    .join(' · ');
}

/** Etiquetas y tonos de los estados que calcula el backend. */
export const DUE_STATUS_LABEL: Record<DueStatus, string> = {
  SCHEDULED: 'Vigente',
  UPCOMING: 'Próxima',
  DUE_TODAY: 'Vence hoy',
  OVERDUE: 'Vencida',
  FULFILLED: 'Cumplida',
};

export const DUE_STATUS_TONE: Record<DueStatus, BadgeTone> = {
  SCHEDULED: 'positive',
  UPCOMING: 'info',
  DUE_TODAY: 'warning',
  OVERDUE: 'danger',
  FULFILLED: 'neutral',
};

/** Filtros de 📅 Vencimientos: sin estado = pendientes abiertos; «Cumplidas» aparte. */
export const DUE_FILTERS: readonly { value: DueStatus | 'open'; label: string }[] = [
  { value: 'open', label: 'Pendientes' },
  { value: 'OVERDUE', label: 'Vencidas' },
  { value: 'DUE_TODAY', label: 'Vencen hoy' },
  { value: 'UPCOMING', label: 'Próximas' },
  { value: 'SCHEDULED', label: 'Vigentes' },
  { value: 'FULFILLED', label: 'Cumplidas' },
];

/** Tipos que admiten próxima fecha (⚖️ Peso no). */
export const DUE_RECORD_TYPES = RECORD_TYPES.filter((type) => type !== 'WEIGHT');

/** «En 12 días», «Vence hoy», «Hace 3 días» — de los días que manda el backend. */
export function dueRelativeText(nextDue: Pick<NextDue, 'daysUntil' | 'status'>): string {
  if (nextDue.status === 'FULFILLED') return 'Cumplida';
  const days = nextDue.daysUntil;
  if (days === 0) return 'Vence hoy';
  const plural = Math.abs(days) === 1 ? 'día' : 'días';
  return days > 0 ? `En ${days} ${plural}` : `Hace ${-days} ${plural}`;
}

/** «Registrar aplicación» (vacunas y desparasitaciones) o «Registrar control». */
export function fulfillActionLabel(type: MedicalRecordType): string {
  return type === 'VACCINE' || type === 'DEWORMING' ? 'Registrar aplicación' : 'Registrar control';
}

/** Indicador discreto del listado; vacío si no hay nada vencido, de hoy o próximo. */
export function dueSummaryText(summary: Pet['dueSummary']): string {
  if (!summary) return '';
  const parts = [
    summary.overdue ? `${summary.overdue} vencida${summary.overdue !== 1 ? 's' : ''}` : '',
    summary.dueToday ? `${summary.dueToday} hoy` : '',
    summary.upcoming ? `${summary.upcoming} próxima${summary.upcoming !== 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

/** Mínimo del selector (la validación real es del backend): el día siguiente a la atención. */
export function nextDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + 1));
  return next.toISOString().slice(0, 10);
}
