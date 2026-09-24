import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createStockMovement, fetchStockCategories, fetchStockItems } from '../../api/stockApi';
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

  const [section, setSection] = useState<CatalogSection>('inventory');
  const [filters, setFilters] = useState<Filters>({
    area: 'HOUSE',
    categoryId: '',
    status: 'active',
    q: '',
  });
  const [searchInput, setSearchInput] = useState('');
  const [state, setState] = useState<InventoryLoadState>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const [notice, setNotice] = useState<Notice>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const loadIdRef = useRef(0);
  const loadMoreGuardRef = useRef(false);

  const handleSessionExpired = useCallback(() => {
    void logout();
  }, [logout]);

  /** Cambio de filtro desde la UI: resetea a página 1 y muestra carga. */
  const applyFilters = useCallback((updater: (previous: Filters) => Filters) => {
    // Invalida inmediatamente cualquier página adicional en vuelo, antes
    // de que el effect del filtro nuevo llegue a ejecutarse.
    loadIdRef.current += 1;
    loadMoreGuardRef.current = false;
    setLoadingMore(false);
    setState({ status: 'loading' });
    setFilters(updater);
  }, []);

  // Debounce de la búsqueda: el input responde al instante, el request no.
  useEffect(() => {
    const next = searchInput.trim();
    if (next === filters.q) return;
    const timer = window.setTimeout(() => {
      loadIdRef.current += 1;
      loadMoreGuardRef.current = false;
      setLoadingMore(false);
      setState({ status: 'loading' });
      setFilters((previous) => ({ ...previous, q: next }));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput, filters.q]);

  // Carga según filtros/refresh — sin setState síncrono: el estado de
  // carga lo ponen los handlers de filtro/reintento; acá solo se dispara.
  useEffect(() => {
    if (section !== 'inventory') return;
    const loadId = ++loadIdRef.current;

    const statusParam: StockStatusFilter = isAdmin ? filters.status : 'active';
    Promise.all([
      fetchStockItems({
        q: filters.q || undefined,
        area: filters.area,
        categoryId: filters.categoryId || undefined,
        status: statusParam,
        page: 1,
        pageSize: PAGE_SIZE,
      }),
      fetchStockCategories(isAdmin ? 'all' : 'active'),
    ])
      .then(([itemsResponse, categoriesResponse]) => {
        if (loadId !== loadIdRef.current) return;
        setState({
          status: 'loaded',
          data: itemsResponse,
          categories: categoriesResponse,
        });
      })
      .catch((error: unknown) => {
        if (loadId !== loadIdRef.current) return;
        if (isSessionExpired(error)) {
          handleSessionExpired();
          return;
        }
        setState({ status: 'error' });
      });

    return () => {
      if (loadId === loadIdRef.current) loadIdRef.current += 1;
    };
  }, [section, filters, isAdmin, refreshKey, handleSessionExpired]);

  const loadMore = useCallback(() => {
    if (state.status !== 'loaded' || loadMoreGuardRef.current) return;
    loadMoreGuardRef.current = true;
    const loadId = loadIdRef.current;
    const next = state.data.page + 1;
    setLoadingMore(true);
    const statusParam: StockStatusFilter = isAdmin ? filters.status : 'active';
    fetchStockItems({
      q: filters.q || undefined,
      area: filters.area,
      categoryId: filters.categoryId || undefined,
      status: statusParam,
      page: next,
      pageSize: PAGE_SIZE,
    })
      .then((response) => {
        if (loadId !== loadIdRef.current) return;
        setState((previous) => {
          if (previous.status !== 'loaded') return previous;
          return {
            ...previous,
            data: {
              ...response,
              items: mergeById(previous.data.items, response.items),
            },
          };
        });
      })
      .catch((error: unknown) => {
        if (loadId !== loadIdRef.current) return;
        if (isSessionExpired(error)) {
          handleSessionExpired();
          return;
        }
        setNotice({ tone: 'danger', text: errorMessageOf(error) });
      })
      .finally(() => {
        if (loadId !== loadIdRef.current) return;
        loadMoreGuardRef.current = false;
        setLoadingMore(false);
      });
  }, [state, filters, isAdmin, handleSessionExpired]);

  const closeDialog = useCallback(() => setDialog({ type: 'none' }), []);

  const afterSuccess = useCallback(
    (text: string) => {
      closeDialog();
      setNotice({ tone: 'positive', text });
      setRefreshKey((key) => key + 1);
    },
    [closeDialog],
  );

  /**
   * Conflictos dentro de un diálogo fuerzan una recarga y siempre se
   * relanzan para que el propio diálogo muestre el mensaje. El 401 también
   * se relanza intacto: el diálogo llama una sola vez a `onSessionExpired`.
   */
  const rethrowForDialog = useCallback((error: unknown): never => {
    if (isStockConflict(error)) setRefreshKey((key) => key + 1);
    throw error;
  }, []);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setRefreshKey((key) => key + 1);
  }, []);

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

      <Card>
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
