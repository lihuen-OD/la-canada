import { apiRequest } from './httpClient';
import type {
  CreateStockCategoryRequest,
  CreateStockItemRequest,
  CreateStockDestinationRequest,
  CreateStockMovementRequest,
  ListStockItemsParams,
  ListStockMovementsParams,
  StockCategoriesResponse,
  StockCategoryResponse,
  StockCategoryStatusFilter,
  StockDestinationResponse,
  StockDestinationStatusFilter,
  StockDestinationsResponse,
  StockItemResponse,
  StockItemsListResponse,
  StockMovementMutationResponse,
  StockMovementsListResponse,
  StockReportFilters,
  StockReportMovementsResponse,
  StockReportSummary,
  UpdateStockCategoryRequest,
  UpdateStockDestinationRequest,
  UpdateStockItemRequest,
} from './stockTypes';

/** Todas autenticadas: ningún endpoint de stock es público (`requireAuth` en el router). */
function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

export async function fetchStockItems(
  params: ListStockItemsParams = {},
): Promise<StockItemsListResponse> {
  return apiRequest<StockItemsListResponse>(`/stock/items${queryString(params)}`, {
    authenticated: true,
  });
}

export async function fetchStockCategories(
  status: StockCategoryStatusFilter = 'active',
): Promise<StockCategoriesResponse> {
  return apiRequest<StockCategoriesResponse>(`/stock/categories?status=${status}`, {
    authenticated: true,
  });
}

/** `active` para movimientos (todos los usuarios); `all` solo lo acepta el backend a un ADMIN. */
export async function fetchStockDestinations(
  status: StockDestinationStatusFilter = 'active',
): Promise<StockDestinationsResponse> {
  return apiRequest<StockDestinationsResponse>(`/stock/destinations?status=${status}`, {
    authenticated: true,
  });
}

export async function fetchStockItem(itemId: string): Promise<StockItemResponse> {
  return apiRequest<StockItemResponse>(`/stock/items/${itemId}`, { authenticated: true });
}

export async function fetchStockItemMovements(
  itemId: string,
  params: ListStockMovementsParams = {},
): Promise<StockMovementsListResponse> {
  return apiRequest<StockMovementsListResponse>(
    `/stock/items/${itemId}/movements${queryString(params)}`,
    { authenticated: true },
  );
}

// ── Administración del catálogo (solo ADMIN; el backend rechaza al resto) ──

export async function createStockCategory(
  body: CreateStockCategoryRequest,
): Promise<StockCategoryResponse> {
  return apiRequest<StockCategoryResponse>('/stock/categories', {
    method: 'POST',
    body,
    authenticated: true,
  });
}

export async function updateStockCategory(
  categoryId: string,
  body: UpdateStockCategoryRequest,
): Promise<StockCategoryResponse> {
  return apiRequest<StockCategoryResponse>(`/stock/categories/${categoryId}`, {
    method: 'PATCH',
    body,
    authenticated: true,
  });
}

export async function createStockItem(body: CreateStockItemRequest): Promise<StockItemResponse> {
  return apiRequest<StockItemResponse>('/stock/items', {
    method: 'POST',
    body,
    authenticated: true,
  });
}

export async function updateStockItem(
  itemId: string,
  body: UpdateStockItemRequest,
): Promise<StockItemResponse> {
  return apiRequest<StockItemResponse>(`/stock/items/${itemId}`, {
    method: 'PATCH',
    body,
    authenticated: true,
  });
}

export async function setStockItemActive(
  itemId: string,
  active: boolean,
): Promise<StockItemResponse> {
  return apiRequest<StockItemResponse>(`/stock/items/${itemId}/status`, {
    method: 'PATCH',
    body: { active },
    authenticated: true,
  });
}

export async function createStockDestination(
  body: CreateStockDestinationRequest,
): Promise<StockDestinationResponse> {
  return apiRequest<StockDestinationResponse>('/stock/destinations', {
    method: 'POST',
    body,
    authenticated: true,
  });
}

export async function updateStockDestination(
  destinationId: string,
  body: UpdateStockDestinationRequest,
): Promise<StockDestinationResponse> {
  return apiRequest<StockDestinationResponse>(`/stock/destinations/${destinationId}`, {
    method: 'PATCH',
    body,
    authenticated: true,
  });
}

// ── Movimientos (ADMIN y EMPLOYEE para ingreso/consumo; ajustes solo ADMIN) ──

/**
 * `idempotencyKey` viaja SOLO como header `Idempotency-Key` (nunca en el
 * body): la misma clave identifica la misma intención de registro, así que
 * un doble envío o un reintento del mismo request nunca crea dos movimientos
 * (el backend responde el replay con el mismo `201`).
 */
export async function createStockMovement(
  itemId: string,
  body: CreateStockMovementRequest,
  idempotencyKey: string,
): Promise<StockMovementMutationResponse> {
  return apiRequest<StockMovementMutationResponse>(`/stock/items/${itemId}/movements`, {
    method: 'POST',
    body,
    authenticated: true,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// ── Reportes (solo lectura, agregados en el backend) ──────────────────────

export async function fetchStockReportSummary(
  filters: StockReportFilters,
): Promise<StockReportSummary> {
  return apiRequest<StockReportSummary>(`/stock/reports/summary${queryString(filters)}`, {
    authenticated: true,
  });
}

export async function fetchStockReportMovements(
  filters: StockReportFilters & { page?: number; pageSize?: number },
): Promise<StockReportMovementsResponse> {
  return apiRequest<StockReportMovementsResponse>(
    `/stock/reports/movements${queryString(filters)}`,
    { authenticated: true },
  );
}

export async function fetchStockReportCsv(filters: StockReportFilters): Promise<string> {
  return apiRequest<string>(`/stock/reports/movements.csv${queryString(filters)}`, {
    authenticated: true,
    responseType: 'text',
  });
}
