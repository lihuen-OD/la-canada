/**
 * Catálogos fijos de 🐾 Mascotas tomados del prototipo (Etapa 5M).
 *
 * - `BUILTIN_PET_TYPE_NAMES`: los 9 tipos precargados (`builtin` en
 *   `pobModalTipos`), los mismos que siembra `prisma/seed-data/animalTypes.ts`
 *   (un test lo verifica). No se pueden eliminar.
 * - `PET_TYPE_ICON_OPTIONS`: el selector "Símbolo" (`ANIMAL_EMOJIS`, 25
 *   opciones). Un tipo nuevo solo acepta uno de estos emojis.
 */
export const BUILTIN_PET_TYPE_NAMES: readonly string[] = [
  'Perro',
  'Gato',
  'Caballo',
  'Burro',
  'Guinea',
  'Pato',
  'Pavo real',
  'Gallina',
  'Faisán',
];

export const PET_TYPE_ICON_OPTIONS: readonly { icon: string; label: string }[] = [
  { icon: '🐕', label: 'Perro' },
  { icon: '🐈', label: 'Gato' },
  { icon: '🐴', label: 'Caballo' },
  { icon: '🫏', label: 'Burro' },
  { icon: '🐖', label: 'Cerdo/Guinea' },
  { icon: '🐄', label: 'Vaca' },
  { icon: '🐂', label: 'Ternero/Buey' },
  { icon: '🐃', label: 'Toro' },
  { icon: '🐑', label: 'Oveja' },
  { icon: '🐐', label: 'Cabra' },
  { icon: '🦙', label: 'Llama/Alpaca' },
  { icon: '🐇', label: 'Conejo' },
  { icon: '🐔', label: 'Gallina' },
  { icon: '🦆', label: 'Pato' },
  { icon: '🪿', label: 'Ganso' },
  { icon: '🦚', label: 'Pavo real' },
  { icon: '🦃', label: 'Pavo/Faisán' },
  { icon: '🐦', label: 'Pájaro' },
  { icon: '🦜', label: 'Loro' },
  { icon: '🦤', label: 'Ave grande' },
  { icon: '🐟', label: 'Pez' },
  { icon: '🐢', label: 'Tortuga' },
  { icon: '🦎', label: 'Lagarto' },
  { icon: '🐝', label: 'Abeja' },
  { icon: '🐾', label: 'Otro' },
];

/** Ícono por defecto del prototipo (`tipoIcon`) cuando un tipo no tiene uno. */
export const DEFAULT_PET_ICON = '🐾';

export const MEDICAL_RECORD_TYPES = [
  'VACCINE',
  'WEIGHT',
  'DEWORMING',
  'CHECKUP',
  'CLINICAL_EVENT',
] as const;
export type MedicalRecordTypeName = (typeof MEDICAL_RECORD_TYPES)[number];
