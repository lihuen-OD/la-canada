import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { fetchStockItem, fetchStockItemMovements } from '../../api/stockApi';
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
  LEVEL_LABEL,
  LEVEL_TONE,
  MOVEMENT_FILTER_ORDER,
  MOVEMENT_LABEL,
  formatStockDay,
} from './stockLabels';
import { movementSignedPrefix, stockLevel } from './stockStatus';

type MovementsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; data: StockMovementsListResponse };

interface StockDetailDialogProps {
  /** Producto con el que se abrió el diálogo (snapshot inicial). */
  item: StockItem;
  /** Cambia después de cada mutación en la pantalla madre para recargar. */
  refreshKey: number;
  onCancel: () => void;
  onSessionExpired: () => void;
}

const PAGE_SIZE = 20;

/**
 * Detalle de producto + historial inmutable (`GET /stock/items/:id` y
 * `GET /stock/items/:id/movements`). Sin edición ni borrado de movimientos:
 * el contrato 5A solo ofrece POST de creación. El filtro de tipo y la
 * paginación van al backend (`type`, `page`, `pageSize`).
 */
export function StockDetailDialog({
  item,
  refreshKey,
  onCancel,
  onSessionExpired,
}: StockDetailDialogProps) {
  const titleId = useId();
  const typeSelectId = useId();
  const [state, setState] = useState<MovementsState>({ status: 'loading' });
  const [typeFilter, setTypeFilter] = useState<StockMovementType | ''>('');
  const [latestItem, setLatestItem] = useState<StockItem>(item);
  const [loadingMore, setLoadingMore] = useState(false);
  const movementLoadIdRef = useRef(0);
  const itemLoadIdRef = useRef(0);
  const loadMoreGuardRef = useRef(false);

  const load = useCallback(
    (pageToLoad: number, append: boolean) => {
      const loadId = ++movementLoadIdRef.current;
      fetchStockItemMovements(item.id, {
        type: typeFilter || undefined,
        page: pageToLoad,
        pageSize: PAGE_SIZE,
      })
        .then((response) => {
          if (loadId !== movementLoadIdRef.current) return;
          setState((previous) => {
            if (!append || previous.status !== 'loaded') {
              return { status: 'loaded', data: response };
            }
            return {
              status: 'loaded',
              data: {
                ...response,
                movements: mergeById(previous.data.movements, response.movements),
              },
            };
          });
        })
        .catch((error: unknown) => {
          if (loadId !== movementLoadIdRef.current) return;
          if (isSessionExpired(error)) {
            onSessionExpired();
            return;
          }
          setState({ status: 'error' });
        })
        .finally(() => {
          if (loadId !== movementLoadIdRef.current) return;
          loadMoreGuardRef.current = false;
          setLoadingMore(false);
        });
    },
    [item.id, typeFilter, onSessionExpired],
  );

  useEffect(() => {
    load(1, false);
    return () => {
      movementLoadIdRef.current += 1;
      loadMoreGuardRef.current = false;
    };
  }, [load, refreshKey]);

  // Refrescar también el snapshot del producto (saldo tras un movimiento).
  useEffect(() => {
    const loadId = ++itemLoadIdRef.current;
    fetchStockItem(item.id)
      .then((response) => {
        if (loadId === itemLoadIdRef.current) setLatestItem(response.item);
      })
      .catch((error: unknown) => {
        if (loadId === itemLoadIdRef.current && isSessionExpired(error)) onSessionExpired();
      });
    return () => {
      if (loadId === itemLoadIdRef.current) itemLoadIdRef.current += 1;
    };
  }, [item.id, refreshKey, onSessionExpired]);

  const level = stockLevel(latestItem.currentQuantity, latestItem.minimumQuantity);
  const hasMore = state.status === 'loaded' && state.data.page < state.data.totalPages;

  function handleTypeChange(next: StockMovementType | ''): void {
    movementLoadIdRef.current += 1;
    loadMoreGuardRef.current = false;
    setLoadingMore(false);
    setState({ status: 'loading' });
    setTypeFilter(next);
  }

  function retry(): void {
    setState({ status: 'loading' });
    load(1, false);
  }

  function loadMore(): void {
    if (state.status !== 'loaded' || loadMoreGuardRef.current) return;
    loadMoreGuardRef.current = true;
    setLoadingMore(true);
    load(state.data.page + 1, true);
  }

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
            <dd>{latestItem.area === 'HOUSE' ? 'Casa' : 'Jardín'}</dd>
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
            onChange={(event) => handleTypeChange(event.target.value as StockMovementType | '')}
          >
            <option value="">Todos</option>
            {MOVEMENT_FILTER_ORDER.map((type) => (
              <option key={type} value={type}>
                {MOVEMENT_LABEL[type]}
              </option>
            ))}
          </select>
        </div>

        <section aria-label="Historial de movimientos">
          {state.status === 'loading' ? (
            <LoadingState label="Cargando historial…" />
          ) : state.status === 'error' ? (
            <ErrorState title="No pudimos cargar el historial." onRetry={retry} />
          ) : state.data.movements.length === 0 ? (
            <EmptyState
              title="Sin movimientos registrados."
              description={
                typeFilter ? 'Ningún movimiento de este tipo.' : 'Aún no hay movimientos.'
              }
            />
          ) : (
            <>
              <ul className="stock-moves" role="list">
                {state.data.movements.map((movement) => (
                  <MovementRow key={movement.id} movement={movement} unit={latestItem.unit} />
                ))}
              </ul>
              {hasMore ? (
                <div className="stock-detail__more">
                  <Button variant="secondary" disabled={loadingMore} onClick={loadMore}>
                    {loadingMore
                      ? 'Cargando…'
                      : `Cargar más (${state.data.movements.length} de ${state.data.total})`}
                  </Button>
                </div>
              ) : null}
            </>
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
