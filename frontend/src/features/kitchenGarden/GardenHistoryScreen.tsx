import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  fetchGardenHistoryEntries,
  fetchGardenParticipants,
  revertGardenCompletion,
} from '../../api/kitchenGardenApi';
import type {
  GardenHistoryEntriesResponse,
  GardenHistoryEntry,
  GardenHistoryFilters,
} from '../../api/kitchenGardenTypes';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon, CheckCircleIcon } from '../../components/ui/icons';
import { formatDate, formatDateTime, formatDateWithWeekday } from '../../utils/dateFormat';
import { isSessionExpired } from '../tasks/dialogErrors';
import { RevertTaskDialog } from '../tasks/RevertTaskDialog';
import { FREQUENCY_LABEL, FREQUENCY_TONE } from '../tasks/taskLabels';
import { toPerson } from './gardenAdapters';
import { GARDEN_TITLE } from './gardenTitle';
import { KitchenGardenSubnav } from './KitchenGardenSubnav';
import {
  KIND_ICON,
  KIND_LABEL,
  KIND_ORDER,
  UNCLASSIFIED_LABEL,
  type KindFilter,
} from './recordLabels';
import { useGardenCache } from './useGardenCache';

type RangeMode = 'recent' | 'custom' | 'all';

/** Mismos límites que el backend: menos de 2 caracteres no busca. */
const HISTORY_SEARCH_MIN = 2;
const HISTORY_SEARCH_MAX = 100;
/** La búsqueda viaja recién tras esta pausa (nunca una request por tecla). */
const HISTORY_SEARCH_DEBOUNCE_MS = 350;

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Texto del rango que devolvió el backend (el de «Últimos 30 días» lo calcula él). */
function rangeLabel(range: GardenHistoryEntriesResponse['range']): string {
  if (range.mode === 'all') return 'Todo el historial';
  const prefix = range.mode === 'recent' ? 'Últimos 30 días: ' : '';
  if (range.from && range.to) {
    return `${prefix}del ${formatDate(range.from)} al ${formatDate(range.to)}`;
  }
  if (range.from) return `Desde el ${formatDate(range.from)}`;
  return `Hasta el ${formatDate(range.to)}`;
}

/** Grupos por día de negocio, en el orden en que llegan (más reciente primero). */
function byDay(entries: GardenHistoryEntry[]) {
  const groups: { day: string; entries: GardenHistoryEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last?.day === entry.completedOn) last.entries.push(entry);
    else groups.push({ day: entry.completedOn, entries: [entry] });
  }
  return groups;
}

/**
 * 🥬 Huerta → 📅 Historial: las realizaciones, más recientes primero y
 * agrupadas por día, sin tener que saber la semana. Por defecto los últimos
 * 30 días (el rango se muestra); también «Desde»/«Hasta» o todo el
 * historial, y filtros por texto, tipo y persona que la realizó. Búsqueda,
 * filtros, orden y páginas de 20 («Ver más») en el backend; cambiar un filtro
 * empieza de nuevo en la primera página. «Deshacer» solo donde lo permite el
 * backend; las deshechas, solo a pedido y marcadas.
 */
