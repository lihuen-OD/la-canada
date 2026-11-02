import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/httpClient';
import {
  fetchGardenBatch,
  fetchGardenCrops,
  fetchGardenParticipants,
  setGardenBatchArchived,
} from '../../api/kitchenGardenApi';
import type {
  GardenBatchDetail,
  GardenBatchResponse,
  GardenCropRecord,
} from '../../api/kitchenGardenTypes';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { buttonClassName } from '../../components/ui/buttonStyles';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { ArrowLeftIcon, CheckCircleIcon } from '../../components/ui/icons';
import { formatDate } from '../../utils/dateFormat';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { errorMessageOf, isSessionExpired } from '../tasks/dialogErrors';
import { BatchEditDialog, TransplantPlanDialog, VoidRecordDialog } from './BatchDialogs';
import {
  METHOD_LABEL,
  RECORD_TYPE_ICON,
  RECORD_TYPE_LABEL,
  planLabel,
  quantityText,
} from './cropLabels';
import { GARDEN_TITLE } from './gardenTitle';
import { RecordEditDialog } from './RecordEditDialog';
import { TransplantDialog } from './TransplantDialog';
import { useGardenCache } from './useGardenCache';

type Dialog =
  | { type: 'none' }
  | { type: 'transplant' }
  | { type: 'edit' }
  | { type: 'plan' }
  | { type: 'archive' }
  | { type: 'correct'; record: GardenCropRecord }
  | { type: 'void'; record: GardenCropRecord };

/**
 * Ficha de una tanda (`/kitchen-garden/crops/:batchId`): cultivo, tanda,
 * variedad, observaciones, lo previsto para los trasplantes y el
 * seguimiento cronológico (siembra y trasplantes vigentes) con quién lo hizo
 * y quién lo registró. ADMIN y participantes activos registran trasplantes,
 * corrigen, anulan, editan la tanda, archivan y reabren; archivada, solo se
 * consulta hasta reabrirla. Recargable y compartible dentro de la app.
 */
