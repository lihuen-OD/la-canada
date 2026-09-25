/**
 * Contratos reales de `/api/v1/stock` (Etapa 5A) — leídos de
 * `backend/src/stock/stockService.ts` y `stockSchemas.ts`. Las cantidades
 * decimales viajan SIEMPRE como strings canónicos (Decimal(10,2)), nunca
 * como `number`. El backend es la autoridad de permisos, fechas y saldos:
 * este archivo solo replica la forma de los mensajes, no sus reglas.
 */

export type StockItemArea = 'HOUSE' | 'GARDEN';
export type StockCategoryArea = 'HOUSE' | 'GARDEN' | 'BOTH';
export type StockStatusFilter = 'active' | 'inactive' | 'all';
export type StockCategoryStatusFilter = 'active' | 'all';

/** Los cinco tipos del enum real (incluye el `OPENING_BALANCE` del seed, solo lectura). */
export type StockMovementType =
  'OPENING_BALANCE' | 'INCOME' | 'CONSUMPTION' | 'ADJUSTMENT_INCREASE' | 'ADJUSTMENT_DECREASE';

/** Los únicos tipos que la operación normal puede crear vía API. */
export type OperationalMovementType = Exclude<StockMovementType, 'OPENING_BALANCE'>;

export type DestinationType = 'VEHICLE' | 'SECTOR';

/**
 * Nivel calculado por el BACKEND (Etapa 5C.1, `stock/stockLevel.ts`):
 * `critical` saldo ≤ 0; `low` 0 < saldo < mínimo; `ok` saldo > 0 y ≥ mínimo.
 * El frontend nunca lo recalcula: solo lo muestra (y dibuja su barra).
 */
export type StockLevel = 'ok' | 'low' | 'critical';
export type StockListSort = 'area' | 'name';
export type StockDestinationStatusFilter = 'active' | 'all';

export interface StockCategory {
  id: string;
  name: string;
  area: StockCategoryArea;
  active: boolean;
}

/** Resumen embebido en cada producto (`item.category`) — sin `active`. */
export interface StockCategorySummary {
  id: string;
  name: string;
  area: StockCategoryArea;
}

export interface StockItem {
  id: string;
  name: string;
  area: StockItemArea;
  unit: string;
  minimumQuantity: string;
  currentQuantity: string;
  stockLevel: StockLevel;
  active: boolean;
  category: StockCategorySummary;
}

export interface StockDestination {
  id: string;
  name: string;
  type: DestinationType;
  active: boolean;
}

export interface StockEmployeeSummary {
  id: string;
  displayName: string;
  colorHex: string;
}

export interface StockMovement {
  id: string;
  type: StockMovementType;
  quantity: string;
  /** Fecha de calendario `YYYY-MM-DD` (`@db.Date`). */
  effectiveDate: string;
  reason: string | null;
  employee: StockEmployeeSummary | null;
  destination: { id: string; name: string; type: DestinationType } | null;
  createdAt: string;
}

export interface StockPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface StockItemsListResponse extends StockPageMeta {
  items: StockItem[];
}

export interface StockMovementsListResponse extends StockPageMeta {
  movements: StockMovement[];
}

export interface StockCategoriesResponse {
  categories: StockCategory[];
}

export interface StockDestinationsResponse {
  destinations: StockDestination[];
}

export interface StockDestinationResponse {
  destination: StockDestination;
}

export interface StockItemResponse {
  item: StockItem;
}

export interface StockCategoryResponse {
  category: StockCategory;
}

export interface StockMovementMutationResponse {
  movement: StockMovement;
  item: StockItem;
}

export interface ListStockItemsParams {
  area?: StockItemArea;
  categoryId?: string;
  status?: StockStatusFilter;
  q?: string;
  stockLevel?: StockLevel;
  sort?: StockListSort;
  page?: number;
  pageSize?: number;
}

