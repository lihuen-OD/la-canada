import type {
  StockCategoriesResponse,
  StockCategory,
  StockDestination,
  StockItem,
  StockItemsListResponse,
  StockMovement,
  StockMovementsListResponse,
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
  });
}

export function makeCritItem(): StockItem {
  return makeItem({
    id: '00000000-0000-4000-8000-00000000i003',
    name: 'Producto sintético crítico',
    currentQuantity: '0',
    minimumQuantity: '5',
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
};
