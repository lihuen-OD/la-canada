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
  StockLevel,
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
  LEVEL_LABEL,
  LEVEL_PRIORITY,
  LEVEL_TONE,
  MOVEMENT_SUCCESS_TEXT,
} from './stockLabels';
import { purchaseShortfall } from './stockStatus';
import { useStockCache } from './useStockCache';
import { usePurchaseFilters, type AreaFilter, type PurchaseLevelFilter } from './stockViewState';

type PurchaseLevel = Exclude<StockLevel, 'ok'>;
type PurchaseGrouping = 'status' | 'category';

type DialogState =
  | { type: 'none' }
  | { type: 'income'; item: StockItem }
  | { type: 'detail'; item: StockItem }
  | { type: 'edit'; item: StockItem };

const PAGE_SIZE = 50;
const LEVEL_FILTERS: readonly { value: PurchaseLevelFilter; label: string; emoji?: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'critical', label: 'Críticos', emoji: '⚠️' },
  { value: 'low', label: 'Bajos' },
];
const AREA_FILTERS: readonly { value: AreaFilter; label: string; emoji?: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'HOUSE', label: AREA_LABEL.HOUSE, emoji: AREA_EMOJI.HOUSE },
  { value: 'GARDEN', label: AREA_LABEL.GARDEN, emoji: AREA_EMOJI.GARDEN },
];
const SECTION_TITLE: Record<PurchaseLevel, string> = {
  critical: 'Críticos',
  low: 'Stock bajo',
};