export function GardenBatchScreen() {
  const { batchId = '' } = useParams();
  const { logout } = useAuth();
  const { userId, enabled } = useSessionScope();
  const { afterCropChange } = useGardenCache();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>({ type: 'none' });
  const [notice, setNotice] = useState<string | null>(null);
  const endSession = useCallback(() => void logout(), [logout]);

  const batchQuery = useQuery({
    queryKey: queryKeys.kitchenGarden.batch(userId, batchId),
    queryFn: () => fetchGardenBatch(batchId),
    enabled: enabled && batchId !== '',
    staleTime: STALE_TIME.operational,
  });
  const needsPeople = ['transplant', 'correct'].includes(dialog.type);
  const participantsQuery = useQuery({
    queryKey: queryKeys.kitchenGarden.participants(userId),
    queryFn: fetchGardenParticipants,
    enabled: enabled && needsPeople,
    staleTime: STALE_TIME.catalog,
  });
  const cropsQuery = useQuery({
    queryKey: queryKeys.kitchenGarden.crops(userId),
    queryFn: fetchGardenCrops,
    enabled: enabled && dialog.type === 'edit',
    staleTime: STALE_TIME.catalog,
  });
  const expired = [batchQuery.error, participantsQuery.error, cropsQuery.error].some(
    isSessionExpired,
  );
  useEffect(() => {
    if (expired) endSession();
  }, [expired, endSession]);

  const back = (
    <Link to="/kitchen-garden/crops" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
      <ArrowLeftIcon size="sm" /> Cultivos
    </Link>
  );
  const data = batchQuery.data;
  if (!data) {
    return (
      <div className="tasks garden">
        <PageHeader title={GARDEN_TITLE} actions={back} />
        {batchQuery.isError ? (
          <ErrorState
            title={
              batchQuery.error instanceof ApiError && batchQuery.error.status === 404
                ? 'Esta tanda no existe.'
                : 'No pudimos cargar la tanda.'
            }
            description={errorMessageOf(batchQuery.error)}
            onRetry={() => void batchQuery.refetch()}
          />
        ) : (
          <LoadingState label="Cargando tanda…" />
        )}
      </div>
    );
  }

  const { batch, viewer, today } = data;
  const writable = viewer.canRecord && !batch.archived && batch.sowing !== null;
  const plan = planLabel(batch.transplantPlan);
  const close = () => setDialog({ type: 'none' });
  /**
   * Tras guardar: la ficha muestra YA la tanda que confirmó el backend (su
   * respuesta, no una suposición), mientras la invalidación la vuelve a pedir
   * junto con el listado y Registros. Sin esto, con la latencia real, se
   * leería «Trasplante registrado» sobre los datos anteriores.
   */
  const saved = (text: string) => (fresh?: GardenBatchDetail) => {
    if (fresh) {
      queryClient.setQueryData<GardenBatchResponse>(
        queryKeys.kitchenGarden.batch(userId, batchId),
        (current) => (current ? { ...current, batch: fresh } : current),
      );
    }
    close();
    setNotice(text);
  };
  const records = [...(batch.sowing ? [batch.sowing] : []), ...batch.transplants];

  return (
    <div className="tasks garden">
      <PageHeader title={GARDEN_TITLE} actions={back} refreshing={batchQuery.isFetching} />

      <div aria-live="polite" className="tasks__notice">
        {notice ? (
          <p role="status" className="notice notice--positive">
            <CheckCircleIcon size="sm" />
            {notice}
          </p>
        ) : null}
      </div>

      <Card className="crop-batch">
        <div className="crop-batch__head">
          <h2 className="crop-batch__title">
            <span aria-hidden="true">🥕 </span>
            {batch.crop.name}
            <span className="crop-batch__name">{batch.name}</span>
          </h2>
          {batch.archived ? <Badge tone="neutral">Archivada</Badge> : null}
        </div>
        {batch.variety ? <p className="crop-batch__line">Variedad: {batch.variety}</p> : null}
        {batch.notes ? <p className="crop-batch__line">{batch.notes}</p> : null}
        <div className="crop-batch__plan">
          {plan ? <Badge tone={plan.tone}>{plan.text}</Badge> : null}
          {!batch.transplantPlan.pending && batch.transplantPlan.closedBy ? (
            <span className="crop-batch__line">
              Confirmado por {batch.transplantPlan.closedBy.displayName}
            </span>
          ) : null}
        </div>
        {batch.sowing === null ? (
          <p className="notice notice--warning" role="status">
            La siembra de esta tanda fue anulada: no admite registros nuevos. Se conserva en la
            auditoría.
          </p>
        ) : null}
        {batch.archived && viewer.canRecord ? (
          <p className="notice notice--info" role="status">
            Tanda archivada: se puede consultar. Reabrila para registrar o corregir.
          </p>
        ) : null}
        {viewer.canRecord && batch.sowing ? (
          <div className="crop-batch__actions" role="group" aria-label="Acciones de la tanda">
            {writable ? (
              <>
                <Button size="sm" onClick={() => setDialog({ type: 'transplant' })}>
                  <span aria-hidden="true">🪴 </span>Registrar trasplante
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setDialog({ type: 'plan' })}>
                  Trasplantes previstos
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'edit' })}>
                  Editar tanda
                </Button>
              </>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'archive' })}>
              {batch.archived ? 'Reabrir' : 'Archivar'}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card
        title={
          <>
            <span aria-hidden="true">📝 </span>Seguimiento
          </>
        }
      >
        {records.length === 0 ? (
          <p className="field__hint">Sin registros vigentes.</p>
        ) : (
          <ol className="crop-timeline" aria-label="Seguimiento de la tanda">
            {records.map((record) => (
              <TimelineItem
                key={record.id}
                record={record}
                writable={writable}
                onCorrect={() => setDialog({ type: 'correct', record })}
                onVoid={() => setDialog({ type: 'void', record })}
              />
            ))}
          </ol>
        )}
      </Card>

      {dialog.type === 'transplant' || dialog.type === 'correct' ? (
        participantsQuery.data ? (
          dialog.type === 'transplant' ? (
            <TransplantDialog
              batch={batch}
              today={today}
              viewer={viewer}
              participants={participantsQuery.data.participants}
              onClose={close}
              onSaved={saved('Trasplante registrado.')}
              onSessionExpired={endSession}
            />
          ) : (
            <RecordEditDialog
              batch={batch}
              record={dialog.record}
              today={today}
              participants={participantsQuery.data.participants}
              onClose={close}
              onSaved={saved('Registro corregido.')}
              onSessionExpired={endSession}
            />
          )
        ) : (
          <p role="status" className="field__hint">
            {participantsQuery.isError ? 'No pudimos abrir el formulario.' : 'Abriendo formulario…'}
          </p>
        )
      ) : null}
      {dialog.type === 'edit' && cropsQuery.data ? (
        <BatchEditDialog
          batch={batch}
          crops={cropsQuery.data.crops}
          onClose={close}
          onSaved={saved('Tanda actualizada.')}
          onSessionExpired={endSession}
        />
      ) : null}
      {dialog.type === 'plan' ? (
        <TransplantPlanDialog
          batch={batch}
          onClose={close}
          onSaved={saved('Trasplantes previstos actualizados.')}
          onSessionExpired={endSession}
        />
      ) : null}
      {dialog.type === 'void' ? (
        <VoidRecordDialog
          record={dialog.record}
          onClose={close}
          onVoided={() => {
            // El backend confirmó la anulación: deja de verse ya, antes de la recarga.
            const voidedId = dialog.record.id;
            queryClient.setQueryData<GardenBatchResponse>(
              queryKeys.kitchenGarden.batch(userId, batchId),
              (current) =>
                current
                  ? {
                      ...current,
                      batch: {
                        ...current.batch,
                        sowing: current.batch.sowing?.id === voidedId ? null : current.batch.sowing,
                        transplants: current.batch.transplants.filter(
                          (transplant) => transplant.id !== voidedId,
                        ),
                      },
                    }
                  : current,
            );
            saved(dialog.record.type === 'SOWING' ? 'Siembra anulada.' : 'Trasplante anulado.')();
          }}
          onSessionExpired={endSession}
        />
      ) : null}
      {dialog.type === 'archive' ? (
        <ArchiveDialog
          batch={batch}
          onCancel={close}
          onDone={(text, fresh) => {
            afterCropChange();
            saved(text)(fresh);
          }}
          onSessionExpired={endSession}
        />
      ) : null}
    </div>
  );
}

