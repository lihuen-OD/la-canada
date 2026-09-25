import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import {
  fetchStockCategories,
  fetchStockDestinations,
  fetchStockItems,
  fetchStockReportMovements,
  fetchStockReportCsv,
  fetchStockReportSummary,
} from '../../api/stockApi';
import { fetchTaskEmployees } from '../../api/tasksApi';
import { useSessionScope } from '../../api/useSessionScope';
import type {
  StockMovementType,
  StockQuantityByUnit,
  StockReportFilters,
  StockReportMovement,
  StockReportMovementsResponse,
  StockReportProduct,
  StockReportSummary,
} from '../../api/stockTypes';
import { useAuth } from '../../auth/useAuth';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { StockPage } from './StockPage';
import { useSessionExpiry } from './stockHooks';
import {
  AREA_EMOJI,
  AREA_LABEL,
  DESTINATION_TYPE_LABEL,
  MOVEMENT_FILTER_ORDER,
  MOVEMENT_LABEL,
  MOVEMENT_PLURAL,
  formatStockDay,
} from './stockLabels';
import { movementSignedPrefix } from './stockStatus';
import {
  useReportFilters,
  type AreaFilter,
  type ReportFilterState,
  type ReportPeriod,
} from './stockViewState';

const PERIODS: readonly { value: ReportPeriod; label: string }[] = [
  { value: '7', label: '7 días' },
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
  { value: '365', label: '365 días' },
  { value: 'custom', label: 'Personalizado' },
];
const AREA_FILTERS: readonly { value: AreaFilter; label: string; emoji?: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'HOUSE', label: AREA_LABEL.HOUSE, emoji: AREA_EMOJI.HOUSE },
  { value: 'GARDEN', label: AREA_LABEL.GARDEN, emoji: AREA_EMOJI.GARDEN },
];
const MOVEMENTS_PAGE_SIZE = 20;
/** Opciones del filtro de producto: una página grande del catálogo, ordenada por nombre. */
const PRODUCT_OPTIONS_PAGE_SIZE = 100;

/** Fecha de calendario del navegador; el backend recorta a "hoy" de BUSINESS_TIME_ZONE. */
function localDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function initialReportFilters(): ReportFilterState {
  return {
    period: '30',
    from: localDate(-29),
    to: localDate(),
    area: 'all',
    categoryId: '',
    type: '',
    itemId: '',
    employeeId: '',
    destinationId: '',
  };
}

function toApiFilters(state: ReportFilterState): StockReportFilters {
  return {
    from: state.from,
    to: state.to,
    area: state.area === 'all' ? undefined : state.area,
    categoryId: state.categoryId || undefined,
    type: state.type || undefined,
    itemId: state.itemId || undefined,
    employeeId: state.employeeId || undefined,
    destinationId: state.destinationId || undefined,
  };
}

/**
 * 📊 Reportes — agregados en el BACKEND (`/stock/reports/summary` y
 * `/stock/reports/movements`): el navegador nunca descarga el historial
 * completo ni recalcula totales. Caché de 60 s por combinación de filtros;
 * cambiar un filtro conserva el reporte anterior visible hasta que llega el
 * nuevo. Las cantidades se muestran SIEMPRE junto a su unidad: nunca se
 * suman litros con kilos. Las opciones de los filtros avanzados (productos,
 * personas, destinos, categorías) se piden solo al abrir "Más filtros".
 */
