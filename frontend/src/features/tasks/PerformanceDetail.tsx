import { useId, useState } from 'react';
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type {
  DetailStatusFilter,
  PerformanceDetailFilters,
  PerformanceOccurrence,
  PerformanceResponse,
} from '../../api/performanceTypes';
import { STALE_TIME } from '../../api/queryClient';
import { useSessionScope } from '../../api/useSessionScope';
import { Button } from '../../components/ui/Button';
import { buttonClassName } from '../../components/ui/buttonStyles';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon } from '../../components/ui/icons';
import {
  BUSINESS_TIME_ZONE,
  formatDate,
  formatDateRange,
  formatDateWithWeekday,
} from '../../utils/dateFormat';
import type { LateCompletionItem } from './LateCompletionDialog';
import { FrequencyFilterBar, type FrequencyFilter } from './TaskFilters';
import { FREQUENCY_LABEL, formatLateRegistration, formatPeriodKey } from './taskLabels';

/** Rótulo del estado que ya calculó el backend, visto desde la persona del detalle. */
function occurrenceLabel(item: PerformanceOccurrence, personId: string): string {
  if (item.assignedEmployeeId !== personId) return '🤝 Cubrió a otros';
  if (item.status === 'personal') return '✅ Propia';
  if (item.status === 'covered') return '🤝 Le cubrieron';
  return 'Sin completar';
}

/**
 * Período de una obligación: la fecha de una diaria, el período completo de
 * una recurrente más larga (nunca solo su inicio, que no es un vencimiento)
 * o la fecha para realizar de una «Una vez».
 */
function occurrencePeriod(item: PerformanceOccurrence): string {
  if (item.frequency === 'ONE_TIME' && item.scheduledDate) {
    return `${FREQUENCY_LABEL.ONE_TIME} · para el ${formatDateWithWeekday(item.scheduledDate)}`;
  }
  if (item.frequency === 'URGENT' || item.frequency === 'ONE_TIME') {
    return FREQUENCY_LABEL[item.frequency];
  }
  if (item.period && item.frequency !== 'DAILY') {
    return `${formatDateRange(item.period.start, item.period.end)} · ${FREQUENCY_LABEL[item.frequency]}`;
  }
  return `${formatPeriodKey(item.periodKey)} · ${FREQUENCY_LABEL[item.frequency]}`;
}

/**
 * Acciones de una fila — SOLO ✅ Tareas (las decide el backend). La fuente
 * sin acciones (🥬 Huerta) no recibe esto y su fila queda como siempre.
 */
export interface RowActions {
  isAdmin: boolean;
  tasksPath: string;
  onLate: (item: LateCompletionItem) => void;
  onRevert: (item: PerformanceOccurrence, executionId: string) => void;
}

/**
 * Ejecución que se puede deshacer desde la fila, según el backend: la de
 * `execution` (cualquier realizada o cubierta) o, con un backend anterior,
 * la de una carga olvidada. Sin permiso, ninguna (no se ofrece algo que
 * fallaría siempre).
 */
function revertibleExecutionId(item: PerformanceOccurrence): string | null {
  if (!item.completed) return null;
  if (item.execution) return item.execution.canRevert ? item.execution.id : null;
  return item.lateRegistration?.canRevert ? item.lateRegistration.executionId : null;
}

/**
 * Acción compacta de la fila (la que habilita el backend): «Marcar
 * realizada» (recurrente pendiente y registrable), «Completar en Tareas»
 * («Una vez» o urgente pendiente: su flujo normal) o «Deshacer» (ejecución
 * vigente que quien mira puede revertir; el ADMIN, con motivo). El nombre
 * accesible suma la tarea y el período.
 */
function DetailAction({ item, actions }: { item: PerformanceOccurrence; actions: RowActions }) {
  const { lateCompletion } = item;
  const context = (
    <span className="visually-hidden">
      : {item.description}, {occurrencePeriod(item)}
    </span>
  );
  if (!item.completed && lateCompletion) {
    return (
      <Button
        size="sm"
        variant="secondary"
        className="performance-detail__action"
        onClick={() => actions.onLate({ ...item, lateCompletion })}
      >
        Marcar realizada
        {context}
      </Button>
    );
  }
  if (!item.completed && item.completeInTasks) {
    return (
      <Link
        to={actions.tasksPath}
        className={buttonClassName({
          variant: 'ghost',
          size: 'sm',
          className: 'performance-detail__action',
        })}
      >
        Completar en Tareas
        <span className="visually-hidden">: {item.description}</span>
      </Link>
    );
  }
  const executionId = revertibleExecutionId(item);
  if (executionId) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="performance-detail__action"
        onClick={() => actions.onRevert(item, executionId)}
      >
        Deshacer
        {context}
      </Button>
    );
  }
  return null;
}

