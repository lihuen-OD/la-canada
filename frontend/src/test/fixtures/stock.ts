import type {
  StockCategoriesResponse,
  StockCategory,
  StockDestination,
  StockItem,
  StockItemsListResponse,
  StockMovement,
  StockMovementsListResponse,
  StockReportMovementsResponse,
  StockReportSummary,
} from '../../api/stockTypes';

/**
 * Fixtures SINTÉTICOS, solo para tests (nunca importados por código de
 * runtime — lo verifica `styles/styles.test.ts`). Nombres explícitamente
 * de prueba: no representan productos ni categorías reales.
 */
export const CATEGORY_A: StockCategory = {
  id: '00000000-0000-4000-8000-00000000c001',
  name: 'Categoría sintética Casa',
  area: 'HOUSE',
  active: true,
};
export const CATEGORY_B: StockCategory = {
  id: '00000000-0000-4000-8000-00000000c002',
  name: 'Categoría sintética Jardín',
  area: 'GARDEN',
  active: true,
};
export const CATEGORY_BOTH: StockCategory = {
  id: '00000000-0000-4000-8000-00000000c003',
  name: 'Categoría sintética Ambas',
  area: 'BOTH',
  active: false,
};

export function makeItem(overrides: Partial<StockItem> = {}): StockItem {
  return {
    id: '00000000-0000-4000-8000-00000000i001',
    name: 'Producto sintético A',
    area: 'HOUSE',
    unit: 'kg',
    minimumQuantity: '10',
    currentQuantity: '25',
    // Siempre explícito, como lo manda el backend: el frontend no lo recalcula.
    stockLevel: 'ok',
    active: true,
    category: { id: CATEGORY_A.id, name: CATEGORY_A.name, area: CATEGORY_A.area },
    ...overrides,
  };
}

export function makeLowItem(): StockItem {
  return makeItem({
    id: '00000000-0000-4000-8000-00000000i002',
    name: 'Producto sintético bajo',
    currentQuantity: '3',
    minimumQuantity: '10',
    stockLevel: 'low',
  });
}

export function makeCritItem(): StockItem {
  return makeItem({
    id: '00000000-0000-4000-8000-00000000i003',
    name: 'Producto sintético crítico',
    currentQuantity: '0',
    minimumQuantity: '5',
    stockLevel: 'critical',
  });
}

export function makeZeroMinItem(): StockItem {
  return makeItem({
    id: '00000000-0000-4000-8000-00000000i004',
    name: 'Producto sintético sin mínimo',
    minimumQuantity: '0',
    currentQuantity: '7',
  });
}

export function itemsList(items: StockItem[]): StockItemsListResponse {
  return {
    items,
    page: 1,
    pageSize: 50,
    total: items.length,
    totalPages: 1,
  };
}

export function categoriesResponse(
  categories: StockCategory[] = [CATEGORY_A, CATEGORY_B],
): StockCategoriesResponse {
  return { categories };
}

export function makeMovement(overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    id: '00000000-0000-4000-8000-00000000m001',
    type: 'INCOME',
    quantity: '5',
    effectiveDate: '2026-09-20',
    reason: 'Ingreso sintético',
    employee: null,
    destination: null,
    createdAt: '2026-09-20T12:00:00.000Z',
    ...overrides,
  };
}

export function movementsList(movements: StockMovement[]): StockMovementsListResponse {
  return {
    movements,
    page: 1,
    pageSize: 20,
    total: movements.length,
    totalPages: 1,
  };
}

export const DESTINATION: StockDestination = {
  id: '00000000-0000-4000-8000-00000000d001',
  name: 'Destino sintético',
  type: 'VEHICLE',
  active: true,
};

export const INACTIVE_DESTINATION: StockDestination = {
  id: '00000000-0000-4000-8000-00000000d002',
  name: 'Destino sintético inactivo',
  type: 'SECTOR',
  active: false,
};

/** Resumen de reporte VACÍO (sin movimientos en el período): la forma real del backend. */
export function emptyReportSummary(from = '2026-08-27', to = '2026-09-25'): StockReportSummary {
  return {
    range: {
      from,
      to,
      timeZone: 'America/Argentina/Buenos_Aires',
      includesCurrentDay: true,
      maxDays: 366,
    },
    totals: {
      movements: 0,
      income: { count: 0, byUnit: [] },
      consumption: { count: 0, byUnit: [] },
      adjustments: { count: 0, increase: 0, decrease: 0 },
      openingBalance: { count: 0 },
    },
    currentLevels: {
      critical: 0,
      low: 0,
      ok: 0,
      byArea: [
        { area: 'HOUSE', critical: 0, low: 0, ok: 0 },
        { area: 'GARDEN', critical: 0, low: 0, ok: 0 },
      ],
    },
    products: { withMovements: 0, mostMoved: [], mostConsumed: [] },
    destinations: [],
    employees: [],
  };
}

export function reportMovementsList(
  movements: StockReportMovementsResponse['movements'] = [],
): StockReportMovementsResponse {
  return {
    range: emptyReportSummary().range,
    movements,
    page: 1,
    pageSize: 20,
    total: movements.length,
    totalPages: 1,
  };
}
