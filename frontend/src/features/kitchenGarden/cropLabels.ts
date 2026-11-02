import type { BadgeTone } from '../../components/ui/Badge';
import type {
  GardenCropRecordType,
  GardenQuantityUnit,
  GardenSowingMethod,
  GardenTransplantPlan,
} from '../../api/kitchenGardenTypes';
import { formatDate } from '../../utils/dateFormat';

/** 🥕 Cultivos — textos de pantalla (los estados los calcula el backend). */

export const METHOD_LABEL: Record<GardenSowingMethod, string> = {
  DIRECT: 'Siembra directa',
  SEEDBED: 'Almácigo',
};

export const RECORD_TYPE_LABEL: Record<GardenCropRecordType, string> = {
  SOWING: 'Siembra',
  TRANSPLANT: 'Trasplante',
};

export const RECORD_TYPE_ICON: Record<GardenCropRecordType, string> = {
  SOWING: '🌱',
  TRANSPLANT: '🪴',
};

const UNIT_LABEL: Record<GardenQuantityUnit, [string, string]> = {
  SEEDS: ['semilla', 'semillas'],
  GRAMS: ['g', 'g'],
  SEEDLINGS: ['plantín', 'plantines'],
};

export const SOWING_UNIT_OPTIONS: { value: 'SEEDS' | 'GRAMS'; label: string }[] = [
  { value: 'SEEDS', label: 'Semillas' },
  { value: 'GRAMS', label: 'Gramos' },
];

/** «120 semillas», «2,5 g», «1 plantín»: siempre con su unidad. */
export function quantityText(quantity: string | null, unit: GardenQuantityUnit | null): string {
  if (!quantity || !unit) return '';
  const number = Number(quantity);
  const [one, many] = UNIT_LABEL[unit];
  return `${quantity.replace('.', ',')} ${number === 1 ? one : many}`;
}

/**
 * Lo previsto para los trasplantes, en palabras: «Previsto para…», «Para
 * hoy», «Fecha prevista pasada» o pendiente sin fecha. Nunca dice que el
 * trasplante ocurrió ni que el cultivo se perdió.
 */
export function planLabel(plan: GardenTransplantPlan): { text: string; tone: BadgeTone } | null {
  if (!plan.pending) {
    return plan.closedAt ? { text: 'Sin trasplantes pendientes', tone: 'neutral' } : null;
  }
  switch (plan.status) {
    case 'SCHEDULED':
      return { text: `Previsto para el ${formatDate(plan.expectedDate)}`, tone: 'info' };
    case 'DUE_TODAY':
      return { text: 'Para hoy', tone: 'warning' };
    case 'PAST':
      return { text: `Fecha prevista pasada (${formatDate(plan.expectedDate)})`, tone: 'warning' };
    default:
      return { text: 'Trasplante pendiente, sin fecha prevista', tone: 'neutral' };
  }
}

/** `12,5` → `12.5` (el backend recibe punto decimal). */
export const normalizeQuantity = (value: string) => value.trim().replace(',', '.');

const QUANTITY_PATTERN = /^(?:0[.,]\d{1,2}|[1-9]\d{0,7}(?:[.,]\d{1,2})?)$/;

/**
 * Mensaje si la cantidad escrita no sirve (vacía = sin cantidad, válida).
 * `wholeMessage`: si la unidad se cuenta entera (semillas, plantines).
 */
export function quantityError(value: string, wholeMessage: string | null): string | null {
  const text = value.trim();
  if (!text) return null;
  if (!QUANTITY_PATTERN.test(text) || /^0([.,]0+)?$/.test(text)) {
    return 'La cantidad debe ser un número positivo de hasta 2 decimales.';
  }
  if (wholeMessage && /[.,]\d*[1-9]/.test(text)) return wholeMessage;
  return null;
}

export const WHOLE_SEEDS = 'Las semillas se cuentan enteras.';
export const WHOLE_SEEDLINGS = 'Los plantines se cuentan enteros.';
