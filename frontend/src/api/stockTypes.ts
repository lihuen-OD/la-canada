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
  active: boolean;
  category: StockCategorySummary;
}

export interface StockDestination {
  id: string;
  name: string;
  type: DestinationType;
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
 * `employeeId` y `stockItemId` NUNCA viajan en el body: el responsable sale
 * de la sesión y el producto de la ruta. `effectiveDate` solo lo envía un
 * ADMIN (ausente = hoy en `BUSINESS_TIME_ZONE`, decides el backend).
 */
export interface CreateStockMovementRequest {
  type: OperationalMovementType;
  quantity: string;
  effectiveDate?: string;
  destinationId?: string;
  reason?: string;
}
