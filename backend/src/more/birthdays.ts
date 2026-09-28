import { addDays, formatLocalDate, type LocalDate } from '../lib/businessTime';
import { daysToNextBirthday } from '../pets/petDates';

/**
 * 🎂 Cumpleaños (docs/BUSINESS_RULES.md §14). El prototipo creaba una fila de
 * `eventos` con la fecha del próximo cumpleaños cada vez que corría
 * (`addFamilyBirthdays`, `autoAddCumple*`): la fecha quedaba fija y al año
 * siguiente pasaba a "Pasados". Acá NO se persiste nada: la próxima
 * ocurrencia se calcula al leer, en `BUSINESS_TIME_ZONE`, desde los datos
 * reales — perfil personal (`UserProfile`) y familia (`RecurringBirthday` con
 * propietario) de un usuario sin Employee, cumpleaños globales
 * (`RecurringBirthday` sin propietario), empleados (`EmployeeProfile`), hijos
 * (`EmployeeChild`) y mascotas (`Animal`). Benjamín sigue omitido (fecha
 * contradictoria, `OMITTED_BENJAMIN_BIRTHDAY` en el seed).
 */

/** Origen explícito de un cumpleaños derivado (Etapa 5F) — nunca se deduce del título. */
export type BirthdayOrigin =
  'USER_PROFILE' | 'USER_FAMILY' | 'EMPLOYEE' | 'EMPLOYEE_CHILD' | 'ANIMAL' | 'GLOBAL_RECURRING';

export interface BirthdayInput {
  origin: BirthdayOrigin;
  /** Id de la fila fuente (perfil, familiar, hijo, mascota…): una fuente = un cumpleaños. */
  sourceId: string;
  /** Nombre de quien cumple ("Cumpleaños de <nombre>"); null si no tiene nombre cargado. */
  name: string | null;
  /** Título si no hay nombre (perfil personal sin nombre visible). */
  fallbackTitle?: string;
  month: number;
  day: number;
  /** Contexto visible (la "nota" del prototipo): "Familia", "Hijo/a de Coke", etc. */
  note: string;
  /** Solo para decidir el enlace a la fuente según quién mira; nunca se serializa. */
  ownerUserId?: string;
  employeeId?: string;
}

export interface DerivedBirthday extends BirthdayInput {
  /** Próxima ocurrencia (hoy incluido), `YYYY-MM-DD`. */
  date: string;
  daysUntil: number;
}

export const birthdayTitle = (input: BirthdayInput): string =>
  input.name ? `Cumpleaños de ${input.name}` : (input.fallbackTitle ?? 'Cumpleaños');

/** Mes/día de una fecha `@db.Date` (sin hora: siempre UTC medianoche). */
export function monthDayOf(value: Date): { month: number; day: number } {
  return { month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

/** 29/02 se festeja el 01/03 en años no bisiestos (mismo criterio que el prototipo). */
export function nextBirthday(input: BirthdayInput, today: LocalDate): DerivedBirthday {
  const daysUntil = daysToNextBirthday({ year: 2000, month: input.month, day: input.day }, today);
  return { ...input, date: formatLocalDate(addDays(today, daysUntil)), daysUntil };
}

/** ¿El cumpleaños (mes/día) cae en esta fecha de calendario? Con la regla del 29/02. */
export function birthdayFallsOn(input: { month: number; day: number }, date: LocalDate): boolean {
  const occurrence = new Date(Date.UTC(date.year, input.month - 1, input.day));
  return (
    occurrence.getUTCFullYear() === date.year &&
    occurrence.getUTCMonth() === date.month - 1 &&
    occurrence.getUTCDate() === date.day
  );
}

/**
 * Clave de comparación de una persona para detectar cumpleaños duplicados:
 * minúsculas, espacios colapsados, sin el "🎂" ni el prefijo "Cumpleaños de"
 * del prototipo ("🎂 Cumpleaños de Vicky" ≡ "cumpleaños de  vicky" ≡ "Vicky").
 */
export function birthdayPersonKey(text: string): string {
  return text
    .replace(/🎂/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('es')
    .replace(/^(cumpleaños|cumpleanos|cumple)\s+de\s+/u, '')
    .trim();
}

/** Próximas ocurrencias ordenadas por fecha y luego por título (orden estable). */
export function upcomingBirthdays(inputs: readonly BirthdayInput[], today: LocalDate) {
  return inputs
    .map((input) => nextBirthday(input, today))
    .sort(
      (a, b) => a.daysUntil - b.daysUntil || birthdayTitle(a).localeCompare(birthdayTitle(b), 'es'),
    );
}