export function GardenHistoryScreen() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const { afterActivityChange } = useGardenCache();
  const fieldId = useId();
  const field = (name: string) => `${fieldId}-${name}`;
  const [mode, setMode] = useState<RangeMode>('recent');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [participantId, setParticipantId] = useState('');
  const [includeReverted, setIncludeReverted] = useState(false);
  const [revert, setRevert] = useState<GardenHistoryEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const endSession = useCallback(() => void logout(), [logout]);

  const typed = normalize(searchInput);
  const searchTooShort = typed.length > 0 && typed.length < HISTORY_SEARCH_MIN;
  useEffect(() => {
    const next = typed.length >= HISTORY_SEARCH_MIN ? typed : '';
    if (next === search) return;
    const timer = window.setTimeout(() => setSearch(next), HISTORY_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [typed, search]);

  // Un rango propio sin ningún extremo vuelve a ser «Últimos 30 días».
  const effectiveMode: RangeMode = mode === 'custom' && !from && !to ? 'recent' : mode;
  const invalidRange = effectiveMode === 'custom' && Boolean(from && to && from > to);
  const filters: GardenHistoryFilters = useMemo(
    () => ({
      ...(effectiveMode === 'all' ? { all: true } : {}),
      ...(effectiveMode === 'custom' && from ? { from } : {}),
      ...(effectiveMode === 'custom' && to ? { to } : {}),
      ...(search ? { q: search } : {}),
      ...(kind !== 'all' ? { kind } : {}),
      ...(participantId ? { participantId } : {}),
      ...(includeReverted ? { includeReverted: true } : {}),
    }),
    [effectiveMode, from, to, search, kind, participantId, includeReverted],
  );

  const historyQuery = useInfiniteQuery({
    queryKey: queryKeys.kitchenGarden.historyEntries(userId, filters),
    queryFn: ({ pageParam }) => fetchGardenHistoryEntries(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabled && !invalidRange,
    staleTime: STALE_TIME.operational,
    placeholderData: keepPreviousData,
  });
  const participantsQuery = useQuery({
    queryKey: queryKeys.kitchenGarden.participants(userId),
    queryFn: fetchGardenParticipants,
    enabled,
    staleTime: STALE_TIME.catalog,
  });
  const expired = isSessionExpired(historyQuery.error) || isSessionExpired(participantsQuery.error);
  useEffect(() => {
    if (expired) endSession();
  }, [expired, endSession]);

  const first = historyQuery.data?.pages[0];
  const entries = useMemo(() => {
    const seen = new Set<string>();
    return (historyQuery.data?.pages.flatMap((page) => page.entries) ?? []).filter((entry) =>
      seen.has(entry.id) ? false : (seen.add(entry.id), true),
    );
  }, [historyQuery.data]);
  const hasFilters = Boolean(search || participantId || includeReverted) || kind !== 'all';
  const shownFrom = mode === 'custom' ? from : mode === 'recent' ? (first?.range.from ?? '') : '';
  const shownTo = mode === 'custom' ? to : mode === 'recent' ? (first?.range.to ?? '') : '';

  /** Editar una fecha pasa a un rango propio que conserva el otro extremo visible. */
  function changeDate(which: 'from' | 'to', value: string): void {
    if (mode !== 'custom') {
      setFrom(shownFrom);
      setTo(shownTo);
      setMode('custom');
    }
    if (which === 'from') setFrom(value);
    else setTo(value);
  }

  let content;
  if (invalidRange) {
    content = (
      <p role="alert" className="notice notice--warning">
        <AlertIcon size="sm" />
        «Desde» no puede ser posterior a «Hasta».
      </p>
    );
  } else if (!first) {
    content = historyQuery.isError ? (
      <ErrorState
        title="No pudimos cargar el historial."
        onRetry={() => void historyQuery.refetch()}
      />
    ) : (
      <LoadingState label="Cargando historial…" />
    );
  } else if (entries.length === 0) {
    content = (
      <>
        <EmptyState
          icon={<span aria-hidden="true">📅</span>}
          title={
            hasFilters || effectiveMode === 'custom'
              ? 'No hay realizaciones con estos filtros.'
              : effectiveMode === 'all'
                ? 'Todavía no hay realizaciones registradas.'
                : 'No hay realizaciones en los últimos 30 días.'
          }
          description={
            effectiveMode === 'all'
              ? 'Probá con otro texto, tipo o persona.'
              : 'Probá con otras fechas o con todo el historial.'
          }
        />
        {effectiveMode !== 'all' ? (
          <div className="garden-empty-action">
            <Button variant="secondary" onClick={() => setMode('all')}>
              Ver todo el historial
            </Button>
          </div>
        ) : null}
      </>
    );
  } else {
    content = (
      <div className={historyQuery.isPlaceholderData ? 'is-stale' : undefined}>
        {byDay(entries).map((group) => {
          const title = `${group.day === first.range.today ? 'Hoy · ' : ''}${formatDateWithWeekday(group.day)}`;
          return (
            <section className="garden-history__day" key={group.day} aria-label={title}>
              <h2 className="garden-section__title">{title}</h2>
              <ul className="garden-history__list" aria-label={`Realizaciones del ${title}`}>
                {group.entries.map((entry) => (
                  <HistoryRow
                    key={entry.id}
                    entry={entry}
                    timeZone={first.range.timeZone}
                    onRevert={() => setRevert(entry)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
        {historyQuery.hasNextPage ? (
          <Button
            variant="secondary"
            fullWidth
            loading={historyQuery.isFetchingNextPage}
            onClick={() => void historyQuery.fetchNextPage({ cancelRefetch: false })}
          >
            Ver más
          </Button>
        ) : null}
        {historyQuery.isFetchNextPageError ? (
          <p role="alert" className="notice notice--warning">
            <AlertIcon size="sm" />
            No pudimos cargar más realizaciones. Lo ya cargado sigue acá.
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void historyQuery.fetchNextPage({ cancelRefetch: false })}
            >
              Reintentar
            </Button>
          </p>
        ) : null}
        <p className="garden-history__note">
          La descripción y el tipo son los actuales de cada actividad.
        </p>
      </div>
    );
  }

  const participants = participantsQuery.data?.participants ?? [];

  return (
    <div className="tasks garden">
      <PageHeader
        title={GARDEN_TITLE}
        refreshing={
          Boolean(historyQuery.data) && historyQuery.isFetching && !historyQuery.isFetchingNextPage
        }
      />
      <KitchenGardenSubnav />

      <div aria-live="polite" className="tasks__notice">
        {notice ? (
          <p role="status" className="notice notice--positive">
            <CheckCircleIcon size="sm" />
            {notice}
          </p>
        ) : null}
      </div>

      <div className="garden-history__filters">
        <div className="filter-scroller" role="group" aria-label="Período">
          <Chip
            selected={effectiveMode === 'recent'}
            onSelect={() => {
              setMode('recent');
              setFrom('');
              setTo('');
            }}
          >
            Últimos 30 días
          </Chip>
          <Chip selected={effectiveMode === 'all'} onSelect={() => setMode('all')}>
            Todo el historial
          </Chip>
        </div>
        <div className="garden-history__fields">
          <div className="field">
            <label className="field__label" htmlFor={field('from')}>
              Desde
            </label>
            <input
              id={field('from')}
              className="field__input"
              type="date"
              min="2000-01-01"
              max={shownTo || '2100-12-31'}
              value={shownFrom}
              onChange={(event) => changeDate('from', event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={field('to')}>
              Hasta
            </label>
            <input
              id={field('to')}
              className="field__input"
              type="date"
              min={shownFrom || '2000-01-01'}
              max="2100-12-31"
              value={shownTo}
              onChange={(event) => changeDate('to', event.target.value)}
            />
          </div>
          <div className="field garden-history__search">
            <label className="field__label" htmlFor={field('search')}>
              Buscar en la descripción
            </label>
            <input
              id={field('search')}
              className="field__input"
              type="search"
              maxLength={HISTORY_SEARCH_MAX}
              autoComplete="off"
              placeholder="Ej: lechuga"
              value={searchInput}
              aria-describedby={searchTooShort ? field('search-hint') : undefined}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            {searchTooShort ? (
              <p className="field__hint" id={field('search-hint')}>
                Escribí al menos {HISTORY_SEARCH_MIN} caracteres para buscar.
              </p>
            ) : null}
          </div>
          <div className="field">
            <label className="field__label" htmlFor={field('person')}>
              Persona que la realizó
            </label>
            <select
              id={field('person')}
              className="field__input"
              value={participantId}
              onChange={(event) => setParticipantId(event.target.value)}
            >
              <option value="">Todas</option>
              {participants.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.displayName}
                  {participant.active ? '' : ' (ya no participa)'}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="filter-scroller" role="group" aria-label="Filtrar por tipo">
          <Chip selected={kind === 'all'} onSelect={() => setKind('all')}>
            Todos
          </Chip>
          {KIND_ORDER.map((value) => (
            <Chip key={value} selected={kind === value} onSelect={() => setKind(value)}>
              {`${KIND_ICON[value]} ${KIND_LABEL[value]}`}
            </Chip>
          ))}
          <Chip selected={kind === 'UNCLASSIFIED'} onSelect={() => setKind('UNCLASSIFIED')}>
            {UNCLASSIFIED_LABEL}
          </Chip>
        </div>
        <label className="tasks__admin-toggle">
          <input
            type="checkbox"
            checked={includeReverted}
            onChange={(event) => setIncludeReverted(event.target.checked)}
          />
          Incluir finalizaciones deshechas
        </label>
      </div>

      {first && !invalidRange ? (
        <p className="garden-history__range" role="status">
          <span aria-hidden="true">🗓️ </span>
          {rangeLabel(first.range)}
        </p>
      ) : null}

      <Card>{content}</Card>

      {revert ? (
        <RevertTaskDialog
          description={revert.activity.description}
          execution={{ completedByEmployee: toPerson(revert.completedBy) }}
          reasonRequired={isAdmin}
          onCancel={() => setRevert(null)}
          onConfirm={async (reason) => {
            try {
              await revertGardenCompletion(revert.activity.id, revert.id, reason);
            } catch (error) {
              if (isSessionExpired(error)) endSession();
              throw error;
            }
            setNotice(`Se deshizo la finalización de «${revert.activity.description}».`);
            setRevert(null);
            afterActivityChange();
          }}
        />
      ) : null}
    </div>
  );
}

/** Una realización: qué, cuándo se completó, quién la hizo y, si fue otra persona, quién la registró. */
function HistoryRow({
  entry,
  timeZone,
  onRevert,
}: {
  entry: GardenHistoryEntry;
  timeZone: string;
  onRevert: () => void;
}) {
  const { activity, completedBy, assignedTo, recordedBy, reverted } = entry;
  return (
    <li className={reverted ? 'garden-entry garden-entry--reverted' : 'garden-entry'}>
      <div className="garden-entry__body">
        <p className="garden-entry__description">{activity.description}</p>
        <p className="task-item__meta">
          {activity.kind ? (
            <span className="garden-kind">
              <span aria-hidden="true">{KIND_ICON[activity.kind]} </span>
              {KIND_LABEL[activity.kind]}
            </span>
          ) : (
            <span className="garden-kind garden-kind--unclassified">{UNCLASSIFIED_LABEL}</span>
          )}
          <Badge tone={FREQUENCY_TONE[activity.frequency]}>
            {FREQUENCY_LABEL[activity.frequency]}
          </Badge>
          {reverted ? <Badge tone="neutral">Deshecha</Badge> : null}
        </p>
        <p className="garden-entry__line">
          Completada el {formatDateTime(entry.completedAt, timeZone)} por{' '}
          <strong>{completedBy.displayName}</strong>
          {assignedTo.id !== completedBy.id ? ` · Asignada a ${assignedTo.displayName}` : ''}
        </p>
        {recordedBy ? (
          <p className="garden-entry__line">Registró: {recordedBy.displayName}</p>
        ) : null}
        {reverted ? (
          <p className="garden-entry__line garden-entry__reverted">
            Deshecha el {formatDateTime(reverted.revertedAt, timeZone)}
            {reverted.revertedBy ? ` por ${reverted.revertedBy}` : ''}
            {reverted.reason ? ` · Motivo: ${reverted.reason}` : ''}
          </p>
        ) : null}
      </div>
      {entry.canRevert ? (
        <Button size="sm" variant="secondary" onClick={onRevert}>
          Deshacer<span className="visually-hidden">: {activity.description}</span>
        </Button>
      ) : null}
    </li>
  );
}
