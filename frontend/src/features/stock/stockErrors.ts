import { ApiError } from '../../api/httpClient';

export const NETWORK_ERROR_MESSAGE = 'No se pudo conectar. Intentá de nuevo.';

const STOCK_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  STOCK_INSUFFICIENT_QUANTITY: 'La reducción supera el stock disponible.',
  STOCK_BALANCE_LIMIT: 'El incremento superaría el saldo máximo permitido.',
  STOCK_CATEGORY_IN_USE: 'La categoría tiene productos activos y no se puede desactivar.',
  STOCK_ITEM_NOT_FOUND: 'El producto ya no existe.',
  STOCK_CATEGORY_NOT_FOUND: 'La categoría ya no existe.',
  STOCK_DESTINATION_NOT_FOUND: 'El destino ya no existe.',
  STOCK_ITEM_INACTIVE: 'El producto está desactivado.',
  STOCK_CATEGORY_INACTIVE: 'La categoría está inactiva.',
  STOCK_DESTINATION_INACTIVE: 'El destino está inactivo.',
  STOCK_ITEM_DUPLICATE: 'Ya existe un producto con ese nombre en esa área.',
  STOCK_CATEGORY_DUPLICATE: 'Ya existe una categoría con ese nombre en esa área.',
};

/** Mensaje humano del backend (`ApiError.message`, que ya trae texto legible para los códigos `STOCK_*`). */
export function errorMessageOf(error: unknown): string {
  if (!(error instanceof ApiError)) return NETWORK_ERROR_MESSAGE;
  return (error.code && STOCK_ERROR_MESSAGES[error.code]) || error.message;
}

/** 401 tras el refresh-y-reintento de `httpClient`: la sesión ya no es válida. */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function stockErrorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

/** 409 con conflicto de datos concurrentes/estado: conviene refrescar el listado antes de reintentar. */
export function isStockConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}
