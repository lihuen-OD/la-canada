import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import {
  createStockCategory,
  createStockItem,
  fetchStockCategories,
  fetchStockItems,
  setStockItemActive,
  updateStockCategory,
  updateStockItem,
} from '../../api/stockApi';
import type {
  CreateStockCategoryRequest,
  CreateStockItemRequest,
  StockCategory,
  StockItem,
  StockItemsListResponse,
  UpdateStockCategoryRequest,
  UpdateStockItemRequest,
} from '../../api/stockTypes';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { CategoryFormDialog } from './CategoryFormDialog';
import { ItemFormDialog } from './ItemFormDialog';
import { isSessionExpired } from './stockErrors';
import { AREA_LABEL } from './stockLabels';

type CatalogLoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; categories: StockCategory[]; items: StockItemsListResponse };

type CatalogDialogState =
  | { type: 'none' }
  | { type: 'category-form'; category?: StockCategory }
  | { type: 'item-form'; item?: StockItem }
  | { type: 'category-toggle'; category: StockCategory }
  | { type: 'item-toggle'; item: StockItem };

interface StockCatalogProps {
  onSessionExpired: () => void;
  /** Cambia después de cada mutación del inventario operativo para recargar también el catálogo. */
  refreshKey: number;
}

const PAGE_SIZE = 50;

/**
 * Administración del catálogo (solo ADMIN — el backend rechaza al resto
 * con 403 en cada request). Categorías con `status=all`; productos con
 * paginación real (`page`/`pageSize`/`total`). Desactivar una categoría
 * que todavía tiene productos activos responde 409 `STOCK_CATEGORY_IN_USE`:
 * la confirmación lo advierte y el error del backend se muestra tal cual.
 * Nunca hay borrado físico ni edición de cantidades.
 */
