import type { MedicalRecordType, Pet } from '../../api/petTypes';

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

/** "25/09/2026" — fecha de calendario pura, sin zona del navegador. */
export function formatDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

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
