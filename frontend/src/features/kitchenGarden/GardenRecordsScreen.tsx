import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  fetchGardenBatches,
  fetchGardenCropRecords,
  fetchGardenCrops,
  fetchGardenParticipants,
} from '../../api/kitchenGardenApi';
import type { GardenCropRecordFilters, GardenCropRecordType } from '../../api/kitchenGardenTypes';
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
import { METHOD_LABEL, RECORD_TYPE_ICON, RECORD_TYPE_LABEL, quantityText } from './cropLabels';
import { GARDEN_TITLE } from './gardenTitle';
import { KitchenGardenSubnav } from './KitchenGardenSubnav';

const PAGE_SIZE = 20;
/** Opciones de «Tanda» del cultivo elegido (todas sus tandas, también archivadas). */
const BATCH_OPTIONS_PAGE_SIZE = 50;

const TYPE_FILTERS: { value: GardenCropRecordType | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'SOWING', label: '🌱 Siembras' },
  { value: 'TRANSPLANT', label: '🪴 Trasplantes' },
];

/**
 * 🥬 Huerta → 📝 Registros: siembras y trasplantes vigentes de todas las
 * tandas, más recientes primero, con filtros por rango de fechas, cultivo,
 * tanda, tipo y persona. Filtros, orden y páginas en el backend («Ver más»);
 * cada fila lleva a la ficha de su tanda. Consulta para todos.
 */
