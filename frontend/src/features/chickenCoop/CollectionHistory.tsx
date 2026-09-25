import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchEggCollectionHistory, voidEggCollection } from '../../api/chickenCoopApi';
import type { EggCollection, EggCollectionDay } from '../../api/chickenCoopTypes';
import { ApiError } from '../../api/httpClient';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon } from '../../components/ui/icons';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { errorMessageOf, isSessionExpired } from './chickenCoopErrors';
import { eggsText, formatDayHeading, formatRate, layingTone } from './chickenCoopLabels';
import { useChickenCoopCache } from './useChickenCoopCache';

/** Días por página: el historial se pagina por días completos, nunca parte un día. */
export const HISTORY_PAGE_DAYS = 10;

interface CollectionHistoryProps {
  isAdmin: boolean;
  onSessionExpired: () => void;
}

/**
 * "Historial" del prototipo: agrupado por fecha (más reciente primero), con
 * 🥚 buenos, 💔 rotos, postura del día y cada recolección con su persona y
 * observación. "✕" (solo ADMIN, con confirmación) la elimina — en el
 * backend es una anulación auditada, no un borrado.
 */
export function CollectionHistory({ isAdmin, onSessionExpired }: CollectionHistoryProps) {
  const { userId, enabled } = useSessionScope();
  const invalidate = useChickenCoopCache();
  const [toVoid, setToVoid] = useState<{ collection: EggCollection; day: string } | null>(null);

  const query = useInfiniteQuery({
    queryKey: queryKeys.chickenCoop.history(userId),
    queryFn: ({ pageParam }) => fetchEggCollectionHistory(pageParam, HISTORY_PAGE_DAYS),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled,
    staleTime: STALE_TIME.operational,
  });

  const expired = isSessionExpired(query.error);
  useEffect(() => {
    if (expired) onSessionExpired();
  }, [expired, onSessionExpired]);

  const days = dedupeDays(query.data?.pages.flatMap((page) => page.days) ?? []);

  let content;
  if (!query.data) {
    content = query.isError ? (
      <ErrorState
        title="No pudimos cargar el historial"
        description={errorMessageOf(query.error)}
        onRetry={() => void query.refetch()}
      />
    ) : (
      <LoadingState label="Cargando historial…" />
    );
  } else if (days.length === 0) {
    content = <EmptyState titleAs="p" icon={<span>🥚</span>} title="Sin registros aún" />;
  } else {
    content = (
      <>
        {query.isError && !query.isFetchingNextPage ? (
          <p role="alert" className="notice notice--danger">
            <AlertIcon size="sm" />
            No pudimos actualizar el historial.
            <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
              Reintentar
            </Button>
          </p>
        ) : null}
        <ol className="coop-history" aria-label="Recolecciones por día">
          {days.map((day) => (
            <HistoryDay
              key={day.date}
              day={day}
              isAdmin={isAdmin}
              onVoid={(collection) => setToVoid({ collection, day: day.date })}
            />
          ))}
        </ol>
        {query.hasNextPage ? (
          <Button
            variant="secondary"
            fullWidth
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
          >
            Cargar más días
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <section className="coop-history-section" aria-labelledby="coop-history-title">
      <h2 id="coop-history-title" className="coop-section-title">
        Historial
      </h2>
      <Card>{content}</Card>
      {toVoid ? (
        <ConfirmDialog
          title="¿Eliminar este registro?"
          description={`${formatDayHeading(toVoid.day)} — ${toVoid.collection.employee?.displayName ?? 'Sin persona'}: ${eggsText(toVoid.collection.goodEggsCount, toVoid.collection.brokenEggsCount)}. Deja de contar en el gallinero; queda en la auditoría.`}
          confirmLabel="Eliminar"
          tone="danger"
          onCancel={() => setToVoid(null)}
          onConfirm={async () => {
            try {
              await voidEggCollection(toVoid.collection.id);
              setToVoid(null);
              invalidate();
            } catch (error) {
              if (isSessionExpired(error)) {
                setToVoid(null);
                onSessionExpired();
                return;
              }
              // Ya eliminada por otra persona: la vista se actualiza igual.
              if (error instanceof ApiError && error.status === 409) invalidate();
              throw new ApiError(
                error instanceof ApiError ? error.status : 0,
                errorMessageOf(error),
                error instanceof ApiError ? error.code : undefined,
              );
            }
          }}
        />
      ) : null}
    </section>
  );
}

/** Páginas de días completos: si una revalidación desplazó un día, nunca se duplica. */
function dedupeDays(days: EggCollectionDay[]): EggCollectionDay[] {
  const seen = new Set<string>();
  return days.filter((day) => (seen.has(day.date) ? false : (seen.add(day.date), true)));
}

interface HistoryDayProps {
  day: EggCollectionDay;
  isAdmin: boolean;
  onVoid: (collection: EggCollection) => void;
}

function HistoryDay({ day, isAdmin, onVoid }: HistoryDayProps) {
  const heading = formatDayHeading(day.date);
  return (
    <li className="coop-history__day">
      <div className="coop-history__header">
        <h3 className="coop-history__date">{heading}</h3>
        <div className="coop-history__totals">
          <span className="coop-history__good">
            <span aria-hidden="true">🥚 </span>
            <span className="visually-hidden">Buenos: </span>
            {day.goodEggs}
          </span>
          {day.brokenEggs > 0 ? (
            <span className="coop-history__broken">
              <span aria-hidden="true">💔 </span>
              <span className="visually-hidden">Rotos: </span>
              {day.brokenEggs}
            </span>
          ) : null}
          {day.layingRate !== null ? (
            <Badge
              tone={layingTone(day.layingRate)}
            >{`Postura ${formatRate(day.layingRate)}`}</Badge>
          ) : null}
        </div>
      </div>
      <ul className="coop-history__list">
        {day.collections.map((collection) => {
          const name = collection.employee?.displayName ?? '?';
          return (
            <li key={collection.id} className="coop-history__item">
              <div className="coop-history__row">
                {collection.employee ? (
                  <Avatar name={name} colorHex={collection.employee.colorHex} size="sm" />
                ) : null}
                <span className="coop-history__text">
                  {name} — {eggsText(collection.goodEggsCount, collection.brokenEggsCount)}
                </span>
                {isAdmin ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="coop-history__void"
                    aria-label={`Eliminar recolección de ${name} del ${heading}`}
                    onClick={() => onVoid(collection)}
                  >
                    <span aria-hidden="true">✕</span>
                  </Button>
                ) : null}
              </div>
              {collection.notes ? (
                <p className="coop-history__notes">
                  <span aria-hidden="true">📝 </span>
                  {collection.notes}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </li>
  );
}
