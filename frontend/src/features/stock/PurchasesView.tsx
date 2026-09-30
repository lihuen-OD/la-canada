import { useCallback, useId, useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { fetchStockCategories, fetchStockItems, updateStockItem } from '../../api/stockApi';
import { useSessionScope } from '../../api/useSessionScope';
import type {
  ListStockItemsParams,
  StockItem,
  StockItemsListResponse,
  UpdateStockItemRequest,
} from '../../api/stockTypes';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { CheckCircleIcon } from '../../components/ui/icons';
import { ItemFormDialog } from './ItemFormDialog';
import { MovementDialog } from './MovementDialog';
import { StockDetailDialog } from './StockDetailDialog';
import { StockNotice, type Notice } from './StockNotice';
import { StockPage } from './StockPage';
import { useDebouncedSearch, useSessionExpiry } from './stockHooks';
import {
  AREA_EMOJI,
  AREA_LABEL,
  COMPLETE_TARGET_TEXT,
  LEVEL_LABEL,
  LEVEL_TONE,
  MOVEMENT_SUCCESS_TEXT,
  TARGET_PENDING_TEXT,
} from './stockLabels';
import { useStockCache } from './useStockCache';
import { usePurchaseFilters, type AreaFilter } from './stockViewState';

type PurchaseGrouping = 'status' | 'category';

type DialogState =
  | { type: 'none' }
  | { type: 'income'; item: StockItem }
  | { type: 'detail'; item: StockItem }
  | { type: 'edit'; item: StockItem };

const PAGE_SIZE = 50;
const AREA_FILTERS: readonly { value: AreaFilter; label: string; emoji?: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'HOUSE', label: AREA_LABEL.HOUSE, emoji: AREA_EMOJI.HOUSE },
  { value: 'GARDEN', label: AREA_LABEL.GARDEN, emoji: AREA_EMOJI.GARDEN },
];
/** Encabezado de grupo del prototipo (`🔴 Crítico`), siempre junto al texto. */
const CRITICAL_SECTION = { emoji: '🔴', title: 'Críticos' };

/**
 * 🛒 Compras — vista DERIVADA del inventario (docs/BUSINESS_RULES.md §8):
 * SOLO productos activos CRÍTICOS según el backend (actual ≤ mínimo). Sin
 * tabla, estado "comprado" ni alertas persistidas. Una consulta paginada
 * (`GET /stock/items?stockLevel=critical&sort=name`), ordenada por nombre sin
 * ordenar nada en el navegador. La cantidad sugerida (objetivo − actual) es
 * `item.suggestedPurchaseQuantity` del backend: una sugerencia que no
 * registra compras ni mueve stock. Las claves pertenecen a la familia
 * `stock.items`: registrar un ingreso o cambiar mínimo/objetivo invalida la
 * lista, y un producto que salió de crítico desaparece solo.
 */
