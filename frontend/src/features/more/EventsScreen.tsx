import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { deleteEvent, fetchEvents } from '../../api/moreApi';
import type { BirthdayEvent, CalendarEvent, EventListItem, EventType } from '../../api/moreTypes';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { buttonClassName } from '../../components/ui/buttonStyles';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { errorMessageOf, humanError, isSessionExpired } from '../pets/petErrors';
import { EventFormDialog } from './EventFormDialog';
import { MoreBackLink } from './MoreBackLink';
import {
  EVENT_FILTERS,
  EVENT_ICON,
  EVENT_LABEL,
  birthdayOriginLabel,
  dateParts,
  relativeDays,
} from './moreLabels';
import { useMoreCache } from './useMoreCache';

const PAST_PAGE_SIZE = 20;

type Dialog =
  | { kind: 'none' }
  | { kind: 'form'; event?: CalendarEvent }
  | { kind: 'delete'; event: CalendarEvent };

/**
 * Acceso a la fuente de un cumpleaños derivado según quién mira (el backend
 * decide `sourceRef`): nunca un "Eliminar", y solo "Editar" donde esa persona
 * realmente puede editar (su perfil; la ficha de la mascota si es ADMIN).
 */
function sourceLink(item: BirthdayEvent, isAdmin: boolean): { to: string; label: string } | null {
  const ref = item.sourceRef;
  if (!ref) return null;
  if (ref.kind === 'MY_PROFILE') {
    return {
      to: '/more/profile',
      label: item.origin === 'USER_FAMILY' ? 'Editar en Mi familia' : 'Editar perfil',
    };
  }
  if (ref.kind === 'TEAM_PROFILES') return { to: '/more/settings/team', label: 'Ver perfil' };
  return { to: `/pets/${ref.id}`, label: isAdmin ? 'Editar ficha' : 'Ver ficha' };
}

/**
 * 📅 Eventos (`pg-eventos`): chips por tipo, "Próximos" (eventos desde hoy
 * y cumpleaños calculados por el backend) y "Pasados" atenuados y
 * paginados. Crear, editar y eliminar eventos (incluidos los cumpleaños
 * cargados a mano) es solo de ADMIN; los cumpleaños derivados muestran su
 * origen y se corrigen en su fuente (Mi perfil, Mi familia, la mascota).
 */