/** Una obligación del detalle. Sin `actions`, exactamente la fila de siempre. */
export function OccurrenceRow({
  item,
  personId,
  timeZone,
  actions,
}: {
  item: PerformanceOccurrence;
  personId: string;
  timeZone: string;
  actions: RowActions | null;
}) {
  return (
    <li>
      <span>
        <strong>{item.description}</strong>
        <small>
          {occurrencePeriod(item)} · asignada a{' '}
          {item.assignedEmployee?.displayName ?? 'Sin responsable'}
          {item.completedByEmployee
            ? ` · realizada por ${item.completedByEmployee.displayName}`
            : ''}
        </small>
        {actions && item.lateRegistration ? (
          <small>
            {formatLateRegistration(
              item.lateRegistration.performedOn,
              item.lateRegistration.recordedAt,
              timeZone,
            )}
          </small>
        ) : null}
      </span>
      {actions ? (
        <span className="performance-detail__side">
          <span>{occurrenceLabel(item, personId)}</span>
          <DetailAction item={item} actions={actions} />
        </span>
      ) : (
        <span>{occurrenceLabel(item, personId)}</span>
      )}
    </li>
  );
}

/**
 * Detalle filtrable y paginado («Ver más») — SOLO ✅ Tareas. Cada página la
 * arma el backend (`limit` 20 + cursor) con las obligaciones de TODO el
 * rango ya filtradas y ordenadas; las métricas no dependen de esto.
 */
export interface PerformanceDetailPages {
  key: (
    userId: string,
    personId: string,
    from: string,
    to: string,
    filters: PerformanceDetailFilters,
  ) => QueryKey;
  fetchPage: (
    personId: string,
    from: string,
    to: string,
    filters: PerformanceDetailFilters,
    cursor: string | null,
  ) => Promise<PerformanceResponse>;
}

const STATUS_OPTIONS: { value: DetailStatusFilter | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Sin completar' },
  { value: 'personal', label: 'Realizadas' },
  { value: 'covered', label: 'Cubiertas' },
  { value: 'coverageGiven', label: 'Cubrió a otros' },
];

interface Filters {
  date: string;
  frequency: FrequencyFilter;
  status: DetailStatusFilter | 'all';
}
const NO_FILTERS: Filters = { date: '', frequency: 'all', status: 'all' };