/** Un hecho del seguimiento: qué, cuándo, dónde, quién lo hizo y quién lo registró. */
function TimelineItem({
  record,
  writable,
  onCorrect,
  onVoid,
}: {
  record: GardenCropRecord;
  writable: boolean;
  onCorrect: () => void;
  onVoid: () => void;
}) {
  const quantity = quantityText(record.quantity, record.quantityUnit);
  const label = RECORD_TYPE_LABEL[record.type];
  return (
    <li className="crop-event">
      <div className="crop-event__head">
        <span className="crop-event__type">
          <span aria-hidden="true">{RECORD_TYPE_ICON[record.type]} </span>
          {label}
        </span>
        <span className="crop-event__date">{formatDate(record.performedOn)}</span>
        {record.method ? <Badge tone="earth">{METHOD_LABEL[record.method]}</Badge> : null}
      </div>
      <p className="crop-event__line">
        {record.type === 'TRANSPLANT' ? 'Destino: ' : 'Lugar: '}
        {record.location}
        {quantity ? ` · ${quantity}` : ''}
      </p>
      {record.notes ? <p className="crop-event__line">{record.notes}</p> : null}
      <p className="crop-event__people">
        Lo hizo <strong>{record.performedBy.displayName}</strong> · registró{' '}
        {record.recordedBy.displayName}
      </p>
      {writable ? (
        <div className="crop-event__actions">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCorrect}
            aria-label={`Corregir ${label.toLowerCase()} del ${formatDate(record.performedOn)}`}
          >
            Corregir
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onVoid}
            aria-label={`Anular ${label.toLowerCase()} del ${formatDate(record.performedOn)}`}
          >
            Anular
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** Archivar o reabrir: confirmación explícita; nada se borra. */
function ArchiveDialog({
  batch,
  onCancel,
  onDone,
  onSessionExpired,
}: {
  batch: GardenBatchDetail;
  onCancel: () => void;
  onDone: (text: string, fresh: GardenBatchDetail) => void;
  onSessionExpired: () => void;
}) {
  const archiving = !batch.archived;
  return (
    <ConfirmDialog
      title={archiving ? `¿Archivar «${batch.name}»?` : `¿Reabrir «${batch.name}»?`}
      description={
        archiving
          ? 'Sale de las tandas activas y se consulta en Archivadas. Para registrar o corregir hay que reabrirla. No se borra nada.'
          : 'Vuelve a las tandas activas y admite registros y correcciones.'
      }
      confirmLabel={archiving ? 'Archivar' : 'Reabrir'}
      onCancel={onCancel}
      onConfirm={async () => {
        let fresh: GardenBatchDetail;
        try {
          fresh = (await setGardenBatchArchived(batch.id, archiving)).batch;
        } catch (caught) {
          if (isSessionExpired(caught)) {
            onCancel();
            onSessionExpired();
            return;
          }
          throw caught;
        }
        onDone(archiving ? 'Tanda archivada.' : 'Tanda reabierta.', fresh);
      }}
    />
  );
}