/**
 * 🛒 Compras — vista DERIVADA del inventario (docs/BUSINESS_RULES.md §8,
 * decisión 5C.1): productos activos con `stockLevel` crítico o bajo según el
 * backend. Sin tabla, estado "comprado" ni alertas persistidas. Una consulta
 * paginada por nivel (`GET /stock/items?stockLevel=…&sort=name`), así el
 * orden es críticos → bajos → nombre sin ordenar nada en el navegador. Las
 * claves pertenecen a la familia `stock.items`: registrar un ingreso
 * invalida la lista y un producto que alcanzó su mínimo desaparece solo.
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
  const critical = usePurchaseLevel('critical', baseFilters, enabled && filters.level !== 'low');
  const low = usePurchaseLevel('low', baseFilters, enabled && filters.level !== 'critical');
  const sections = [
    ...(filters.level !== 'low' ? [{ level: 'critical' as const, state: critical }] : []),
    ...(filters.level !== 'critical' ? [{ level: 'low' as const, state: low }] : []),
  ];

  const handleSessionExpired = useSessionExpiry(
    critical.query.error,
    low.query.error,
    categoriesQuery.error,
  );

  const loaded = sections.every((section) => section.state.pages);
  const failed = sections.some((section) => !section.state.pages && section.state.query.isError);
  const refreshing =
    loaded &&
    sections.some(
      (section) => section.state.query.isFetching && !section.state.query.isFetchingNextPage,
    );
  const totalPending = sections.reduce((sum, section) => sum + section.state.total, 0);
  const visibleItems = (() => {
    const seen = new Set<string>();
    return sections.flatMap((section) =>
      section.state.items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true))),
    );
  })();
  const groups = groupPurchases(visibleItems, grouping);
  const hasFilters = filters.area !== 'all' || Boolean(filters.categoryId) || Boolean(filters.q);

  const retry = () => {
    for (const section of sections) void section.state.query.refetch();
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
    <StockPage
      description="Lista de compras derivada del stock mínimo de Casa y Jardín."
      refreshing={refreshing}
    >
      <StockNotice notice={notice} />

      <p className="stock-purchases__explain">
        Aparecen los productos activos en nivel crítico o bajo según su stock mínimo. «Para llegar
        al mínimo» es solo una referencia: no es una orden de compra ni modifica el stock.
      </p>

      <div className="stock-filters">
        <div className="filter-scroller" role="group" aria-label="Filtrar por nivel">
          {LEVEL_FILTERS.map((option) => (
            <Chip
              key={option.value}
              selected={filters.level === option.value}
              onSelect={() => updateFilters({ level: option.value })}
              leading={option.emoji ? <span aria-hidden="true">{option.emoji}</span> : undefined}
            >
              {option.label}
            </Chip>
          ))}
        </div>
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

      <div className="stock-purchases__toolbar">
        <div className="filter-scroller" role="group" aria-label="Agrupar compras">
          <Chip selected={grouping === 'status'} onSelect={() => setGrouping('status')}>
            Por estado
          </Chip>
          <Chip selected={grouping === 'category'} onSelect={() => setGrouping('category')}>
            Por categoría
          </Chip>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!loaded}
          onClick={() => void sharePurchases()}
        >
          <span aria-hidden="true">📤 </span>Compartir
        </Button>
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
                : 'Todos los productos activos están en su stock mínimo o por encima.'
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
              <Card key={group.key} title={`${group.title} (${group.items.length})`}>
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
          {sections.map(({ level, state }) =>
            state.hasMore ? (
              <div className="stock__more" key={`more-${level}`}>
                <Button
                  variant="secondary"
                  disabled={state.query.isFetchingNextPage}
                  onClick={state.loadMore}
                >
                  {state.query.isFetchingNextPage
                    ? 'Cargando…'
                    : `Cargar más ${SECTION_TITLE[level].toLowerCase()} (${state.items.length} de ${state.total})`}
                </Button>
              </div>
            ) : null,
          )}
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
    return (['critical', 'low'] as const).map((level) => ({
      key: level,
      title: SECTION_TITLE[level],
      items: items.filter((item) => item.stockLevel === level),
    }));
  }
  const byCategory = new Map<string, { key: string; title: string; items: StockItem[] }>();
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
      const missing = purchaseShortfall(item.currentQuantity, item.minimumQuantity) ?? '0';
      lines.push(
        `• ${item.name} — actual: ${item.currentQuantity} ${item.unit}; mínimo: ${item.minimumQuantity} ${item.unit}; falta: ${missing} ${item.unit}`,
      );
    }
  }
  return lines.join('\n');
}

/** Una consulta paginada de productos activos en `level`, ordenada por nombre. */
function usePurchaseLevel(
  level: PurchaseLevel,
  baseFilters: Omit<ListStockItemsParams, 'page' | 'pageSize' | 'stockLevel'>,
  enabled: boolean,
) {
  const { userId } = useSessionScope();
  const filters = { ...baseFilters, stockLevel: level };
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
  // El backend es la autoridad del nivel; una fila `ok` solo podría llegar
  // por una revalidación en curso y se muestra igual, sin prioridad.
  const level = item.stockLevel;
  const shortfall = purchaseShortfall(item.currentQuantity, item.minimumQuantity);
  return (
    <li className="stock-purchase">
      <div className="stock-purchase__main">
        <div className="stock-item__text">
          <p className="stock-item__name">{item.name}</p>
          <p className="stock-item__meta">
            {level !== 'ok' ? <span aria-hidden="true">⚠️ </span> : null}
            <Badge tone={LEVEL_TONE[level]}>{LEVEL_LABEL[level]}</Badge>
            {level !== 'ok' ? <span>{LEVEL_PRIORITY[level]}</span> : null}
          </p>
          <p className="stock-item__meta">
            <span>
              <span aria-hidden="true">{AREA_EMOJI[item.area]} </span>
              {AREA_LABEL[item.area]}
            </span>
            <span>· {item.category.name}</span>
          </p>
        </div>
        <dl className="stock-purchase__numbers">
          <div>
            <dt>Actual</dt>
            <dd>
              {item.currentQuantity} {item.unit}
            </dd>
          </div>
          <div>
            <dt>Mínimo</dt>
            <dd>
              {item.minimumQuantity} {item.unit}
            </dd>
          </div>
          <div className="stock-purchase__shortfall">
            <dt>Para llegar al mínimo</dt>
            <dd>{shortfall !== null ? `${shortfall} ${item.unit}` : '—'}</dd>
          </div>
        </dl>
      </div>
      <div className="stock-item__actions">
        <Button size="sm" variant="secondary" onClick={onIncome}>
          <span aria-hidden="true">➕ </span>Registrar entrada
          <span className="visually-hidden">: {item.name}</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={onDetail}>
          <span aria-hidden="true">📋 </span>Detalle
          <span className="visually-hidden">: {item.name}</span>
        </Button>
        {isAdmin ? (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <span aria-hidden="true">✏️ </span>Editar producto
            <span className="visually-hidden">: {item.name}</span>
          </Button>
        ) : null}
      </div>
    </li>
  );
}
