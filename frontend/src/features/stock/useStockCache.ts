import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { createStockMovement } from '../../api/stockApi';
import type {
  CreateStockMovementRequest,
  StockMovementMutationResponse,
} from '../../api/stockTypes';
import { useSessionScope } from '../../api/useSessionScope';

/**
 * Invalidaciones selectivas de Stock (Etapa 5C.2) — nunca un
 * `invalidateQueries()` global. Las consultas activas se revalidan en
 * segundo plano conservando sus datos; las inactivas se marcan viejas.
 */
export function useStockCache() {
  const queryClient = useQueryClient();
  const { userId } = useSessionScope();

  /**
   * Tras un movimiento del producto `itemId`: su detalle, TODOS los
   * listados de productos (inventario Casa/Jardín, Compras y catálogo
   * comparten `items`), su historial y los reportes. Categorías y destinos
   * no cambian con un movimiento.
   */
  const afterMovement = useCallback(
    (itemId: string) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.stock.item(userId, itemId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stock.itemsAll(userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stock.movements(userId, itemId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stock.reportsAll(userId) });
    },
    [queryClient, userId],
  );

  /** Alta/edición/estado de producto: listados y detalles (sus saldos no cambian). */
  const afterItemChange = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.stock.itemsAll(userId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.stock.itemAll(userId) });
  }, [queryClient, userId]);

  /** Categorías: su catálogo y los productos (que embeben el nombre de la categoría). */
  const afterCategoryChange = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.stock.categoriesAll(userId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.stock.itemsAll(userId) });
  }, [queryClient, userId]);

  /** Destinos: solo sus listados (activos para movimientos y `all` del catálogo). */
  const afterDestinationChange = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.stock.destinationsAll(userId) });
  }, [queryClient, userId]);

  return { afterMovement, afterItemChange, afterCategoryChange, afterDestinationChange };
}

/**
 * Envío de un movimiento con su `Idempotency-Key` + invalidación. Sin
 * actualización optimista: el saldo nuevo lo decide el backend. Un replay
 * (`201` con el cuerpo almacenado) es un éxito idéntico a la creación.
 */
export function useSubmitStockMovement() {
  const { afterMovement } = useStockCache();
  return useCallback(
    async (
      itemId: string,
      body: CreateStockMovementRequest,
      idempotencyKey: string,
    ): Promise<StockMovementMutationResponse> => {
      const response = await createStockMovement(itemId, body, idempotencyKey);
      afterMovement(itemId);
      return response;
    },
    [afterMovement],
  );
}
