import { addDays, formatLocalDate, type LocalDate } from '../lib/businessTime';
import { daysToNextBirthday } from '../pets/petDates';

/**
 * 🎂 Cumpleaños (docs/BUSINESS_RULES.md §14). El prototipo creaba una fila de
 * `eventos` con la fecha del próximo cumpleaños cada vez que corría
 * (`addFamilyBirthdays`, `autoAddCumple*`): la fecha quedaba fija y al año
 * siguiente pasaba a "Pasados". Acá NO se persiste nada: la próxima
 * ocurrencia se calcula al leer, en `BUSINESS_TIME_ZONE`, desde los datos
 * reales — familia (`RecurringBirthday`), empleados (`EmployeeProfile`),
 * hijos (`EmployeeChild`) y mascotas (`Animal`). Benjamín sigue omitido (fecha
 * contradictoria, `OMITTED_BENJAMIN_BIRTHDAY` en el seed).
 */

export type BirthdaySource = 'FAMILY' | 'EMPLOYEE' | 'CHILD' | 'PET';

export interface BirthdayInput {
  source: BirthdaySource;
  sourceId: string;
  /** Nombre de quien cumple ("Cumpleaños de <nombre>"). */
  name: string;
  month: number;
  day: number;
  /** Contexto visible (la "nota" del prototipo): "Familia", "Hijo/a de Coke", etc. */
  note: string;
}

export interface DerivedBirthday extends BirthdayInput {
  /** Próxima ocurrencia (hoy incluido), `YYYY-MM-DD`. */
  date: string;
  daysUntil: number;
}

/** Mes/día de una fecha `@db.Date` (sin hora: siempre UTC medianoche). */
export function monthDayOf(value: Date): { month: number; day: number } {
  return { month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

export function nextBirthday(input: BirthdayInput, today: LocalDate): DerivedBirthday {
  const daysUntil = daysToNextBirthday({ year: 2000, month: input.month, day: input.day }, today);
  return { ...input, date: formatLocalDate(addDays(today, daysUntil)), daysUntil };
}

/** Próximas ocurrencias ordenadas por fecha y luego por nombre (orden estable). */
export function upcomingBirthdays(inputs: readonly BirthdayInput[], today: LocalDate) {
  return inputs
    .map((input) => nextBirthday(input, today))
    .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name, 'es'));
}
