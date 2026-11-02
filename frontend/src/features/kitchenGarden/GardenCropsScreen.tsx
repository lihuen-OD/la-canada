import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  fetchGardenBatches,
  fetchGardenCrops,
  fetchGardenParticipants,
} from '../../api/kitchenGardenApi';
import type { GardenBatchSummary } from '../../api/kitchenGardenTypes';
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
import { formatDate } from '../../utils/dateFormat';
import { isSessionExpired } from '../tasks/dialogErrors';
import { METHOD_LABEL, planLabel } from './cropLabels';
import { GARDEN_TITLE } from './gardenTitle';
import { KitchenGardenSubnav } from './KitchenGardenSubnav';
import { SowingDialog } from './SowingDialog';

const PAGE_SIZE = 20;
type View = 'active' | 'archived';

/**
 * 🥬 Huerta → 🥕 Cultivos: las tandas (cada una, una siembra concreta) con su
 * cultivo, lugar, siembra y lo previsto para sus trasplantes. Primero las que
 * tienen un trasplante pendiente con fecha (la más antigua arriba), después
 * el resto; el orden y las etiquetas los decide el backend. Activas por
 * defecto y acceso a las archivadas; paginado con «Ver más». «Registrar
 * siembra»: ADMIN y participantes activos (lo dice el backend en `viewer`).
 */