export function ReportsView() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const [filters, updateFilters] = useReportFilters(initialReportFilters);
  const [showMore, setShowMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const fromId = useId();
  const toId = useId();

  const rangeProblem =
    !filters.from || !filters.to
      ? 'Elegí las dos fechas del período.'
      : filters.from > filters.to
        ? 'La fecha «desde» no puede ser posterior a «hasta».'
        : null;
  const apiFilters = useMemo(() => toApiFilters(filters), [filters]);
  const reportEnabled = enabled && rangeProblem === null;

  const summaryQuery = useQuery({
    queryKey: queryKeys.stock.reportSummary(userId, apiFilters),
    queryFn: () => fetchStockReportSummary(apiFilters),
    enabled: reportEnabled,
    staleTime: STALE_TIME.metrics,
    placeholderData: keepPreviousData,
  });
  const movementsQuery = useInfiniteQuery({
    queryKey: queryKeys.stock.reportMovements(userId, apiFilters),
    queryFn: ({ pageParam }) =>
      fetchStockReportMovements({ ...apiFilters, page: pageParam, pageSize: MOVEMENTS_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last: StockReportMovementsResponse) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    enabled: reportEnabled,
    staleTime: STALE_TIME.metrics,
    placeholderData: keepPreviousData,
  });

  useSessionExpiry(summaryQuery.error, movementsQuery.error);

  const summary = summaryQuery.data;
  const refreshing =
    Boolean(summary) &&
    (summaryQuery.isFetching || (movementsQuery.isFetching && !movementsQuery.isFetchingNextPage));
  const stale = summaryQuery.isPlaceholderData ? 'is-stale' : undefined;

  const selectPeriod = (period: ReportPeriod) => {
    if (period === 'custom') {
      updateFilters({ period });
      return;
    }
    updateFilters({ period, from: localDate(-(Number(period) - 1)), to: localDate() });
  };

  const exportCsv = async () => {
    if (!reportEnabled || exporting) return;
    setExporting(true);
    setExportNotice(null);
    try {
      const csv = await fetchStockReportCsv(apiFilters);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `movimientos_stock_${filters.from}_${filters.to}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportNotice('CSV exportado.');
    } catch {
      setExportNotice('No pudimos exportar el CSV. Revisá los filtros e intentá de nuevo.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <StockPage
      description="Reportes de movimientos y estado del inventario, calculados en el servidor."
      refreshing={refreshing}
    >
      <div className="stock-filters">
        <div className="filter-scroller" role="group" aria-label="Período">
          {PERIODS.map((option) => (
            <Chip
              key={option.value}
              selected={filters.period === option.value}
              onSelect={() => selectPeriod(option.value)}
            >
              {option.label}
            </Chip>
          ))}
        </div>
        {filters.period === 'custom' ? (
          <div className="stock-filters__row">
            <div className="field stock-filters__field">
              <label className="field__label" htmlFor={fromId}>
                Desde
              </label>
              <input
                id={fromId}
                className="field__input"
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(event) => updateFilters({ from: event.target.value })}
              />
            </div>
            <div className="field stock-filters__field">
              <label className="field__label" htmlFor={toId}>
                Hasta
              </label>
              <input
                id={toId}
                className="field__input"
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(event) => updateFilters({ to: event.target.value })}
              />
            </div>
          </div>
        ) : null}
        <div className="filter-scroller" role="group" aria-label="Filtrar por área">
          {AREA_FILTERS.map((option) => (
            <Chip
              key={option.value}
              selected={filters.area === option.value}
              onSelect={() => updateFilters({ area: option.value, categoryId: '', itemId: '' })}
              leading={option.emoji ? <span aria-hidden="true">{option.emoji}</span> : undefined}
            >
              {option.label}
            </Chip>
          ))}
        </div>
        <div>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={showMore}
            onClick={() => setShowMore((open) => !open)}
          >
            {showMore ? 'Ocultar filtros' : 'Más filtros'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!reportEnabled || exporting}
            onClick={() => void exportCsv()}
          >
            <span aria-hidden="true">📥 </span>
            {exporting ? 'Exportando…' : 'Exportar CSV'}
          </Button>
        </div>
        {showMore ? (
          <AdvancedReportFilters filters={filters} onChange={updateFilters} isAdmin={isAdmin} />
        ) : null}
      </div>

      <div aria-live="polite" className="stock__notice">
        {exportNotice ? <p role="status">{exportNotice}</p> : null}
        {rangeProblem ? (
          <p role="alert" className="notice notice--danger">
            {rangeProblem}
          </p>
        ) : null}
        {summary && summaryQuery.isError && !summaryQuery.isFetching ? (
          <p role="alert" className="notice notice--danger">
            No pudimos actualizar el reporte. Mostramos los últimos datos.{' '}
            <Button size="sm" variant="ghost" onClick={() => void summaryQuery.refetch()}>
              Reintentar
            </Button>
          </p>
        ) : null}
      </div>

      {rangeProblem ? null : !summary ? (
        <Card>
          {summaryQuery.isError ? (
            <ErrorState
              title="No pudimos cargar el reporte."
              description={summaryErrorDescription(summaryQuery.error)}
              onRetry={() => void summaryQuery.refetch()}
            />
          ) : (
            <LoadingState label="Cargando reporte…" />
          )}
        </Card>
      ) : (
        <div className={['stock-reports', stale].filter(Boolean).join(' ')}>
          <p className="stock-reports__range">
            Período: {formatStockDay(summary.range.from)} al {formatStockDay(summary.range.to)}
            {summary.range.includesCurrentDay ? ' (incluye hoy)' : ''}.
          </p>
          <ReportSummaryCards summary={summary} />
          <div className="stock-reports__grid">
            <CurrentLevelsCard summary={summary} />
            <ProductsCard
              title="Productos con más movimientos"
              products={summary.products.mostMoved}
              metric={(product) => product.movementCount}
              describe={(product) =>
                `${product.movementCount} ${product.movementCount === 1 ? 'movimiento' : 'movimientos'}`
              }
              empty="No hubo movimientos en el período."
            />
            <ProductsCard
              title="Consumos por producto"
              products={summary.products.mostConsumed}
              metric={(product) => product.consumptionCount}
              describe={(product) =>
                `${product.consumed} ${product.item.unit} · ${product.consumptionCount} ${
                  product.consumptionCount === 1 ? 'consumo' : 'consumos'
                }`
              }
              empty="No hubo consumos en el período."
            />
            <DestinationsCard summary={summary} />
            <EmployeesCard summary={summary} />
          </div>
          <RecentMovementsCard
            pages={movementsQuery.data?.pages}
            isError={movementsQuery.isError}
            isFetchingNextPage={movementsQuery.isFetchingNextPage}
            hasNextPage={movementsQuery.hasNextPage}
            onLoadMore={() => {
              if (movementsQuery.isFetchingNextPage || !movementsQuery.hasNextPage) return;
              void movementsQuery.fetchNextPage({ cancelRefetch: false });
            }}
            onRetry={() => void movementsQuery.refetch()}
          />
        </div>
      )}
    </StockPage>
  );
}

function summaryErrorDescription(error: unknown): string | undefined {
  // Validaciones del backend (rango abusivo, fecha futura) ya traen texto humano.
  if (error && typeof error === 'object' && 'status' in error && error.status === 400) {
    return (error as { message?: string }).message;
  }
  return undefined;
}

interface AdvancedReportFiltersProps {
  filters: ReportFilterState;
  onChange: (patch: Partial<ReportFilterState>) => void;
  isAdmin: boolean;
}

/** Filtros avanzados: sus catálogos se piden recién al abrirlos (y quedan en caché 5 min). */
function AdvancedReportFilters({ filters, onChange, isAdmin }: AdvancedReportFiltersProps) {
  const { userId, enabled } = useSessionScope();
  const ids = {
    category: useId(),
    type: useId(),
    item: useId(),
    employee: useId(),
    destination: useId(),
  };
  const catalogStatus = isAdmin ? 'all' : 'active';
  const categoriesQuery = useQuery({
    queryKey: queryKeys.stock.categories(userId, catalogStatus),
    queryFn: () => fetchStockCategories(catalogStatus),
    enabled,
    staleTime: STALE_TIME.catalog,
  });
  const destinationsQuery = useQuery({
    queryKey: queryKeys.stock.destinations(userId, catalogStatus),
    queryFn: () => fetchStockDestinations(catalogStatus),
    enabled,
    staleTime: STALE_TIME.catalog,
  });
  const employeesQuery = useQuery({
    queryKey: queryKeys.tasks.employees(userId),
    queryFn: fetchTaskEmployees,
    enabled,
    staleTime: STALE_TIME.catalog,
  });
  const productFilters = {
    status: isAdmin ? ('all' as const) : ('active' as const),
    sort: 'name' as const,
    area: filters.area === 'all' ? undefined : filters.area,
  };
  const productsQuery = useQuery({
    queryKey: [...queryKeys.stock.items(userId, productFilters), 'options'],
    queryFn: () => fetchStockItems({ ...productFilters, pageSize: PRODUCT_OPTIONS_PAGE_SIZE }),
    enabled,
    staleTime: STALE_TIME.catalog,
  });
  useSessionExpiry(
    categoriesQuery.error,
    destinationsQuery.error,
    employeesQuery.error,
    productsQuery.error,
  );

  const categories = (categoriesQuery.data?.categories ?? []).filter(
    (category) =>
      filters.area === 'all' || category.area === filters.area || category.area === 'BOTH',
  );

  return (
    <div className="stock-filters__row stock-reports__advanced">
      <div className="field stock-filters__field">
        <label className="field__label" htmlFor={ids.category}>
          Categoría
        </label>
        <select
          id={ids.category}
          className="field__input"
          value={filters.categoryId}
          onChange={(event) => onChange({ categoryId: event.target.value })}
        >
          <option value="">Todas</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
              {filters.area === 'all' ? ` (${AREA_LABEL[category.area]})` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="field stock-filters__field">
        <label className="field__label" htmlFor={ids.type}>
          Tipo de movimiento
        </label>
        <select
          id={ids.type}
          className="field__input"
          value={filters.type}
          onChange={(event) =>
            onChange({
              type: event.target.value as StockMovementType | '',
            })
          }
        >
          <option value="">Todos</option>
          {MOVEMENT_FILTER_ORDER.map((type) => (
            <option key={type} value={type}>
              {MOVEMENT_LABEL[type]}
            </option>
          ))}
        </select>
      </div>
      <div className="field stock-filters__field">
        <label className="field__label" htmlFor={ids.item}>
          Producto
        </label>
        <select
          id={ids.item}
          className="field__input"
          value={filters.itemId}
          onChange={(event) => onChange({ itemId: event.target.value })}
        >
          <option value="">Todos</option>
          {(productsQuery.data?.items ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({AREA_LABEL[item.area]})
            </option>
          ))}
        </select>
      </div>
      <div className="field stock-filters__field">
        <label className="field__label" htmlFor={ids.employee}>
          Persona
        </label>
        <select
          id={ids.employee}
          className="field__input"
          value={filters.employeeId}
          onChange={(event) => onChange({ employeeId: event.target.value })}
        >
          <option value="">Todas</option>
          {(employeesQuery.data?.employees ?? []).map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.displayName}
            </option>
          ))}
        </select>
      </div>
      <div className="field stock-filters__field">
        <label className="field__label" htmlFor={ids.destination}>
          Destino
        </label>
        <select
          id={ids.destination}
          className="field__input"
          value={filters.destinationId}
          onChange={(event) => onChange({ destinationId: event.target.value })}
        >
          <option value="">Todos</option>
          {(destinationsQuery.data?.destinations ?? []).map((destination) => (
            <option key={destination.id} value={destination.id}>
              {destination.name} ({DESTINATION_TYPE_LABEL[destination.type]})
              {!destination.active ? ' (inactivo)' : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function UnitList({ values }: { values: StockQuantityByUnit[] }) {
  if (values.length === 0) return <span className="stock-reports__muted">Sin cantidades</span>;
  return (
    <ul className="stock-reports__units" role="list">
      {values.map((value) => (
        <li key={value.unit}>
          {value.quantity} {value.unit}
        </li>
      ))}
    </ul>
  );
}

/** Resumen: conteos de movimientos; cantidades SIEMPRE por unidad. */
function ReportSummaryCards({ summary }: { summary: StockReportSummary }) {
  const { totals, currentLevels } = summary;
  return (
    <section className="stock-reports__kpis" aria-label="Resumen del período">
      <Card className="stock-kpi">
        <p className="stock-kpi__label">Ingresos</p>
        <strong className="stock-kpi__value">{totals.income.count}</strong>
        <UnitList values={totals.income.byUnit} />
      </Card>
      <Card className="stock-kpi">
        <p className="stock-kpi__label">Consumos</p>
        <strong className="stock-kpi__value">{totals.consumption.count}</strong>
        <UnitList values={totals.consumption.byUnit} />
      </Card>
      <Card className="stock-kpi">
        <p className="stock-kpi__label">Ajustes</p>
        <strong className="stock-kpi__value">{totals.adjustments.count}</strong>
        <span className="stock-reports__muted">
          {totals.adjustments.increase} al alta · {totals.adjustments.decrease} a la baja
        </span>
      </Card>
      <Card className="stock-kpi">
        <p className="stock-kpi__label">
          <span aria-hidden="true">⚠️ </span>Críticos ahora
        </p>
        <strong className="stock-kpi__value">{currentLevels.critical}</strong>
        <span className="stock-reports__muted">Bajos ahora: {currentLevels.low}</span>
      </Card>
      {totals.openingBalance.count > 0 ? (
        <p className="stock-reports__note">
          Además hay {totals.openingBalance.count}{' '}
          {totals.openingBalance.count === 1 ? 'saldo inicial' : 'saldos iniciales'} de apertura en
          el período (carga inicial del inventario, no son ingresos).
        </p>
      ) : null}
    </section>
  );
}

function CurrentLevelsCard({ summary }: { summary: StockReportSummary }) {
  return (
    <Card title="Estado actual por área">
      <p className="stock-reports__note">
        Productos activos según su stock mínimo, hoy (no depende del período).
      </p>
      <table className="stock-reports__table">
        <thead>
          <tr>
            <th scope="col">Área</th>
            <th scope="col">Críticos</th>
            <th scope="col">Bajos</th>
            <th scope="col">Normales</th>
          </tr>
        </thead>
        <tbody>
          {summary.currentLevels.byArea.map((row) => (
            <tr key={row.area}>
              <th scope="row">
                <span aria-hidden="true">{AREA_EMOJI[row.area]} </span>
                {AREA_LABEL[row.area]}
              </th>
              <td>{row.critical}</td>
              <td>{row.low}</td>
              <td>{row.ok}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {summary.currentLevels.critical + summary.currentLevels.low > 0 ? (
        <p className="stock-reports__link">
          <Link to="/stock/purchases">
            <span aria-hidden="true">🛒 </span>Ver productos críticos y bajos en Compras
          </Link>
        </p>
      ) : (
        <p className="stock-reports__note">No hay productos críticos ni bajos.</p>
      )}
    </Card>
  );
}

interface ProductsCardProps {
  title: string;
  products: StockReportProduct[];
  /** Valor COMPARABLE entre productos (conteos), nunca cantidades de unidades distintas. */
  metric: (product: StockReportProduct) => number;
  describe: (product: StockReportProduct) => string;
  empty: string;
}

function ProductsCard({ title, products, metric, describe, empty }: ProductsCardProps) {
  const max = Math.max(1, ...products.map(metric));
  return (
    <Card title={title}>
      {products.length === 0 ? (
        <EmptyState title={empty} titleAs="p" />
      ) : (
        <ol className="stock-reports__ranking">
          {products.map((product) => (
            <li key={product.item.id}>
              <div className="stock-reports__ranking-head">
                <span className="stock-reports__name">
                  {product.item.name}
                  {!product.item.active ? ' (desactivado)' : ''}
                </span>
                <span className="stock-reports__muted">{describe(product)}</span>
              </div>
              <span className="stock-reports__bar" aria-hidden="true">
                <span style={{ width: `${Math.round((metric(product) / max) * 100)}%` }} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function DestinationsCard({ summary }: { summary: StockReportSummary }) {
  return (
    <Card title="Consumos por destino">
      {summary.destinations.length === 0 ? (
        <EmptyState title="No hubo consumos en el período." titleAs="p" />
      ) : (
        <ul className="stock-reports__rows" role="list">
          {summary.destinations.map((row) => (
            <li key={row.destination?.id ?? 'none'}>
              <div>
                <span className="stock-reports__name">
                  {row.destination ? row.destination.name : 'Sin destino'}
                </span>{' '}
                {row.destination ? (
                  <Badge tone="earth">{DESTINATION_TYPE_LABEL[row.destination.type]}</Badge>
                ) : null}
                <span className="stock-reports__muted">
                  {' '}
                  · {row.count} {row.count === 1 ? 'consumo' : 'consumos'}
                </span>
              </div>
              <UnitList values={row.byUnit} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EmployeesCard({ summary }: { summary: StockReportSummary }) {
  const types: StockMovementType[] = [
    'INCOME',
    'CONSUMPTION',
    'ADJUSTMENT_INCREASE',
    'ADJUSTMENT_DECREASE',
    'OPENING_BALANCE',
  ];
  return (
    <Card title="Movimientos por persona">
      {summary.employees.length === 0 ? (
        <EmptyState title="No hubo movimientos en el período." titleAs="p" />
      ) : (
        <ul className="stock-reports__rows" role="list">
          {summary.employees.map((row) => (
            <li key={row.employee?.id ?? 'none'} className="stock-reports__person">
              <Avatar
                name={row.employee?.displayName ?? 'Sin persona'}
                colorHex={row.employee?.colorHex}
                variant={row.employee ? 'person' : 'admin'}
                size="sm"
              />
              <div>
                <span className="stock-reports__name">
                  {row.employee ? row.employee.displayName : 'Sin persona asociada'}
                </span>
                <span className="stock-reports__muted">
                  {' '}
                  · {row.total} {row.total === 1 ? 'movimiento' : 'movimientos'}
                </span>
                <p className="stock-reports__muted">
                  {types
                    .filter((type) => row.byType[type] > 0)
                    .map((type) => `${MOVEMENT_PLURAL[type]}: ${row.byType[type]}`)
                    .join(' · ')}
                </p>
                {!row.employee ? (
                  <p className="stock-reports__note">
                    Saldos iniciales del inventario o movimientos de un administrador sin persona
                    vinculada.
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface RecentMovementsCardProps {
  pages: StockReportMovementsResponse[] | undefined;
  isError: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
}

function RecentMovementsCard({
  pages,
  isError,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
  onRetry,
}: RecentMovementsCardProps) {
  const movements = useMemo(() => {
    if (!pages) return [];
    const seen = new Set<string>();
    return pages.flatMap((page) =>
      page.movements.filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true))),
    );
  }, [pages]);
  const total = pages?.[pages.length - 1]?.total ?? 0;

  return (
    <Card title="Movimientos del período">
      {!pages ? (
        isError ? (
          <ErrorState title="No pudimos cargar los movimientos." onRetry={onRetry} />
        ) : (
          <LoadingState label="Cargando movimientos…" />
        )
      ) : movements.length === 0 ? (
        <EmptyState
          title="Sin movimientos en el período."
          description="Probá con un período más largo u otros filtros."
        />
      ) : (
        <>
          <ul className="stock-moves" role="list" aria-label="Movimientos del período">
            {movements.map((movement) => (
              <ReportMovementRow key={movement.id} movement={movement} />
            ))}
          </ul>
          {hasNextPage ? (
            <div className="stock__more">
              <Button variant="secondary" disabled={isFetchingNextPage} onClick={onLoadMore}>
                {isFetchingNextPage ? 'Cargando…' : `Cargar más (${movements.length} de ${total})`}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function ReportMovementRow({ movement }: { movement: StockReportMovement }) {
  return (
    <li className="stock-move">
      <div className="stock-move__head">
        <Badge tone={movement.type === 'CONSUMPTION' ? 'earth' : 'info'}>
          {MOVEMENT_LABEL[movement.type]}
        </Badge>
        <span className="stock-reports__name">{movement.item.name}</span>
        <span className="stock-move__date">{formatStockDay(movement.effectiveDate)}</span>
        <span className="stock-move__qty">
          {movementSignedPrefix(movement.type)}
          {movement.quantity} {movement.item.unit}
        </span>
      </div>
      <p className="stock-move__meta">
        <span aria-hidden="true">{AREA_EMOJI[movement.item.area]} </span>
        {AREA_LABEL[movement.item.area]} ·{' '}
        {movement.employee ? movement.employee.displayName : 'Sin persona registrada'}
        {movement.destination ? ` · Destino: ${movement.destination.name}` : ''}
        {movement.reason ? ` · ${movement.reason}` : ''}
      </p>
    </li>
  );
}
