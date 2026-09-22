/**
 * Cumpleaños familiares recurrentes reales, de `addFamilyBirthdays()` en
 * index.html (líneas 1760-1764). Solo mes y día: la próxima ocurrencia
 * anual se calcula dinámicamente en la capa de aplicación (nunca se
 * persiste un año fijo como si fuera una verdad permanente) — ver
 * docs/BUSINESS_RULES.md §14.
 *
 * Benjamín NO está acá. El prototipo declara dos fechas contradictorias
 * para su cumpleaños (19/02 en el array `eventos` vs. 16/09 en
 * `addFamilyBirthdays()`) y no hay forma de resolver cuál es correcta sin
 * que una persona lo confirme. No se elige ninguna de las dos: se omite
 * por completo hasta que exista esa confirmación — ver
 * docs/DATA_INVENTORY.md §8 y docs/BUSINESS_RULES.md §14.
 */
export interface RecurringBirthdaySeed {
  slug: string;
  personLabel: string;
  month: number;
  day: number;
  relationship: string;
}

export const recurringBirthdaySeeds: readonly RecurringBirthdaySeed[] = [
  { slug: 'vicky', personLabel: 'Vicky', month: 3, day: 10, relationship: 'familia' },
  { slug: 'felicitas', personLabel: 'Felicitas', month: 6, day: 1, relationship: 'familia' },
];

/**
 * Documentado, no sembrado — a la espera de confirmación humana de la
 * fecha real. Ver el comentario del módulo.
 */
export const OMITTED_BENJAMIN_BIRTHDAY = {
  personLabel: 'Benjamín',
  contradictingDates: [
    '2026-02-19 (array eventos, index.html línea 996)',
    '16/09 (addFamilyBirthdays, index.html línea 1761)',
  ],
  reason:
    'Fecha de nacimiento contradictoria entre dos fuentes del prototipo. No se siembra hasta confirmación humana.',
} as const;
