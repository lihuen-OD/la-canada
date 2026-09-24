import { apiRequest } from './httpClient';
import type {
  CreateStockCategoryRequest,
  CreateStockItemRequest,
  CreateStockMovementRequest,
  ListStockItemsParams,
  ListStockMovementsParams,
  StockCategoriesResponse,
  StockCategoryResponse,
  StockCategoryStatusFilter,
  StockDestinationsResponse,
  StockItemResponse,
  StockItemsListResponse,
  StockMovementMutationResponse,
  StockMovementsListResponse,
  UpdateStockCategoryRequest,
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

export async function fetchStockDestinations(): Promise<StockDestinationsResponse> {
  return apiRequest<StockDestinationsResponse>('/stock/destinations', { authenticated: true });
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

// ── Movimientos (ADMIN y EMPLOYEE para ingreso/consumo; ajustes solo ADMIN) ──

export async function createStockMovement(
  itemId: string,
  body: CreateStockMovementRequest,
): Promise<StockMovementMutationResponse> {
  return apiRequest<StockMovementMutationResponse>(`/stock/items/${itemId}/movements`, {
    method: 'POST',
    body,
    authenticated: true,
  });
}
