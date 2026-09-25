import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { createStockMovement, fetchStockCategories, fetchStockItems } from '../../api/stockApi';
import { useSessionScope } from '../../api/useSessionScope';
import type {
  CreateStockMovementRequest,
  StockCategoriesResponse,
  StockItemsListResponse,
  StockItem,
  StockItemArea,
  StockStatusFilter,
} from '../../api/stockTypes';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon, CheckCircleIcon } from '../../components/ui/icons';
import { MovementDialog } from './MovementDialog';
import type { MovementKind } from './MovementDialog';
import { StockCatalog } from './StockCatalog';
import { StockDetailDialog } from './StockDetailDialog';
import { StockFilters } from './StockFilters';
import { StockItemCard } from './StockItemCard';
import { errorMessageOf, isSessionExpired, isStockConflict } from './stockErrors';
import { AREA_EMOJI, AREA_LABEL, groupItemsByCategory } from './stockLabels';

type InventoryLoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; data: StockItemsListResponse; categories: StockCategoriesResponse };

type CatalogSection = 'inventory' | 'catalog';

type DialogState =
  | { type: 'none' }
  | { type: 'movement'; item: StockItem; kind: MovementKind }
  | { type: 'detail'; item: StockItem };

type Notice = { tone: 'positive' | 'danger'; text: string } | null;

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 350;

interface Filters {
  area: StockItemArea;
  categoryId: string;
  status: StockStatusFilter;
  q: string;
}

/**
 * 📦 Stock — pantalla operativa real (Etapa 5B). TODA la consulta es
 * server-side: `q`, `area`, `categoryId` y `status` viajan como query de
 * `GET /stock/items`; nada se filtra sobre una página ya cargada. La
 * paginación usa `page`/`pageSize`/`total` con «Cargar más» (acumula
 * páginas en el cliente sin reemplazar lo ya mostrado). Sin actualizaciones
 * optimistas: cada mutación espera la respuesta y luego recarga. El backend
 * es la autoridad de permisos y saldos; la pantalla solo oculta acciones
 * que un EMPLOYEE no puede hacer (ajuste, catálogo, filtro de estado).
 */
