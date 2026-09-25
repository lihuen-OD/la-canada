import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { createStockItem, fetchStockCategories, fetchStockItems } from '../../api/stockApi';
import { useSessionScope } from '../../api/useSessionScope';
import type {
  ListStockItemsParams,
  StockItem,
  StockItemArea,
  StockItemsListResponse,
} from '../../api/stockTypes';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { MovementDialog } from './MovementDialog';
import type { MovementKind } from './MovementDialog';
import { ItemFormDialog } from './ItemFormDialog';
import { StockDetailDialog } from './StockDetailDialog';
import { StockFilters } from './StockFilters';
import { StockItemCard } from './StockItemCard';
import { StockNotice, type Notice } from './StockNotice';
import { StockPage } from './StockPage';
import { errorMessageOf, isSessionExpired } from './stockErrors';
import { useDebouncedSearch, useSessionExpiry } from './stockHooks';
import { AREA_EMOJI, AREA_LABEL, MOVEMENT_SUCCESS_TEXT, groupItemsByCategory } from './stockLabels';
import { useInventoryFilters } from './stockViewState';
import { useStockCache } from './useStockCache';

type DialogState =
  | { type: 'none' }
  | { type: 'item-form' }
  | { type: 'movement'; item: StockItem; kind: MovementKind }
  | { type: 'detail'; item: StockItem };

const PAGE_SIZE = 50;

/**
 * 🏠 Casa / 🌿 Jardín — el MISMO inventario parametrizado por área. TODA la
 * consulta es server-side: `area`, `q`, `categoryId`, `stockLevel` y
 * `status` viajan como query de `GET /stock/items`; nada se filtra sobre una
 * página ya cargada. Paginación con «Cargar más» (acumula páginas). El
 * nivel de cada producto es el `stockLevel` del backend. Sin
 * actualizaciones optimistas: un movimiento espera al backend e invalida
 * inventario, Compras, historial y reportes.
 */