export function StockCatalog({ onSessionExpired, refreshKey }: StockCatalogProps) {
  const [state, setState] = useState<CatalogLoadState>({ status: 'loading' });
  const [dialog, setDialog] = useState<CatalogDialogState>({ type: 'none' });
  const [notice, setNotice] = useState<{ tone: 'positive' | 'danger'; text: string } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadIdRef = useRef(0);
  const loadMoreGuardRef = useRef(false);
  const queryClient = useQueryClient();
  const { userId } = useSessionScope();

  const closeDialog = useCallback(() => setDialog({ type: 'none' }), []);

  const load = useCallback(
    (page: number, append: boolean): Promise<void> => {
      const loadId = ++loadIdRef.current;
      // Sin setState síncrono: el estado inicial ya es `loading` y el
      // reintento lo pone el handler; acá solo se dispara la request.
      return Promise.all([
        fetchStockCategories('all'),
        fetchStockItems({ status: 'all', page, pageSize: PAGE_SIZE }),
      ])
        .then(([categoriesResponse, itemsResponse]) => {
          if (loadId !== loadIdRef.current) return;
          setState((previous) => {
            if (!append || previous.status !== 'loaded') {
              return {
                status: 'loaded',
                categories: categoriesResponse.categories,
                items: itemsResponse,
              };
            }
            return {
              status: 'loaded',
              categories: categoriesResponse.categories,
              items: {
                ...itemsResponse,
                items: mergeById(previous.items.items, itemsResponse.items),
              },
            };
          });
        })
        .catch((error: unknown) => {
          if (loadId !== loadIdRef.current) return;
          if (isSessionExpired(error)) {
            onSessionExpired();
            return;
          }
          if (append) {
            setNotice({ tone: 'danger', text: 'No pudimos cargar más productos.' });
            return;
          }
          setState({ status: 'error' });
        })
        .finally(() => {
          if (loadId !== loadIdRef.current) return;
          loadMoreGuardRef.current = false;
          setLoadingMore(false);
        });
    },
    [onSessionExpired],
  );

  // Recarga en segundo plano tras una mutación (sin blankear la lista).
  useEffect(() => {
    void load(1, false);
    return () => {
      loadIdRef.current += 1;
      loadMoreGuardRef.current = false;
    };
  }, [load, refreshKey]);

  const refresh = useCallback(() => {
    // Puede convivir con una página adicional en vuelo. Se invalida y se
    // libera su guarda antes de volver a página 1; el `finally` viejo queda
    // ignorado por `loadIdRef`.
    loadIdRef.current += 1;
    loadMoreGuardRef.current = false;
    setLoadingMore(false);
    void load(1, false);
  }, [load]);

  async function handleSessionAware(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      if (isSessionExpired(error)) {
        onSessionExpired();
        throw error;
      }
      throw error;
    }
  }

  const afterSuccess = (text: string) => {
    closeDialog();
    setNotice({ tone: 'positive', text });
    refresh();
    // Etapa 5P: el inventario operativo y los filtros de categoría se
    // alimentan de la caché — un cambio de catálogo la invalida (solo Stock).
    void queryClient.invalidateQueries({ queryKey: queryKeys.stock.itemsAll(userId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.stock.categoriesAll(userId) });
  };

  if (state.status === 'loading') {
    return (
      <Card>
        <LoadingState label="Cargando catálogo…" />
      </Card>
    );
  }
  if (state.status === 'error') {
    return (
      <Card>
        <ErrorState
          title="No pudimos cargar el catálogo."
          onRetry={() => {
            setState({ status: 'loading' });
            void load(1, false);
          }}
        />
      </Card>
    );
  }

  const { categories, items } = state;

  return (
    <div className="stock-catalog">
      <div aria-live="polite" className="stock__notice">
        {notice ? (
          <p
            role={notice.tone === 'danger' ? 'alert' : 'status'}
            className={`notice notice--${notice.tone}`}
          >
            {notice.text}
          </p>
        ) : null}
      </div>

      <Card
        title="Categorías"
        actions={
          <Button size="sm" onClick={() => setDialog({ type: 'category-form' })}>
            + Nueva categoría
          </Button>
        }
      >
        {categories.length === 0 ? (
          <EmptyState title="Todavía no hay categorías." description="Creá la primera." />
        ) : (
          <ul className="stock-catalog__list" role="list" aria-label="Categorías de stock">
            {categories.map((category) => (
              <li key={category.id} className="stock-catalog__row">
                <div className="stock-catalog__text">
                  <span className="stock-catalog__name">{category.name}</span>
                  <span className="stock-catalog__meta">
                    <Badge tone="neutral">{AREA_LABEL[category.area]}</Badge>
                    {!category.active ? <Badge tone="danger">Inactiva</Badge> : null}
                  </span>
                </div>
                <div className="stock-catalog__actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDialog({ type: 'category-form', category })}
                  >
                    Editar
                    <span className="visually-hidden">: {category.name}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant={category.active ? 'ghost' : 'secondary'}
                    onClick={() => setDialog({ type: 'category-toggle', category })}
                  >
                    {category.active ? 'Desactivar' : 'Reactivar'}
                    <span className="visually-hidden">: {category.name}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Productos"
        actions={
          <Button size="sm" onClick={() => setDialog({ type: 'item-form' })}>
            + Nuevo producto
          </Button>
        }
      >
        {items.items.length === 0 ? (
          <EmptyState title="Todavía no hay productos." description="Creá el primero." />
        ) : (
          <>
            <ul className="stock-catalog__list" role="list" aria-label="Productos de stock">
              {items.items.map((item) => (
                <li key={item.id} className="stock-catalog__row">
                  <div className="stock-catalog__text">
                    <span className="stock-catalog__name">{item.name}</span>
                    <span className="stock-catalog__meta">
                      <Badge tone="neutral">{AREA_LABEL[item.area]}</Badge>
                      <Badge tone="info">{item.category.name}</Badge>
                      {!item.active ? <Badge tone="danger">Desactivado</Badge> : null}
                      <span className="stock-catalog__qty">
                        {item.currentQuantity} {item.unit}
                      </span>
                    </span>
                  </div>
                  <div className="stock-catalog__actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDialog({ type: 'item-form', item })}
                    >
                      Editar
                      <span className="visually-hidden">: {item.name}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant={item.active ? 'ghost' : 'secondary'}
                      onClick={() => setDialog({ type: 'item-toggle', item })}
                    >
                      {item.active ? 'Desactivar' : 'Reactivar'}
                      <span className="visually-hidden">: {item.name}</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {items.page < items.totalPages ? (
              <div className="stock-catalog__more">
                <Button
                  variant="secondary"
                  disabled={loadingMore}
                  onClick={() => {
                    if (loadMoreGuardRef.current) return;
                    loadMoreGuardRef.current = true;
                    setLoadingMore(true);
                    void load(items.page + 1, true);
                  }}
                >
                  Cargar más ({items.items.length} de {items.total})
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Card>

      {dialog.type === 'category-form' ? (
        <CategoryFormDialog
          category={dialog.category}
          onCancel={closeDialog}
          onSessionExpired={onSessionExpired}
          onSubmit={async (body: CreateStockCategoryRequest | UpdateStockCategoryRequest) => {
            // El formulario traduce el error y gestiona un 401 una sola vez.
            if (dialog.category) {
              await updateStockCategory(dialog.category.id, body as UpdateStockCategoryRequest);
            } else {
              await createStockCategory(body as CreateStockCategoryRequest);
            }
            afterSuccess(dialog.category ? 'Categoría actualizada.' : 'Categoría creada.');
          }}
        />
      ) : null}

      {dialog.type === 'item-form' ? (
        <ItemFormDialog
          item={dialog.item}
          categories={categories}
          onCancel={closeDialog}
          onSessionExpired={onSessionExpired}
          onSubmit={async (body: CreateStockItemRequest | UpdateStockItemRequest) => {
            // El formulario traduce el error y gestiona un 401 una sola vez.
            if (dialog.item) {
              await updateStockItem(dialog.item.id, body as UpdateStockItemRequest);
            } else {
              await createStockItem(body as CreateStockItemRequest);
            }
            afterSuccess(dialog.item ? 'Producto actualizado.' : 'Producto creado.');
          }}
        />
      ) : null}

      {dialog.type === 'category-toggle' ? (
        <ConfirmDialog
          title={
            dialog.category.active
              ? `Desactivar «${dialog.category.name}»`
              : `Reactivar «${dialog.category.name}»`
          }
          description={
            dialog.category.active
              ? 'La categoría deja de estar disponible para nuevos productos. No se puede desactivar mientras tenga productos activos: primero desactivalos (o asignalos a otra categoría). No se borra nada.'
              : 'La categoría vuelve a estar disponible para asignarla a productos.'
          }
          confirmLabel={dialog.category.active ? 'Desactivar' : 'Reactivar'}
          tone={dialog.category.active ? 'danger' : 'default'}
          onCancel={closeDialog}
          onConfirm={async () => {
            await handleSessionAware(async () => {
              await updateStockCategory(dialog.category.id, {
                active: !dialog.category.active,
              });
            });
            afterSuccess(
              dialog.category.active ? 'Categoría desactivada.' : 'Categoría reactivada.',
            );
          }}
        />
      ) : null}

      {dialog.type === 'item-toggle' ? (
        <ConfirmDialog
          title={
            dialog.item.active
              ? `Desactivar «${dialog.item.name}»`
              : `Reactivar «${dialog.item.name}»`
          }
          description={
            dialog.item.active
              ? 'El producto deja de admitir movimientos y no aparece en el listado operativo por defecto. No se borra: su historial se conserva y podés reactivarlo cuando quieras.'
              : 'El producto vuelve a admitir movimientos y a aparecer en el listado operativo.'
          }
          confirmLabel={dialog.item.active ? 'Desactivar' : 'Reactivar'}
          tone={dialog.item.active ? 'danger' : 'default'}
          onCancel={closeDialog}
          onConfirm={async () => {
            await handleSessionAware(async () => {
              await setStockItemActive(dialog.item.id, !dialog.item.active);
            });
            afterSuccess(dialog.item.active ? 'Producto desactivado.' : 'Producto reactivado.');
          }}
        />
      ) : null}
    </div>
  );
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((entry) => entry.id));
  return [...current, ...incoming.filter((entry) => !seen.has(entry.id))];
}
