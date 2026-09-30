import type { BadgeTone } from '../../components/ui/Badge';
import { formatDate } from '../../utils/dateFormat';
import type {
  DestinationType,
  OperationalMovementType,
  StockCategoryArea,
  StockCategorySummary,
  StockItem,
  StockItemArea,
  StockLevel,
  StockMovementType,
} from '../../api/stockTypes';

export const AREA_LABEL: Record<StockItemArea | StockCategoryArea, string> = {
  HOUSE: 'Casa',
  GARDEN: 'Jardín',
  BOTH: 'Ambas',
};

/** Emojis del prototipo — siempre decorativos (`aria-hidden`), el texto accesible es la etiqueta. */
export const AREA_EMOJI: Record<StockItemArea, string> = {
  HOUSE: '🏠',
  GARDEN: '🌱',
};

/** Encabezado de la tarjeta de inventario del prototipo: 🧹 Casa / 🌿 Jardín. */
export const AREA_CARD_EMOJI: Record<StockItemArea, string> = {
  HOUSE: '🧹',
  GARDEN: '🌿',
};

export const MOVEMENT_LABEL: Record<StockMovementType, string> = {
  OPENING_BALANCE: 'Saldo inicial',
  INCOME: 'Ingreso',
  CONSUMPTION: 'Consumo',
  ADJUSTMENT_INCREASE: 'Ajuste al alta',
  ADJUSTMENT_DECREASE: 'Ajuste a la baja',
};

/** Los cinco tipos en orden de filtro del historial (los del seed incluidos). */
export const MOVEMENT_FILTER_ORDER: readonly StockMovementType[] = [
  'OPENING_BALANCE',
  'INCOME',
  'CONSUMPTION',
  'ADJUSTMENT_INCREASE',
  'ADJUSTMENT_DECREASE',
];

export const OPERATIONAL_MOVEMENT_ORDER: readonly OperationalMovementType[] = [
  'INCOME',
  'CONSUMPTION',
  'ADJUSTMENT_INCREASE',
  'ADJUSTMENT_DECREASE',
];

/**
 * Etiquetas del prototipo (`OK`/`Bajo`/`Crítico`) para el `stockLevel` que
 * devuelve el backend, más el estado neutral de un producto sin objetivo.
 */
export const LEVEL_LABEL: Record<StockLevel, string> = {
  ok: 'OK',
  low: 'Bajo',
  critical: 'Crítico',
  pending: 'Stock objetivo pendiente',
};

export const LEVEL_TONE: Record<StockLevel, BadgeTone> = {
  ok: 'positive',
  low: 'warning',
  critical: 'danger',
  pending: 'neutral',
};

/** Texto de un producto anterior sin stock objetivo cargado. */
export const TARGET_PENDING_TEXT = 'Stock objetivo pendiente';
/** Compras: en lugar de una cantidad inventada cuando falta el objetivo. */
export const COMPLETE_TARGET_TEXT = 'Completar stock objetivo';
/** Ayuda del campo en altas y ediciones. */
export const TARGET_HINT = 'Cantidad a la que querés llegar al reponer.';

export const DESTINATION_TYPE_LABEL: Record<DestinationType, string> = {
  VEHICLE: 'Vehículo',
  SECTOR: 'Sector',
};

/** Plural de los tipos para los resúmenes de reportes. */
export const MOVEMENT_PLURAL: Record<StockMovementType, string> = {
  OPENING_BALANCE: 'Saldos iniciales',
  INCOME: 'Ingresos',
  CONSUMPTION: 'Consumos',
  ADJUSTMENT_INCREASE: 'Ajustes al alta',
  ADJUSTMENT_DECREASE: 'Ajustes a la baja',
};

/** `YYYY-MM-DD` (día de calendario del movimiento) → `dd/mm/aaaa`. */
export function formatStockDay(key: string): string {
  return formatDate(key);
}

export interface StockItemGroup {
  category: StockCategorySummary;
  items: StockItem[];
}

/**
 * Agrupa por categoría preservando el orden de primera aparición (la API
 * ordena por área y nombre, no por categoría — esto no reordena el listado
 * más allá de ensartar los ítems bajo su grupo).
 */
export function groupItemsByCategory(items: readonly StockItem[]): StockItemGroup[] {
  const groups: StockItemGroup[] = [];
  const byCategoryId = new Map<string, StockItemGroup>();
  for (const item of items) {
    let group = byCategoryId.get(item.category.id);
    if (!group) {
      group = { category: item.category, items: [] };
      byCategoryId.set(item.category.id, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/** Aviso tras un movimiento confirmado por el backend (creación o replay). */
export const MOVEMENT_SUCCESS_TEXT: Record<'income' | 'consumption' | 'adjustment', string> = {
  income: 'Ingreso registrado.',
  consumption: 'Consumo registrado.',
  adjustment: 'Ajuste registrado.',
};