export function GardenRecordsScreen() {
  const { logout } = useAuth();
  const { userId, enabled } = useSessionScope();
  const fieldId = useId();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cropId, setCropId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [type, setType] = useState<GardenCropRecordType | 'all'>('all');
  const [participantId, setParticipantId] = useState('');
  const endSession = useCallback(() => void logout(), [logout]);
  const invalidRange = Boolean(from && to && from > to);

  const filters: GardenCropRecordFilters = {
    from: from || undefined,
    to: to || undefined,
    cropId: cropId || undefined,
    batchId: batchId || undefined,
    type: type === 'all' ? undefined : type,
    participantId: participantId || undefined,
  };
  const recordsQuery = useInfiniteQuery({
    queryKey: queryKeys.kitchenGarden.cropRecords(userId, filters),
    queryFn: ({ pageParam }) =>
      fetchGardenCropRecords({ ...filters, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: enabled && !invalidRange,
    staleTime: STALE_TIME.operational,
    placeholderData: keepPreviousData,
  });
  const cropsQuery = useQuery({
    queryKey: queryKeys.kitchenGarden.crops(userId),
    queryFn: fetchGardenCrops,
    enabled,
    staleTime: STALE_TIME.catalog,
  });
  const batchesQuery = useQuery({
    queryKey: [...queryKeys.kitchenGarden.batches(userId, 'all', cropId), 'options'],
    queryFn: () =>
      fetchGardenBatches({ status: 'all', cropId, page: 1, pageSize: BATCH_OPTIONS_PAGE_SIZE }),
    enabled: enabled && cropId !== '',
    staleTime: STALE_TIME.operational,
  });
  const participantsQuery = useQuery({
    queryKey: queryKeys.kitchenGarden.participants(userId),
    queryFn: fetchGardenParticipants,
    enabled,
    staleTime: STALE_TIME.catalog,
  });
  const expired = [
    recordsQuery.error,
    cropsQuery.error,
    batchesQuery.error,
    participantsQuery.error,
  ].some(isSessionExpired);
  useEffect(() => {
    if (expired) endSession();
  }, [expired, endSession]);

  const first = recordsQuery.data?.pages[0];
  const seen = new Set<string>();
  const records = (recordsQuery.data?.pages.flatMap((page) => page.records) ?? []).filter(
    (record) => (seen.has(record.id) ? false : (seen.add(record.id), true)),
  );
  const hasFilters = Boolean(from || to || cropId || batchId || participantId) || type !== 'all';
  const field = (name: string) => `${fieldId}-${name}`;

  return (
    <div className="tasks garden">
      <PageHeader
        title={GARDEN_TITLE}
        refreshing={
          Boolean(recordsQuery.data) && recordsQuery.isFetching && !recordsQuery.isFetchingNextPage
        }
      />
      <KitchenGardenSubnav />

      <div className="filter-scroller" role="group" aria-label="Tipo de registro">
        {TYPE_FILTERS.map((option) => (
          <Chip
            key={option.value}
            selected={type === option.value}
            onSelect={() => setType(option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </div>
      <div className="crop-filters">
        <div className="field">
          <label className="field__label" htmlFor={field('from')}>
            Desde
          </label>
          <input
            id={field('from')}
            className="field__input"
            type="date"
            max={to || undefined}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
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
            min={from || undefined}
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={field('crop')}>
            Cultivo
          </label>
          <select
            id={field('crop')}
            className="field__input"
            value={cropId}
            onChange={(event) => {
              setCropId(event.target.value);
              setBatchId('');
            }}
          >
            <option value="">Todos</option>
            {(cropsQuery.data?.crops ?? []).map((crop) => (
              <option key={crop.id} value={crop.id}>
                {crop.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={field('batch')}>
            Tanda
          </label>
          <select
            id={field('batch')}
            className="field__input"
            value={batchId}
            disabled={!cropId}
            onChange={(event) => setBatchId(event.target.value)}
          >
            <option value="">{cropId ? 'Todas' : 'Elegí un cultivo'}</option>
            {(batchesQuery.data?.batches ?? []).map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.name}
                {batch.archived ? ' (archivada)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={field('person')}>
            Persona
          </label>
          <select
            id={field('person')}
            className="field__input"
            value={participantId}
            onChange={(event) => setParticipantId(event.target.value)}
          >
            <option value="">Todas</option>
            {(participantsQuery.data?.participants ?? []).map((participant) => (
              <option key={participant.id} value={participant.id}>
                {participant.displayName}
                {participant.active ? '' : ' (ya no participa)'}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Card>
        {invalidRange ? (
          <p role="alert" className="notice notice--warning">
            La fecha «Desde» no puede ser posterior a «Hasta».
          </p>
        ) : !first ? (
          recordsQuery.isError ? (
            <ErrorState
              title="No pudimos cargar los registros."
              onRetry={() => void recordsQuery.refetch()}
            />
          ) : (
            <LoadingState label="Cargando registros…" />
          )
        ) : records.length === 0 ? (
          <EmptyState
            icon={<span aria-hidden="true">📝</span>}
            title={hasFilters ? 'No hay registros con estos filtros.' : 'Todavía no hay registros.'}
            description={
              hasFilters
                ? 'Probá con otras fechas, cultivo, tipo o persona.'
                : 'Las siembras y los trasplantes que se registren en Cultivos aparecen acá.'
            }
          />
        ) : (
          <div className={recordsQuery.isPlaceholderData ? 'is-stale' : undefined}>
            <p className="crop-count" role="status">
              {first.total} {first.total === 1 ? 'registro' : 'registros'}
            </p>
            <ul className="crop-timeline" aria-label="Registros de cultivos">
              {records.map((record) => {
                const quantity = quantityText(record.quantity, record.quantityUnit);
                return (
                  <li key={record.id} className="crop-event">
                    <div className="crop-event__head">
                      <span className="crop-event__type">
                        <span aria-hidden="true">{RECORD_TYPE_ICON[record.type]} </span>
                        {RECORD_TYPE_LABEL[record.type]}
                      </span>
                      <span className="crop-event__date">{formatDate(record.performedOn)}</span>
                      {record.method ? (
                        <Badge tone="earth">{METHOD_LABEL[record.method]}</Badge>
                      ) : null}
                      {record.batch.archived ? <Badge tone="neutral">Archivada</Badge> : null}
                    </div>
                    <p className="crop-event__line">
                      <Link to={`/kitchen-garden/crops/${record.batch.id}`}>
                        {record.batch.crop.name} · {record.batch.name}
                      </Link>
                    </p>
                    <p className="crop-event__line">
                      {record.type === 'TRANSPLANT' ? 'Destino: ' : 'Lugar: '}
                      {record.location}
                      {quantity ? ` · ${quantity}` : ''}
                    </p>
                    <p className="crop-event__people">
                      Lo hizo <strong>{record.performedBy.displayName}</strong> · registró{' '}
                      {record.recordedBy.displayName}
                    </p>
                  </li>
                );
              })}
            </ul>
            {recordsQuery.hasNextPage ? (
              <Button
                variant="secondary"
                fullWidth
                loading={recordsQuery.isFetchingNextPage}
                onClick={() => void recordsQuery.fetchNextPage({ cancelRefetch: false })}
              >
                Ver más ({records.length} de {first.total})
              </Button>
            ) : null}
            {recordsQuery.isFetchNextPageError ? (
              <p role="alert" className="notice notice--warning">
                No pudimos cargar más registros. Lo ya cargado sigue acá.
              </p>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}
