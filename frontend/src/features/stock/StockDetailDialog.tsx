import { useEffect, useId, useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { fetchStockItem, fetchStockItemMovements } from '../../api/stockApi';
import { useSessionScope } from '../../api/useSessionScope';
import type {
  StockItem,
  StockMovement,
  StockMovementType,
  StockMovementsListResponse,
} from '../../api/stockTypes';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { isSessionExpired } from './stockErrors';
import {
  AREA_LABEL,
  LEVEL_LABEL,
  LEVEL_TONE,
  MOVEMENT_FILTER_ORDER,
  MOVEMENT_LABEL,
  formatStockDay,
} from './stockLabels';
import { movementSignedPrefix } from './stockStatus';

interface StockDetailDialogProps {
  /** Producto con el que se abrió el diálogo (snapshot del listado, recién cargado). */
  item: StockItem;
  onCancel: () => void;
  onSessionExpired: () => void;
}

const PAGE_SIZE = 20;

/**
 * Detalle de producto + historial inmutable (`GET /stock/items/:id` y
 * `GET /stock/items/:id/movements`), en TanStack Query (Etapa 5C.2): el
 * historial se cachea 30 s por producto y filtro, y un movimiento del
 * producto invalida su detalle y su historial. El detalle arranca con el
 * snapshot del listado (ya fresco): abrir el diálogo cuesta un solo request
 * (el historial). Sin edición ni borrado de movimientos.
 */
export function StockDetailDialog({ item, onCancel, onSessionExpired }: StockDetailDialogProps) {
  const titleId = useId();
  const typeSelectId = useId();
  const [typeFilter, setTypeFilter] = useState<StockMovementType | ''>('');
  const { userId, enabled } = useSessionScope();

  const [openedAt] = useState(() => Date.now());
  const itemQuery = useQuery({
    queryKey: queryKeys.stock.item(userId, item.id),
    queryFn: () => fetchStockItem(item.id),
    enabled,
    initialData: { item },
    initialDataUpdatedAt: openedAt,
  });
  const latestItem = itemQuery.data.item;

  const movementsQuery = useInfiniteQuery({
    queryKey: queryKeys.stock.movements(userId, item.id, typeFilter),
    queryFn: ({ pageParam }) =>
      fetchStockItemMovements(item.id, {
        type: typeFilter || undefined,
        page: pageParam,
        pageSize: PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last: StockMovementsListResponse) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    enabled,
    placeholderData: keepPreviousData,
  });

  const sessionExpired =
    isSessionExpired(itemQuery.error) || isSessionExpired(movementsQuery.error);
  useEffect(() => {
    if (sessionExpired) onSessionExpired();
  }, [sessionExpired, onSessionExpired]);

  const pages = movementsQuery.data?.pages;
  const movements = useMemo(
    () =>
      pages ? pages.reduce<StockMovement[]>((all, page) => mergeById(all, page.movements), []) : [],
    [pages],
  );
  const last = pages?.[pages.length - 1];
  const loadingMore = movementsQuery.isFetchingNextPage;
  const refreshing = Boolean(pages) && movementsQuery.isFetching && !loadingMore;

  function loadMore(): void {
    if (movementsQuery.isFetchingNextPage || !movementsQuery.hasNextPage) return;
    // Un segundo click reutiliza la página en vuelo (nunca dispara otra).
    void movementsQuery.fetchNextPage({ cancelRefetch: false });
  }

  const level = latestItem.stockLevel;

  return (
    <Modal titleId={titleId} onRequestClose={onCancel}>
      <div className="dialog stock-detail">
        <h2 id={titleId} className="dialog__title">
          <span aria-hidden="true">📋 </span>
          {latestItem.name}
        </h2>

        <dl className="stock-detail__summary">
          <div>
            <dt>Saldo actual</dt>
            <dd className="stock-detail__balance">
              {latestItem.currentQuantity} {latestItem.unit}
            </dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd>
              {level !== 'ok' ? <span aria-hidden="true">⚠️ </span> : null}
              <Badge tone={LEVEL_TONE[level]}>{LEVEL_LABEL[level]}</Badge>
            </dd>
          </div>
          <div>
            <dt>Stock mínimo</dt>
            <dd>
              {latestItem.minimumQuantity} {latestItem.unit}
            </dd>
          </div>
          <div>
            <dt>Categoría</dt>
            <dd>{latestItem.category.name}</dd>
          </div>
          <div>
            <dt>Área</dt>
            <dd>{AREA_LABEL[latestItem.area]}</dd>
          </div>
          <div>
            <dt>Unidad</dt>
            <dd>{latestItem.unit}</dd>
          </div>
        </dl>

        <div className="field">
          <label className="field__label" htmlFor={typeSelectId}>
            Filtrar por tipo de movimiento
          </label>
          <select
            id={typeSelectId}
            className="field__input"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as StockMovementType | '')}
          >
            <option value="">Todos</option>
            {MOVEMENT_FILTER_ORDER.map((type) => (
              <option key={type} value={type}>
                {MOVEMENT_LABEL[type]}
              </option>
            ))}
          </select>
        </div>

        <section aria-label="Historial de movimientos" aria-busy={refreshing || undefined}>
          <p className="stock__refreshing" role="status">
            {refreshing ? 'Actualizando…' : null}
          </p>
          {!pages ? (
            movementsQuery.isError ? (
              <ErrorState
                title="No pudimos cargar el historial."
                onRetry={() => void movementsQuery.refetch()}
              />
            ) : (
              <LoadingState label="Cargando historial…" />
            )
          ) : movements.length === 0 ? (
            <EmptyState
              title="Sin movimientos registrados."
              description={
                typeFilter ? 'Ningún movimiento de este tipo.' : 'Aún no hay movimientos.'
              }
            />
          ) : (
            <div className={movementsQuery.isPlaceholderData ? 'is-stale' : undefined}>
              <ul className="stock-moves" role="list">
                {movements.map((movement) => (
                  <MovementRow key={movement.id} movement={movement} unit={latestItem.unit} />
                ))}
              </ul>
              {last && last.page < last.totalPages ? (
                <div className="stock-detail__more">
                  <Button variant="secondary" disabled={loadingMore} onClick={loadMore}>
                    {loadingMore
                      ? 'Cargando…'
                      : `Cargar más (${movements.length} de ${last.total})`}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <div className="dialog__actions">
          <Button variant="secondary" onClick={onCancel}>
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((entry) => entry.id));
  return [...current, ...incoming.filter((entry) => !seen.has(entry.id))];
}

function MovementRow({ movement, unit }: { movement: StockMovement; unit: string }) {
  const prefix = movementSignedPrefix(movement.type);
  return (
    <li className="stock-move">
      <div className="stock-move__head">
        <Badge tone={movement.type === 'CONSUMPTION' ? 'earth' : 'info'}>
          {MOVEMENT_LABEL[movement.type]}
        </Badge>
        <span className="stock-move__date">{formatStockDay(movement.effectiveDate)}</span>
        <span className="stock-move__qty">
          {prefix}
          {movement.quantity} {unit}
        </span>
      </div>
      <p className="stock-move__meta">
        {movement.employee ? movement.employee.displayName : 'Sin persona registrada'}
        {movement.destination ? ` · Destino: ${movement.destination.name}` : ''}
        {movement.reason ? ` · ${movement.reason}` : ''}
      </p>
    </li>
  );
}