export function PurchasesView() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const { afterItemChange } = useStockCache();
  const [filters, updateFilters] = usePurchaseFilters();
  const commitSearch = useCallback((q: string) => updateFilters({ q }), [updateFilters]);
  const [searchInput, setSearchInput] = useDebouncedSearch(filters.q, commitSearch);
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const [notice, setNotice] = useState<Notice>(null);
  const [grouping, setGrouping] = useState<PurchaseGrouping>('status');
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const searchId = useId();
  const categoryFieldId = useId();

  const categoryStatus = isAdmin ? 'all' : 'active';
  const categoriesQuery = useQuery({
    queryKey: queryKeys.stock.categories(userId, categoryStatus),
    queryFn: () => fetchStockCategories(categoryStatus),
    enabled,
    staleTime: STALE_TIME.catalog,
  });

  const baseFilters: Omit<ListStockItemsParams, 'page' | 'pageSize' | 'stockLevel'> = {
    status: 'active',
    sort: 'name',
    area: filters.area === 'all' ? undefined : filters.area,
    categoryId: filters.categoryId || undefined,
    q: filters.q || undefined,
  };
  const critical = useCriticalPurchases(baseFilters, enabled);

  const handleSessionExpired = useSessionExpiry(critical.query.error, categoriesQuery.error);

  const loaded = Boolean(critical.pages);
  const failed = !critical.pages && critical.query.isError;
  const refreshing = loaded && critical.query.isFetching && !critical.query.isFetchingNextPage;
  const totalPending = critical.total;
  const visibleItems = critical.items;
  const groups = groupPurchases(visibleItems, grouping);
  const hasFilters = filters.area !== 'all' || Boolean(filters.categoryId) || Boolean(filters.q);

  const retry = () => {
    void critical.query.refetch();
  };
  const closeDialog = () => setDialog({ type: 'none' });
  const sharePurchases = async () => {
    if (visibleItems.length === 0) {
      setShareNotice('No hay productos visibles para compartir.');
      return;
    }
    const text = purchaseShareText(visibleItems, grouping);
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Lista de compras — La Cañada', text });
        setShareNotice('Lista compartida.');
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setShareNotice('Lista copiada al portapapeles.');
      } else {
        setShareNotice('Este navegador no permite compartir ni copiar la lista.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setShareNotice('No pudimos compartir la lista.');
    }
  };

  const categories = categoriesQuery.data?.categories ?? [];
  const visibleCategories =
    filters.area === 'all'
      ? categories
      : categories.filter((category) => category.area === filters.area || category.area === 'BOTH');

  return (
    <StockPage refreshing={refreshing}>
      <StockNotice notice={notice} />

      <div className="stock-purchases__toolbar">
        <p className="stock-purchases__explain">
          Ítems activos en stock crítico (en su mínimo o por debajo). «Comprar» sugiere cuánto falta
          para llegar al stock objetivo: no es una orden de compra ni modifica el stock.
        </p>
        <Button size="sm" variant="ghost" disabled={!loaded} onClick={() => void sharePurchases()}>
          <span aria-hidden="true">📤 </span>Compartir
        </Button>
      </div>

      <div className="stock-filters">
        <div className="filter-scroller" role="group" aria-label="Filtrar por área">
          {AREA_FILTERS.map((option) => (
            <Chip
              key={option.value}
              selected={filters.area === option.value}
              onSelect={() => updateFilters({ area: option.value, categoryId: '' })}
              leading={option.emoji ? <span aria-hidden="true">{option.emoji}</span> : undefined}
            >
              {option.label}
            </Chip>
          ))}
        </div>
        <div className="stock-filters__row">
          <div className="field stock-filters__field">
            <label className="field__label" htmlFor={searchId}>
              Buscar producto
            </label>
            <input
              id={searchId}
              className="field__input"
              type="search"
              autoComplete="off"
              placeholder="Nombre del producto…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
          <div className="field stock-filters__field">
            <label className="field__label" htmlFor={categoryFieldId}>
              Categoría
            </label>
            <select
              id={categoryFieldId}
              className="field__input"
              value={filters.categoryId}
              onChange={(event) => updateFilters({ categoryId: event.target.value })}
            >
              <option value="">Todas</option>
              {visibleCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                  {filters.area === 'all' ? ` (${AREA_LABEL[category.area]})` : ''}
                  {!category.active ? ' (inactiva)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="filter-scroller" role="group" aria-label="Agrupar compras">
        <Chip selected={grouping === 'status'} onSelect={() => setGrouping('status')}>
          Por estado
        </Chip>
        <Chip selected={grouping === 'category'} onSelect={() => setGrouping('category')}>
          Por categoría
        </Chip>
      </div>
      <p className="stock__notice" role="status" aria-live="polite">
        {shareNotice}
      </p>

      {!loaded ? (
        <Card>
          {failed ? (
            <ErrorState title="No pudimos cargar la lista de compras." onRetry={retry} />
          ) : (
            <LoadingState label="Cargando compras…" />
          )}
        </Card>
      ) : totalPending === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircleIcon size="xl" />}
            title={hasFilters ? 'Nada pendiente con estos filtros.' : 'No hay compras pendientes.'}
            description={
              hasFilters
                ? 'Probá con otra área, categoría o búsqueda.'
                : 'Ningún producto activo está en su stock mínimo o por debajo.'
            }
          />
        </Card>
      ) : (
        <>
          <p className="stock__count" role="status">
            {totalPending} {totalPending === 1 ? 'producto por reponer' : 'productos por reponer'}
          </p>
          {groups.map((group) =>
            group.items.length === 0 ? null : (
              <Card
                key={group.key}
                title={
                  <>
                    {group.emoji ? <span aria-hidden="true">{group.emoji}</span> : null}
                    {`${group.title} (${group.items.length})`}
                  </>
                }
              >
                <ul className="stock-purchases__list" role="list" aria-label={group.title}>
                  {group.items.map((item) => (
                    <PurchaseRow
                      key={item.id}
                      item={item}
                      isAdmin={isAdmin}
                      onIncome={() => setDialog({ type: 'income', item })}
                      onDetail={() => setDialog({ type: 'detail', item })}
                      onEdit={() => setDialog({ type: 'edit', item })}
                    />
                  ))}
                </ul>
              </Card>
            ),
          )}
          {critical.hasMore ? (
            <div className="stock__more">
              <Button
                variant="secondary"
                disabled={critical.query.isFetchingNextPage}
                onClick={critical.loadMore}
              >
                {critical.query.isFetchingNextPage
                  ? 'Cargando…'
                  : `Cargar más (${critical.items.length} de ${critical.total})`}
              </Button>
            </div>
          ) : null}
        </>
      )}

      {dialog.type === 'income' ? (
        <MovementDialog
          item={dialog.item}
          mode="movement"
          initialType="INCOME"
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
      {dialog.type === 'edit' && isAdmin ? (
        <ItemFormDialog
          item={dialog.item}
          categories={categories}
          onCancel={closeDialog}
          onSessionExpired={handleSessionExpired}
          onSubmit={async (body) => {
            await updateStockItem(dialog.item.id, body as UpdateStockItemRequest);
            afterItemChange();
            closeDialog();
            setNotice({ tone: 'positive', text: 'Producto actualizado.' });
          }}
        />
      ) : null}
    </StockPage>
  );
}

function groupPurchases(items: StockItem[], grouping: PurchaseGrouping) {
  if (grouping === 'status') {
    return [
      {
        key: 'critical',
        emoji: CRITICAL_SECTION.emoji,
        title: CRITICAL_SECTION.title,
        items: items.filter((item) => item.stockLevel === 'critical'),
      },
    ];
  }
  const byCategory = new Map<
    string,
    { key: string; emoji?: string; title: string; items: StockItem[] }
  >();
  for (const item of items) {
    const key = `${item.area}:${item.category.id}`;
    const title = `${AREA_LABEL[item.area]} — ${item.category.name}`;
    const group = byCategory.get(key) ?? { key, title, items: [] };
    group.items.push(item);
    byCategory.set(key, group);
  }
  return [...byCategory.values()].sort((a, b) => a.title.localeCompare(b.title, 'es'));
}

function purchaseShareText(items: StockItem[], grouping: PurchaseGrouping): string {
  const lines = ['🛒 Lista de compras — La Cañada'];
  for (const group of groupPurchases(items, grouping)) {
    if (group.items.length === 0) continue;
    lines.push('', group.title);
    for (const item of group.items) {
      const target =
        item.targetQuantity !== null
          ? `objetivo: ${item.targetQuantity} ${item.unit}`
          : TARGET_PENDING_TEXT.toLowerCase();
      lines.push(
        `• ${item.name} — ${purchaseText(item)} (actual: ${item.currentQuantity} ${item.unit}; mínimo: ${item.minimumQuantity} ${item.unit}; ${target})`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * «Comprar: 31 kg» — la cantidad sugerida del backend con su unidad, o
 * «Completar stock objetivo» si el producto todavía no lo tiene (nunca se
 * inventa una cantidad).
 */
function purchaseText(item: StockItem): string {
  return item.suggestedPurchaseQuantity !== null
    ? `comprar: ${item.suggestedPurchaseQuantity} ${item.unit}`
    : COMPLETE_TARGET_TEXT;
}

/** Una consulta paginada de productos activos CRÍTICOS, ordenada por nombre. */
function useCriticalPurchases(
  baseFilters: Omit<ListStockItemsParams, 'page' | 'pageSize' | 'stockLevel'>,
  enabled: boolean,
) {
  const { userId } = useSessionScope();
  const filters = { ...baseFilters, stockLevel: 'critical' as const };
  const query = useInfiniteQuery({
    queryKey: queryKeys.stock.items(userId, filters),
    queryFn: ({ pageParam }) =>
      fetchStockItems({ ...filters, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last: StockItemsListResponse) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    enabled,
    placeholderData: keepPreviousData,
  });
  const pages = query.data?.pages;
  const items = useMemo(() => {
    if (!pages) return [];
    const seen = new Set<string>();
    return pages.flatMap((page) =>
      page.items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true))),
    );
  }, [pages]);
  const last = pages?.[pages.length - 1];
  const loadMore = () => {
    if (query.isFetchingNextPage || !query.hasNextPage) return;
    void query.fetchNextPage({ cancelRefetch: false });
  };
  return {
    query,
    pages,
    items,
    total: last?.total ?? 0,
    hasMore: Boolean(last && last.page < last.totalPages),
    loadMore,
  };
}

interface PurchaseRowProps {
  item: StockItem;
  isAdmin: boolean;
  onIncome: () => void;
  onDetail: () => void;
  onEdit: () => void;
}

function PurchaseRow({ item, isAdmin, onIncome, onDetail, onEdit }: PurchaseRowProps) {
  // El backend es la autoridad del nivel y de la cantidad sugerida; una fila
  // no crítica solo podría llegar por una revalidación en curso.
  const level = item.stockLevel;
  const hasTarget = item.targetQuantity !== null;
  return (
    <li className="stock-purchase">
      <div className="stock-purchase__info">
        <p className="stock-item__name">{item.name}</p>
        <p className="stock-purchase__meta">
          <span className={`area-tag area-tag--${item.area.toLowerCase()}`}>
            {AREA_LABEL[item.area]}
          </span>
          <span>{item.category.name}</span>
          <Badge tone={LEVEL_TONE[level]}>{LEVEL_LABEL[level]}</Badge>
          {level === 'critical' ? <span className="visually-hidden">Prioridad alta</span> : null}
        </p>
        <p className="stock-purchase__numbers">
          <span>
            <span className="visually-hidden">Actual: </span>
            {item.currentQuantity}
            {hasTarget ? (
              <>
                <span aria-hidden="true"> / </span>
                <span className="visually-hidden">, objetivo: </span>
                {item.targetQuantity}
              </>
            ) : null}{' '}
            {item.unit}
            <span aria-hidden="true"> · </span>
            <span className="visually-hidden">, </span>mín. {item.minimumQuantity}
          </span>
          <span className="stock-purchase__shortfall">
            {item.suggestedPurchaseQuantity !== null
              ? `Comprar: ${item.suggestedPurchaseQuantity} ${item.unit}`
              : COMPLETE_TARGET_TEXT}
          </span>
        </p>
      </div>
      <div className="stock-item__actions">
        <Button
          size="sm"
          className="icon-button"
          aria-label={`Registrar entrada: ${item.name}`}
          title="Registrar entrada"
          onClick={onIncome}
        >
          <span aria-hidden="true">📥</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="icon-button"
          aria-label={`Detalle: ${item.name}`}
          title="Detalle"
          onClick={onDetail}
        >
          <span aria-hidden="true">📋</span>
        </Button>
        {isAdmin ? (
          <Button
            size="sm"
            variant="ghost"
            className="icon-button"
            aria-label={`Editar producto: ${item.name}`}
            title="Editar producto"
            onClick={onEdit}
          >
            <span aria-hidden="true">✏️</span>
          </Button>
        ) : null}
      </div>
    </li>
  );
}