export function GardenCropsScreen() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { userId, enabled } = useSessionScope();
  const [view, setView] = useState<View>('active');
  const [sowing, setSowing] = useState(false);
  const endSession = useCallback(() => void logout(), [logout]);

  const batchesQuery = useInfiniteQuery({
    queryKey: queryKeys.kitchenGarden.batches(userId, view, null),
    queryFn: ({ pageParam }) =>
      fetchGardenBatches({ status: view, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled,
    staleTime: STALE_TIME.operational,
    placeholderData: keepPreviousData,
  });
  const participantsQuery = useQuery({
    queryKey: queryKeys.kitchenGarden.participants(userId),
    queryFn: fetchGardenParticipants,
    enabled: enabled && sowing,
    staleTime: STALE_TIME.catalog,
  });
  const cropsQuery = useQuery({
    queryKey: queryKeys.kitchenGarden.crops(userId),
    queryFn: fetchGardenCrops,
    enabled: enabled && sowing,
    staleTime: STALE_TIME.catalog,
  });
  const expired = [batchesQuery.error, participantsQuery.error, cropsQuery.error].some(
    isSessionExpired,
  );
  useEffect(() => {
    if (expired) endSession();
  }, [expired, endSession]);

  const first = batchesQuery.data?.pages[0];
  const seen = new Set<string>();
  const batches = (batchesQuery.data?.pages.flatMap((page) => page.batches) ?? []).filter(
    (batch) => (seen.has(batch.id) ? false : (seen.add(batch.id), true)),
  );
  const canRecord = first?.viewer.canRecord ?? false;
  const activeParticipants = participantsQuery.data?.participants.filter(
    (participant) => participant.active,
  );
  const refreshing =
    Boolean(batchesQuery.data) && batchesQuery.isFetching && !batchesQuery.isFetchingNextPage;

  return (
    <div className="tasks garden">
      <PageHeader
        title={GARDEN_TITLE}
        refreshing={refreshing}
        actions={
          canRecord ? (
            <Button onClick={() => setSowing(true)}>
              <span aria-hidden="true">🌱 </span>Registrar siembra
            </Button>
          ) : null
        }
      />
      <KitchenGardenSubnav />

      <div className="filter-scroller" role="group" aria-label="Tandas">
        <Chip selected={view === 'active'} onSelect={() => setView('active')}>
          Activas
        </Chip>
        <Chip selected={view === 'archived'} onSelect={() => setView('archived')}>
          Archivadas
        </Chip>
      </div>

      <Card>
        {!first ? (
          batchesQuery.isError ? (
            <ErrorState
              title="No pudimos cargar los cultivos."
              onRetry={() => void batchesQuery.refetch()}
            />
          ) : (
            <LoadingState label="Cargando cultivos…" />
          )
        ) : batches.length === 0 ? (
          <>
            <EmptyState
              icon={<span aria-hidden="true">🥕</span>}
              title={
                view === 'active'
                  ? 'Todavía no hay cultivos registrados.'
                  : 'No hay tandas archivadas.'
              }
              description={
                view === 'active'
                  ? 'Cada siembra registrada aparece acá como una tanda, con su seguimiento.'
                  : 'Las tandas que se archiven se consultan acá.'
              }
            />
            {view === 'active' && canRecord ? (
              <div className="garden-empty-action">
                <Button onClick={() => setSowing(true)}>Registrar la primera siembra</Button>
              </div>
            ) : null}
          </>
        ) : (
          <div className={batchesQuery.isPlaceholderData ? 'is-stale' : undefined}>
            <p className="crop-count" role="status">
              {first.total} {first.total === 1 ? 'tanda' : 'tandas'}
            </p>
            <ul
              className="crop-list"
              aria-label={view === 'active' ? 'Tandas activas' : 'Tandas archivadas'}
            >
              {batches.map((batch) => (
                <BatchCard key={batch.id} batch={batch} />
              ))}
            </ul>
            {batchesQuery.hasNextPage ? (
              <Button
                variant="secondary"
                fullWidth
                loading={batchesQuery.isFetchingNextPage}
                onClick={() => void batchesQuery.fetchNextPage({ cancelRefetch: false })}
              >
                Ver más ({batches.length} de {first.total})
              </Button>
            ) : null}
          </div>
        )}
      </Card>

      {sowing && first ? (
        activeParticipants && cropsQuery.data ? (
          activeParticipants.length === 0 ? (
            <NoParticipantsNotice onClose={() => setSowing(false)} />
          ) : (
            <SowingDialog
              today={first.today}
              viewer={first.viewer}
              participants={activeParticipants}
              crops={cropsQuery.data.crops}
              onClose={() => setSowing(false)}
              onCreated={(batch) => {
                setSowing(false);
                void navigate(`/kitchen-garden/crops/${batch.id}`);
              }}
              onSessionExpired={endSession}
            />
          )
        ) : (
          <p role="status" className="field__hint">
            {participantsQuery.isError || cropsQuery.isError
              ? 'No pudimos abrir el formulario. Probá de nuevo.'
              : 'Abriendo formulario…'}
          </p>
        )
      ) : null}
    </div>
  );
}

/** Una tanda en el listado: enlace a su ficha con lo esencial y lo previsto. */
function BatchCard({ batch }: { batch: GardenBatchSummary }) {
  const plan = planLabel(batch.transplantPlan);
  return (
    <li>
      <Link to={`/kitchen-garden/crops/${batch.id}`} className="crop-card">
        <span className="crop-card__title">
          <strong>{batch.crop.name}</strong>
          <span>{batch.name}</span>
          {batch.variety ? <span className="crop-card__variety">{batch.variety}</span> : null}
        </span>
        {batch.sowing ? (
          <span className="crop-card__meta">
            <span aria-hidden="true">🌱 </span>
            Sembrada el {formatDate(batch.sowing.performedOn)} · {METHOD_LABEL[batch.sowing.method]}{' '}
            · {batch.sowing.location}
          </span>
        ) : null}
        <span className="crop-card__status">
          {plan ? <Badge tone={plan.tone}>{plan.text}</Badge> : null}
          {batch.transplantCount > 0 ? (
            <span className="crop-card__count">
              <span aria-hidden="true">🪴 </span>
              {batch.transplantCount} {batch.transplantCount === 1 ? 'trasplante' : 'trasplantes'}
            </span>
          ) : null}
          {batch.archived ? <Badge tone="neutral">Archivada</Badge> : null}
        </span>
      </Link>
    </li>
  );
}

/** Sin participantes activos no hay a quién atribuir una siembra: lo explica sin abrir el formulario. */
function NoParticipantsNotice({ onClose }: { onClose: () => void }) {
  return (
    <div className="notice notice--warning" role="alert">
      <span>
        Para registrar una siembra tiene que haber al menos un participante activo. Un administrador
        los agrega en Participantes.
      </span>
      <Button size="sm" variant="ghost" onClick={onClose}>
        Entendido
      </Button>
    </div>
  );
}