/** `YYYY-MM-DD` desplazado `days` días (aritmética de calendario, sin zona del navegador). */
function shiftDay(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** «Hoy · Viernes 30/10/2026», «Ayer · …» o el día con su semana; `null` → «Sin fecha». */
function dayLabel(date: string | null, today: string): string {
  if (date === null) return 'Sin fecha';
  const text = formatDateWithWeekday(date);
  if (date === today) return `Hoy · ${text}`;
  return date === shiftDay(today, -1) ? `Ayer · ${text}` : text;
}

export function PagedPerformanceDetail({
  pages,
  personId,
  range,
  today,
  actions,
  onClose,
}: {
  pages: PerformanceDetailPages;
  personId: string;
  range: { from: string; to: string };
  today: string;
  actions: RowActions | null;
  onClose: () => void;
}) {
  const id = useId();
  const { userId, enabled } = useSessionScope();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [dateReset, setDateReset] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);

  // El día elegido queda fuera del rango cuando cambia el día de negocio
  // (el rango avanza): se vuelve a «Todas las fechas» y se avisa.
  const rangeKey = `${range.from}|${range.to}`;
  const [shownRange, setShownRange] = useState(rangeKey);
  if (shownRange !== rangeKey) {
    setShownRange(rangeKey);
    if (filters.date && (filters.date < range.from || filters.date > range.to)) {
      setDateReset(filters.date);
      setFilters({ ...filters, date: '' });
    }
  }

  // Nunca se pide un día fuera del rango, ni siquiera en el render en que cambió.
  const date = filters.date >= range.from && filters.date <= range.to ? filters.date : '';
  const applied: PerformanceDetailFilters = {
    ...(date ? { date } : {}),
    ...(filters.frequency !== 'all' ? { frequency: filters.frequency } : {}),
    ...(filters.status !== 'all' ? { status: filters.status } : {}),
  };
  const hasFilters = Object.keys(applied).length > 0;
  const update = (next: Partial<Filters>) => {
    setDateReset(null);
    setDateError(null);
    setFilters({ ...filters, ...next });
  };
  /** Un día del calendario: vacío = todas; fuera del rango (escrito a mano) no se aplica. */
  const chooseDate = (value: string) => {
    if (value && (value < range.from || value > range.to)) {
      setDateError(`Elegí un día entre el ${formatDate(range.from)} y el ${formatDate(range.to)}.`);
      return;
    }
    update({ date: value });
  };

  // Sin datos previos de otra persona, rango o filtro: una clave nueva
  // empieza en su primera página (estado de carga, nunca filas ajenas).
  const query = useInfiniteQuery({
    queryKey: pages.key(userId, personId, range.from, range.to, applied),
    queryFn: ({ pageParam }) => pages.fetchPage(personId, range.from, range.to, applied, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.occurrencesPage?.nextCursor ?? undefined,
    enabled,
    staleTime: STALE_TIME.metrics,
    // Cambiar de persona, rango o filtros reinicia la paginación: las páginas
    // de una combinación que deja de verse se descartan enseguida, así que
    // volver a ella empieza otra vez por la primera página.
    gcTime: 0,
  });

  // Páginas unidas sin duplicados y agrupadas por día (el backend ya ordena:
  // más recientes primero, sin fecha al final), así un día que atraviesa dos
  // páginas sigue siendo un solo grupo.
  const seen = new Set<string>();
  const items = (query.data?.pages.flatMap((page) => page.occurrences ?? []) ?? []).filter(
    (item) => {
      const key = `${item.taskId}|${item.periodKey}`;
      return seen.has(key) ? false : (seen.add(key), true);
    },
  );
  const groups = new Map<string | null, PerformanceOccurrence[]>();
  for (const item of items) {
    const date = item.groupDate ?? null;
    groups.set(date, [...(groups.get(date) ?? []), item]);
  }
  const lastPage = query.data?.pages.at(-1);
  const total = lastPage?.occurrencesPage?.total ?? items.length;
  const timeZone = query.data?.pages[0]?.range.timeZone ?? BUSINESS_TIME_ZONE;

  let content;
  if (!query.data) {
    content = query.isError ? (
      <ErrorState title="No pudimos cargar el detalle." onRetry={() => void query.refetch()} />
    ) : (
      <LoadingState label="Cargando detalle…" />
    );
  } else if (items.length === 0) {
    content = hasFilters ? (
      <EmptyState
        titleAs="p"
        title="No hay obligaciones con estos filtros."
        description="Probá con otra fecha, frecuencia o estado, o limpiá los filtros."
      />
    ) : (
      <EmptyState titleAs="p" title="Sin obligaciones en este período." />
    );
  } else {
    content = (
      <div aria-busy={query.isFetching || undefined}>
        {Array.from(groups, ([date, rows], index) => (
          <section
            key={date ?? 'sin-fecha'}
            className="performance-detail-group"
            aria-labelledby={`${id}-group-${index}`}
          >
            <h3 id={`${id}-group-${index}`} className="performance-detail-group__title">
              {dayLabel(date, today)}
            </h3>
            <ul className="performance-detail performance-detail--actions">
              {rows.map((item) => (
                <OccurrenceRow
                  key={`${item.taskId}-${item.periodKey}`}
                  item={item}
                  personId={personId}
                  timeZone={timeZone}
                  actions={actions}
                />
              ))}
            </ul>
          </section>
        ))}
        <div className="performance-detail__footer">
          <p className="stock__count" role="status">
            Mostrando {items.length} de {total} {total === 1 ? 'registro' : 'registros'}
          </p>
          {query.isFetchNextPageError ? (
            <p role="alert" className="notice notice--danger">
              <AlertIcon size="sm" />
              No pudimos cargar más registros.
              <Button size="sm" variant="ghost" onClick={() => void query.fetchNextPage()}>
                Reintentar
              </Button>
            </p>
          ) : null}
          {query.hasNextPage && !query.isFetchNextPageError ? (
            <Button
              variant="secondary"
              fullWidth
              loading={query.isFetchingNextPage}
              disabled={query.isFetching}
              onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
            >
              Ver más
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <Card
      title={
        <>
          <span aria-hidden="true">📋 </span>Detalle
        </>
      }
      actions={
        <button type="button" className="button button--ghost button--sm" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      <div className="performance-detail-filters">
        <div className="field">
          <label className="field__label" htmlFor={`${id}-date`}>
            Fecha
          </label>
          <div className="performance-detail-filters__date">
            <input
              id={`${id}-date`}
              className="field__input"
              type="date"
              // Solo días del rango elegido (7, 14 o 30), nunca futuros: el
              // rango termina hoy, en el día de negocio del servidor.
              min={range.from}
              max={range.to}
              value={date}
              aria-describedby={`${id}-date-hint`}
              onChange={(event) => chooseDate(event.target.value)}
            />
            {date ? (
              <Button size="sm" variant="ghost" onClick={() => chooseDate('')}>
                Todas las fechas
              </Button>
            ) : null}
          </div>
          <p className="field__hint" id={`${id}-date-hint`}>
            {date ? dayLabel(date, today) : 'Todas las fechas del período.'}
          </p>
          {dateError ? (
            <p className="field__hint field__hint--error" role="alert">
              {dateError}
            </p>
          ) : null}
        </div>
        {dateReset ? (
          <p className="performance__note" role="status">
            El día {formatDate(dateReset)} quedó fuera del período: se muestran todas las fechas.
          </p>
        ) : null}
        <FrequencyFilterBar
          selected={filters.frequency}
          onSelect={(frequency) => update({ frequency })}
        />
        <div className="filter-scroller" role="group" aria-label="Filtrar por estado">
          {STATUS_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              selected={filters.status === option.value}
              onSelect={() => update({ status: option.value })}
            >
              {option.label}
            </Chip>
          ))}
        </div>
        {hasFilters ? (
          <Button
            size="sm"
            variant="ghost"
            className="performance-detail-filters__clear"
            onClick={() => update(NO_FILTERS)}
          >
            Limpiar filtros
          </Button>
        ) : null}
      </div>
      {content}
    </Card>
  );
}