export function EventsScreen() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const { afterEventChange } = useMoreCache();
  const [filter, setFilter] = useState<EventType | 'all'>('all');
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const handleSessionExpired = useCallback(() => void logout(), [logout]);

  const query = useInfiniteQuery({
    queryKey: queryKeys.more.events(userId, filter),
    queryFn: ({ pageParam }) =>
      fetchEvents({
        type: filter === 'all' ? undefined : filter,
        pastPage: pageParam,
        pastPageSize: PAST_PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.past.page < last.past.totalPages ? last.past.page + 1 : undefined,
    enabled,
    placeholderData: keepPreviousData,
  });
  const expired = isSessionExpired(query.error);
  useEffect(() => {
    if (expired) handleSessionExpired();
  }, [expired, handleSessionExpired]);

  const first = query.data?.pages[0];
  const upcoming = first?.upcoming ?? [];
  const seen = new Set<string>();
  const past = (query.data?.pages.flatMap((page) => page.past.items) ?? []).filter((item) =>
    seen.has(item.id) ? false : (seen.add(item.id), true),
  );

  const renderItem = (item: EventListItem) => {
    const { day, monthShort } = dateParts(item.date);
    const link = item.kind === 'birthday' ? sourceLink(item, isAdmin) : null;
    return (
      <li key={item.id} className="event-item">
        <span className="event-item__date" aria-hidden="true">
          <span className="event-item__day">{day}</span>
          <span className="event-item__month">{monthShort}</span>
        </span>
        <div className="event-item__body">
          <p className="event-item__title">
            <span aria-hidden="true">{EVENT_ICON[item.type]} </span>
            {item.title}
          </p>
          <p className="event-item__meta">
            <span className={`event-tag event-tag--${item.type.toLowerCase()}`}>
              {EVENT_LABEL[item.type]}
            </span>
            <span>{relativeDays(item.daysUntil)}</span>
          </p>
          {item.note ? <p className="event-item__note">{item.note}</p> : null}
          {item.kind === 'birthday' ? (
            <p className="event-item__origin">
              🔁 Automático{' '}
              {birthdayOriginLabel(item.origin, item.sourceRef?.kind === 'MY_PROFILE')}
            </p>
          ) : item.type === 'BIRTHDAY' ? (
            <p className="event-item__origin">Cargado a mano</p>
          ) : null}
          {link ? (
            <Link
              to={link.to}
              className={buttonClassName({
                variant: 'ghost',
                size: 'sm',
                className: 'event-item__source',
              })}
              aria-label={`${link.label}: ${item.title}`}
            >
              {link.label}
            </Link>
          ) : null}
        </div>
        {isAdmin && item.kind === 'event' ? (
          <div className="event-item__actions">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Editar ${item.title}`}
              onClick={() => setDialog({ kind: 'form', event: item })}
            >
              <span aria-hidden="true">✏️</span>
            </Button>
            <Button
              size="sm"
              variant="danger"
              aria-label={`Eliminar ${item.title}`}
              onClick={() => setDialog({ kind: 'delete', event: item })}
            >
              <span aria-hidden="true">✕</span>
            </Button>
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="more">
      <PageHeader
        title={
          <>
            <span aria-hidden="true">📅 </span>Eventos
          </>
        }
        refreshing={Boolean(query.data) && query.isFetching && !query.isFetchingNextPage}
        actions={
          <div className="more__actions">
            <MoreBackLink />
            {isAdmin ? (
              <Button size="sm" onClick={() => setDialog({ kind: 'form' })}>
                + Nuevo
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="filter-scroller" role="group" aria-label="Filtrar por tipo">
        {EVENT_FILTERS.map((option) => (
          <Chip
            key={option.value}
            selected={filter === option.value}
            onSelect={() => setFilter(option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      {!query.data ? (
        query.isError ? (
          <ErrorState
            title="No pudimos cargar los eventos"
            description={errorMessageOf(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <LoadingState label="Cargando eventos…" />
        )
      ) : upcoming.length === 0 && past.length === 0 ? (
        <EmptyState icon={<span>📅</span>} title="Sin eventos" />
      ) : (
        <div className={query.isPlaceholderData ? 'is-stale' : undefined}>
          {upcoming.length ? (
            <Card className="more__card">
              <ul className="event-list" aria-label="Próximos">
                {upcoming.map(renderItem)}
              </ul>
            </Card>
          ) : null}
          {past.length ? (
            <>
              <h2 className="more__eyebrow">Pasados</h2>
              <Card className="more__card event-list--past">
                <ul className="event-list" aria-label="Pasados">
                  {past.map(renderItem)}
                </ul>
                {query.hasNextPage ? (
                  <Button
                    variant="secondary"
                    fullWidth
                    loading={query.isFetchingNextPage}
                    onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
                  >
                    Ver más
                  </Button>
                ) : null}
              </Card>
            </>
          ) : null}
        </div>
      )}

      {dialog.kind === 'form' ? (
        <EventFormDialog
          event={dialog.event}
          onClose={() => setDialog({ kind: 'none' })}
          onSaved={() => {
            setDialog({ kind: 'none' });
            afterEventChange();
          }}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}
      {dialog.kind === 'delete' ? (
        <ConfirmDialog
          title="¿Eliminar este evento?"
          description={`"${dialog.event.title}" dejará de mostrarse en Eventos.`}
          confirmLabel="Eliminar"
          tone="danger"
          onCancel={() => setDialog({ kind: 'none' })}
          onConfirm={async () => {
            try {
              await deleteEvent(dialog.event.id);
            } catch (caught) {
              if (isSessionExpired(caught)) return handleSessionExpired();
              throw humanError(caught);
            }
            setDialog({ kind: 'none' });
            afterEventChange();
          }}
        />
      ) : null}
    </div>
  );
}