export interface ListStockMovementsParams {
  type?: StockMovementType;
  page?: number;
  pageSize?: number;
}

export interface CreateStockCategoryRequest {
  name: string;
  area: StockCategoryArea;
}

/** El backend no acepta `area` en PATCH: mover una categoría rompería sus productos. */
export interface UpdateStockCategoryRequest {
  name?: string;
  active?: boolean;
}

export interface CreateStockItemRequest {
  name: string;
  area: StockItemArea;
  categoryId: string;
  unit: string;
  minimumQuantity: string;
}

/** Sin `currentQuantity`, `area` ni `active`: la cantidad solo cambia vía movimiento. */
export interface UpdateStockItemRequest {
  name?: string;
  categoryId?: string;
  unit?: string;
  minimumQuantity?: string;
}

/**
 * `stockItemId` nunca viaja en el body (sale de la ruta). `employeeId` solo
 * lo envía un ADMIN (empleado activo, o `null` = "Administrador"); un
 * EMPLOYEE lo omite y el backend lo fija a su sesión. `effectiveDate`: hoy o
 * pasada, para todos (el backend rechaza futuras en `BUSINESS_TIME_ZONE`).
 * `destinationId` es opcional en cualquier tipo (paridad con el prototipo).
 */
export interface CreateStockMovementRequest {
  type: OperationalMovementType;
  quantity: string;
  effectiveDate?: string;
  destinationId?: string;
  employeeId?: string | null;
  reason?: string;
}

export interface CreateStockDestinationRequest {
  name: string;
  type: DestinationType;
}

/** `type` es inmutable en el backend: nunca viaja en el PATCH. */
export interface UpdateStockDestinationRequest {
  name?: string;
  active?: boolean;
}

// ── Reportes (`/stock/reports/*`, Etapa 5C.2) ────────────────────────────

export interface StockReportFilters {
  from: string;
  to: string;
  area?: StockItemArea;
  categoryId?: string;
  type?: StockMovementType;
  itemId?: string;
  employeeId?: string;
  destinationId?: string;
}

export interface StockReportRange {
  from: string;
  to: string;
  timeZone: string;
  includesCurrentDay: boolean;
  maxDays: number;
}

/** Cantidad total de UNA unidad del catálogo: nunca se suman unidades distintas. */
export interface StockQuantityByUnit {
  unit: string;
  quantity: string;
}

export interface StockReportProduct {
  item: { id: string; name: string; area: StockItemArea; unit: string; active: boolean };
  movementCount: number;
  consumptionCount: number;
  consumed: string;
  income: string;
}

export interface StockReportSummary {
  range: StockReportRange;
  totals: {
    movements: number;
    income: { count: number; byUnit: StockQuantityByUnit[] };
    consumption: { count: number; byUnit: StockQuantityByUnit[] };
    adjustments: { count: number; increase: number; decrease: number };
    openingBalance: { count: number };
  };
  currentLevels: {
    critical: number;
    low: number;
    ok: number;
    byArea: { area: StockItemArea; critical: number; low: number; ok: number }[];
  };
  products: {
    withMovements: number;
    mostMoved: StockReportProduct[];
    mostConsumed: StockReportProduct[];
  };
  destinations: {
    destination: StockDestination | null;
    count: number;
    byUnit: StockQuantityByUnit[];
  }[];
  employees: {
    employee: StockEmployeeSummary | null;
    total: number;
    byType: Record<StockMovementType, number>;
  }[];
}

export interface StockReportMovement {
  id: string;
  type: StockMovementType;
  quantity: string;
  effectiveDate: string;
  reason: string | null;
  createdAt: string;
  item: { id: string; name: string; area: StockItemArea; unit: string; active: boolean };
  employee: StockEmployeeSummary | null;
  destination: { id: string; name: string; type: DestinationType } | null;
}

export interface StockReportMovementsResponse extends StockPageMeta {
  range: StockReportRange;
  movements: StockReportMovement[];
}