export function StockScreen() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const queryClient = useQueryClient();

  const [section, setSection] = useState<CatalogSection>('inventory');
  const [filters, setFilters] = useState<Filters>({
    area: 'HOUSE',
    categoryId: '',
    status: 'active',
    q: '',
  });
  const [searchInput, setSearchInput] = useState('');
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const [notice, setNotice] = useState<Notice>(null);
  /** Solo para el catálogo administrativo y el detalle, que cargan por su cuenta. */
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSessionExpired = useCallback(() => {
    void logout();
  }, [logout]);

  /** Cambio de filtro desde la UI: vuelve a página 1 (otra clave de caché). */
  const applyFilters = useCallback((updater: (previous: Filters) => Filters) => {
    setFilters(updater);
  }, []);

  // Debounce de la búsqueda: el input responde al instante, el request no.
  useEffect(() => {
    const next = searchInput.trim();
    if (next === filters.q) return;
    const timer = window.setTimeout(() => {
      setFilters((previous) => ({ ...previous, q: next }));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput, filters.q]);

  const statusParam: StockStatusFilter = isAdmin ? filters.status : 'active';
  const itemFilters = {
    q: filters.q || undefined,
    area: filters.area,
    categoryId: filters.categoryId || undefined,
    status: statusParam,
  };
  const inventoryEnabled = enabled && section === 'inventory';

  /**
   * Inventario paginado en el servidor (Etapa 5P): una entrada de caché por
   * combinación de filtros. Cambiar de filtro conserva la lista anterior
   * visible hasta que llega la nueva; una respuesta vieja nunca puede pisar
   * un filtro nuevo porque cada una se guarda bajo su propia clave.
   */
  const itemsQuery = useInfiniteQuery({
    queryKey: queryKeys.stock.items(userId, itemFilters),
    queryFn: ({ pageParam }) =>
      fetchStockItems({ ...itemFilters, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last: StockItemsListResponse) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    enabled: inventoryEnabled,
    placeholderData: keepPreviousData,
  });
  const categoriesQuery = useQuery({
    queryKey: queryKeys.stock.categories(userId, isAdmin ? 'all' : 'active'),
    queryFn: () => fetchStockCategories(isAdmin ? 'all' : 'active'),
    enabled: inventoryEnabled,
    staleTime: STALE_TIME.catalog,
  });

  const sessionExpired =
    isSessionExpired(itemsQuery.error) || isSessionExpired(categoriesQuery.error);
  useEffect(() => {
    if (sessionExpired) handleSessionExpired();
  }, [sessionExpired, handleSessionExpired]);

  const state: InventoryLoadState = useMemo(() => {
    const pages = itemsQuery.data?.pages;
    if (pages && pages.length > 0 && categoriesQuery.data) {
      const last = pages[pages.length - 1]!;
      return {
        status: 'loaded',
        data: {
          ...last,
          items: pages.reduce<StockItem[]>((all, page) => mergeById(all, page.items), []),
        },
        categories: categoriesQuery.data,
      };
    }
    if (itemsQuery.isError || categoriesQuery.isError) return { status: 'error' };
    return { status: 'loading' };
  }, [itemsQuery.data, itemsQuery.isError, categoriesQuery.data, categoriesQuery.isError]);

  const loadingMore = itemsQuery.isFetchingNextPage;
  const refreshing =
    state.status === 'loaded' &&
    ((itemsQuery.isFetching && !loadingMore) || categoriesQuery.isFetching);
  const staleAfterError =
    state.status === 'loaded' && !loadingMore && itemsQuery.isError && !itemsQuery.isFetching;

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

  const closeDialog = useCallback(() => setDialog({ type: 'none' }), []);

  /**
   * Invalidación selectiva tras un movimiento: listados de productos (todas
   * las combinaciones de filtro, porque el saldo cambia en todas) y el
   * historial de productos. Categorías y destinos no cambian.
   */
  const invalidateAfterMovement = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.stock.itemsAll(userId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.stock.movementsAll(userId) });
    setRefreshKey((key) => key + 1);
  }, [queryClient, userId]);

  const afterSuccess = useCallback(
    (text: string) => {
      closeDialog();
      setNotice({ tone: 'positive', text });
      invalidateAfterMovement();
    },
    [closeDialog, invalidateAfterMovement],
  );

  /**
   * Conflictos dentro de un diálogo fuerzan una recarga y siempre se
   * relanzan para que el propio diálogo muestre el mensaje. El 401 también
   * se relanza intacto: el diálogo llama una sola vez a `onSessionExpired`.
   */
  const rethrowForDialog = useCallback(
    (error: unknown): never => {
      if (isStockConflict(error)) invalidateAfterMovement();
      throw error;
    },
    [invalidateAfterMovement],
  );

  const retry = useCallback(() => {
    void itemsQuery.refetch();
    void categoriesQuery.refetch();
  }, [itemsQuery, categoriesQuery]);

  const groups = useMemo(() => {
    if (state.status !== 'loaded') return [];
    return groupItemsByCategory(state.data.items);
  }, [state]);

  const header = (
    <PageHeader
      title={
        <>
          <span aria-hidden="true">📦 </span>Stock
        </>
      }
      description="Inventario de Casa y Jardín: cantidades, mínimos y movimientos del backend."
      refreshing={section === 'inventory' ? refreshing : undefined}
    />
  );

  const subnav = (
    <nav className="stock-subnav" aria-label="Secciones de Stock">
      <button
        type="button"
        className={section === 'inventory' ? 'active' : undefined}
        aria-current={section === 'inventory' ? 'page' : undefined}
        onClick={() => setSection('inventory')}
      >
        Inventario
      </button>
      {isAdmin ? (
        <button
          type="button"
          className={section === 'catalog' ? 'active' : undefined}
          aria-current={section === 'catalog' ? 'page' : undefined}
          onClick={() => setSection('catalog')}
        >
          <span aria-hidden="true">⚙️ </span>Catálogo
        </button>
      ) : null}
    </nav>
  );

  const noticeBlock = (
    <div aria-live="polite" className="stock__notice">
      {staleAfterError ? (
        <p role="alert" className="notice notice--danger">
          <AlertIcon size="sm" />
          No pudimos actualizar el inventario. Mostramos los últimos datos.
          <Button size="sm" variant="ghost" onClick={retry}>
            Reintentar
          </Button>
        </p>
      ) : null}
      {notice ? (
        <p
          role={notice.tone === 'danger' ? 'alert' : 'status'}
          className={`notice notice--${notice.tone}`}
        >
          {notice.tone === 'danger' ? <AlertIcon size="sm" /> : <CheckCircleIcon size="sm" />}
          {notice.text}
        </p>
      ) : null}
    </div>
  );

  if (section === 'catalog' && isAdmin) {
    return (
      <div className="stock">
        {header}
        {subnav}
        {noticeBlock}
        <StockCatalog refreshKey={refreshKey} onSessionExpired={handleSessionExpired} />
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="stock">
        {header}
        {subnav}
        <Card>
          <LoadingState label="Cargando inventario…" />
        </Card>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="stock">
        {header}
        {subnav}
        <Card>
          <ErrorState title="No pudimos cargar el inventario." onRetry={retry} />
        </Card>
      </div>
    );
  }

  const { data, categories } = state;
  const hasMore = data.page < data.totalPages;

  return (
    <div className="stock">
      {header}
      {subnav}
      {noticeBlock}

      <StockFilters
        area={filters.area}
        onAreaChange={(area) => applyFilters((previous) => ({ ...previous, area }))}
        categories={categories.categories}
        categoryId={filters.categoryId}
        onCategoryIdChange={(categoryId) =>
          applyFilters((previous) => ({ ...previous, categoryId }))
        }
        status={filters.status}
        onStatusChange={(status) => applyFilters((previous) => ({ ...previous, status }))}
        isAdmin={isAdmin}
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
      />

      <div className="stock__area-heading">
        <p className="stock__area-label">
          <span aria-hidden="true">{AREA_EMOJI[filters.area]} </span>
          {AREA_LABEL[filters.area]}
        </p>
        <p className="stock__count" role="status">
          {data.total} {data.total === 1 ? 'producto' : 'productos'}
        </p>
      </div>

      <Card className={itemsQuery.isPlaceholderData ? 'is-stale' : undefined}>
        {data.items.length === 0 ? (
          <EmptyState
            title="No hay productos con estos filtros."
            description="Probá con otra área, categoría o búsqueda."
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
                  <h2 className="stock-group__title">{group.category.name}</h2>
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
            {hasMore ? (
              <div className="stock__more">
                <Button variant="secondary" disabled={loadingMore} onClick={loadMore}>
                  {loadingMore ? 'Cargando…' : `Cargar más (${data.items.length} de ${data.total})`}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Card>

      {dialog.type === 'movement' ? (
        <MovementDialog
          item={dialog.item}
          kind={dialog.kind}
          role={user?.role}
          onCancel={closeDialog}
          onSessionExpired={handleSessionExpired}
          onConfirm={async (body: CreateStockMovementRequest) => {
            await createStockMovement(dialog.item.id, body).catch(rethrowForDialog);
            const labels: Record<MovementKind, string> = {
              income: 'Ingreso registrado.',
              consumption: 'Consumo registrado.',
              adjustment: 'Ajuste registrado.',
            };
            afterSuccess(labels[dialog.kind]);
          }}
        />
      ) : null}

      {dialog.type === 'detail' ? (
        <StockDetailDialog
          item={dialog.item}
          refreshKey={refreshKey}
          onCancel={closeDialog}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}
    </div>
  );
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((entry) => entry.id));
  return [...current, ...incoming.filter((entry) => !seen.has(entry.id))];
}