export function InventoryView({ area }: { area: StockItemArea }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const [filters, updateFilters] = useInventoryFilters(area);
  const commitSearch = useCallback((q: string) => updateFilters({ q }), [updateFilters]);
  const [searchInput, setSearchInput] = useDebouncedSearch(filters.q, commitSearch);
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const [notice, setNotice] = useState<Notice>(null);
  const { afterItemChange } = useStockCache();

  const itemFilters: Omit<ListStockItemsParams, 'page' | 'pageSize'> = {
    q: filters.q || undefined,
    area,
    categoryId: filters.categoryId || undefined,
    stockLevel: filters.stockLevel || undefined,
    status: isAdmin ? filters.status : 'active',
  };

  /**
   * Una entrada de caché por combinación de filtros (Etapa 5P). Cambiar un
   * filtro conserva la lista anterior visible hasta que llega la nueva; una
   * respuesta vieja nunca pisa un filtro nuevo (cada una tiene su clave).
   */
  const itemsQuery = useInfiniteQuery({
    queryKey: queryKeys.stock.items(userId, itemFilters),
    queryFn: ({ pageParam }) =>
      fetchStockItems({ ...itemFilters, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last: StockItemsListResponse) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    enabled,
    placeholderData: keepPreviousData,
  });
  const categoryStatus = isAdmin ? 'all' : 'active';
  const categoriesQuery = useQuery({
    queryKey: queryKeys.stock.categories(userId, categoryStatus),
    queryFn: () => fetchStockCategories(categoryStatus),
    enabled,
    staleTime: STALE_TIME.catalog,
  });

  const handleSessionExpired = useSessionExpiry(itemsQuery.error, categoriesQuery.error);

  const pages = itemsQuery.data?.pages;
  const items = useMemo(
    () => (pages ? pages.reduce<StockItem[]>((all, page) => mergeById(all, page.items), []) : []),
    [pages],
  );
  const groups = useMemo(() => groupItemsByCategory(items), [items]);
  const last = pages?.[pages.length - 1];
  const loaded = Boolean(pages && categoriesQuery.data);
  const loadingMore = itemsQuery.isFetchingNextPage;
  const refreshing =
    loaded && ((itemsQuery.isFetching && !loadingMore) || categoriesQuery.isFetching);
  const staleAfterError = loaded && !loadingMore && itemsQuery.isError && !itemsQuery.isFetching;

  const loadMore = useCallback(() => {
    if (itemsQuery.isFetchingNextPage || !itemsQuery.hasNextPage) return;
    // `cancelRefetch: false`: un segundo click (incluso síncrono, antes del
    // re-render) reutiliza la página ya en vuelo — nunca dispara otra.
    itemsQuery.fetchNextPage({ cancelRefetch: false }).then(
      (result) => {
        if (result.isError && !isSessionExpired(result.error)) {
          setNotice({ tone: 'danger', text: errorMessageOf(result.error) });
        }
      },
      () => undefined,
    );
  }, [itemsQuery]);

  const retry = useCallback(() => {
    void itemsQuery.refetch();
    void categoriesQuery.refetch();
  }, [itemsQuery, categoriesQuery]);

  const closeDialog = useCallback(() => setDialog({ type: 'none' }), []);

  let content;
  if (!loaded) {
    content =
      itemsQuery.isError || categoriesQuery.isError ? (
        <Card>
          <ErrorState title="No pudimos cargar el inventario." onRetry={retry} />
        </Card>
      ) : (
        <Card>
          <LoadingState label="Cargando inventario…" />
        </Card>
      );
  } else {
    content = (
      <>
        <StockFilters
          area={area}
          categories={categoriesQuery.data!.categories}
          categoryId={filters.categoryId}
          onCategoryIdChange={(categoryId) => updateFilters({ categoryId })}
          stockLevel={filters.stockLevel}
          onStockLevelChange={(stockLevel) => updateFilters({ stockLevel })}
          status={filters.status}
          onStatusChange={(status) => updateFilters({ status })}
          isAdmin={isAdmin}
          searchInput={searchInput}
          onSearchInputChange={setSearchInput}
        />

        <div className="stock__area-heading">
          <h2 className="stock__area-label">
            <span aria-hidden="true">{AREA_EMOJI[area]} </span>
            {AREA_LABEL[area]}
          </h2>
          <p className="stock__count" role="status">
            {last?.total ?? 0} {last?.total === 1 ? 'producto' : 'productos'}
          </p>
        </div>

        <Card className={itemsQuery.isPlaceholderData ? 'is-stale' : undefined}>
          {items.length === 0 ? (
            <EmptyState
              title="No hay productos con estos filtros."
              description="Probá con otra categoría, nivel o búsqueda."
            />
          ) : (
            <>
              <div className="stock__groups">
                {groups.map((group) => (
                  <section
                    key={group.category.id}
                    className="stock-group"
                    aria-label={`Categoría ${group.category.name}`}
                  >
                    <h3 className="stock-group__title">{group.category.name}</h3>
                    <ul className="stock-group__list" role="list">
                      {group.items.map((item) => (
                        <StockItemCard
                          key={item.id}
                          item={item}
                          isAdmin={isAdmin}
                          onMovement={(target, kind) =>
                            setDialog({ type: 'movement', item: target, kind })
                          }
                          onDetail={(target) => setDialog({ type: 'detail', item: target })}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              {last && last.page < last.totalPages ? (
                <div className="stock__more">
                  <Button variant="secondary" disabled={loadingMore} onClick={loadMore}>
                    {loadingMore ? 'Cargando…' : `Cargar más (${items.length} de ${last.total})`}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </Card>
      </>
    );
  }

  return (
    <StockPage
      description={`Inventario de ${AREA_LABEL[area]}: cantidades, mínimos y movimientos.`}
      refreshing={refreshing}
      actions={
        isAdmin ? (
          <Button className="stock__desktop-add" onClick={() => setDialog({ type: 'item-form' })}>
            + Nuevo producto
          </Button>
        ) : null
      }
    >
      <StockNotice
        notice={notice}
        staleError={
          staleAfterError
            ? 'No pudimos actualizar el inventario. Mostramos los últimos datos.'
            : null
        }
        onRetry={retry}
      />
      {content}

      {isAdmin ? (
        <Button
          className="stock__fab"
          aria-label="Nuevo producto"
          title="Nuevo producto"
          onClick={() => setDialog({ type: 'item-form' })}
        >
          ＋
        </Button>
      ) : null}

      {dialog.type === 'item-form' ? (
        <ItemFormDialog
          categories={categoriesQuery.data?.categories ?? []}
          defaultArea={area}
          onCancel={closeDialog}
          onSessionExpired={handleSessionExpired}
          onSubmit={async (body) => {
            if (!('area' in body)) return;
            await createStockItem(body);
            afterItemChange();
            closeDialog();
            setNotice({ tone: 'positive', text: 'Producto creado.' });
          }}
        />
      ) : null}

      {dialog.type === 'movement' ? (
        <MovementDialog
          item={dialog.item}
          mode={dialog.kind === 'adjustment' ? 'adjustment' : 'movement'}
          initialType={dialog.kind === 'income' ? 'INCOME' : 'CONSUMPTION'}
          role={user?.role}
          onCancel={closeDialog}
          onSessionExpired={handleSessionExpired}
          onSuccess={(_response, kind) => {
            closeDialog();
            setNotice({ tone: 'positive', text: MOVEMENT_SUCCESS_TEXT[kind] });
          }}
        />
      ) : null}

      {dialog.type === 'detail' ? (
        <StockDetailDialog
          item={dialog.item}
          onCancel={closeDialog}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}
    </StockPage>
  );
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((entry) => entry.id));
  return [...current, ...incoming.filter((entry) => !seen.has(entry.id))];
}
