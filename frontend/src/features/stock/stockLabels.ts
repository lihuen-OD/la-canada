import type { BadgeTone } from '../../components/ui/Badge';
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

/** Etiquetas del `stockLevel` que devuelve el backend (nunca calculado acá). */
export const LEVEL_LABEL: Record<StockLevel, string> = {
  ok: 'Normal',
  low: 'Stock bajo',
  critical: 'Crítico',
};

export const LEVEL_TONE: Record<StockLevel, BadgeTone> = {
  ok: 'positive',
  low: 'warning',
  critical: 'danger',
};

/** Compras: prioridad textual derivada del nivel (crítico antes que bajo). */
export const LEVEL_PRIORITY: Record<Exclude<StockLevel, 'ok'>, string> = {
  critical: 'Prioridad alta',
  low: 'Prioridad media',
};

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

/** `YYYY-MM-DD` → "lun 22 sep" (la fecha ya es de calendario; se formatea en UTC para no desplazarla). */
export function formatStockDay(key: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${key}T00:00:00Z`));
}

/** `YYYY-MM-DD` de `createdAt` para el detalle del movimiento (día calendario, sin hora local). */
export function formatIsoDay(iso: string): string {
  return iso.slice(0, 10);
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
