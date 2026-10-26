import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchGardenParticipants, setGardenParticipantActive } from '../../api/kitchenGardenApi';
import type { GardenParticipant } from '../../api/kitchenGardenTypes';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { CheckCircleIcon } from '../../components/ui/icons';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { isSessionExpired } from '../tasks/dialogErrors';
import { AddParticipantDialog } from './AddParticipantDialog';
import { GARDEN_TITLE } from './gardenTitle';
import { KitchenGardenSubnav } from './KitchenGardenSubnav';
import { useGardenCache } from './useGardenCache';

type Dialog =
  { type: 'none' } | { type: 'add' } | { type: 'toggle'; participant: GardenParticipant };

/**
 * 🥬 Huerta → Participantes: quiénes participan (todos lo consultan); solo un
 * ADMIN agrega y desactiva/reactiva. Desactivar con actividades activas lo
 * rechaza el backend con un mensaje claro: nada se reasigna ni se borra solo.
 */
export function GardenParticipantsScreen() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const { afterParticipantChange } = useGardenCache();
  const [dialog, setDialog] = useState<Dialog>({ type: 'none' });
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: queryKeys.kitchenGarden.participants(userId),
    queryFn: fetchGardenParticipants,
    enabled,
    staleTime: STALE_TIME.catalog,
  });
  const endSession = useCallback(() => void logout(), [logout]);
  const expired = isSessionExpired(query.error);
  useEffect(() => {
    if (expired) endSession();
  }, [expired, endSession]);

  const participants = query.data?.participants;
  const close = () => setDialog({ type: 'none' });

  return (
    <div className="tasks garden">
      <PageHeader
        title={GARDEN_TITLE}
        actions={
          isAdmin && participants ? (
            <Button className="desktop-add" onClick={() => setDialog({ type: 'add' })}>
              + Agregar participante
            </Button>
          ) : null
        }
        refreshing={Boolean(participants) && query.isFetching}
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
      <Card
        title={
          <>
            <span aria-hidden="true">👥 </span>Participantes
          </>
        }
      >
        {!participants ? (
          query.isError ? (
            <ErrorState
              title="No pudimos cargar los participantes."
              onRetry={() => void query.refetch()}
            />
          ) : (
            <LoadingState label="Cargando participantes…" />
          )
        ) : participants.length === 0 ? (
          <>
            <EmptyState
              icon={<span aria-hidden="true">🥬</span>}
              title="Todavía no hay participantes en la Huerta."
              description={
                isAdmin
                  ? 'Agregá a las personas que trabajan en la Huerta: usuarios que ya existen en la app, empleados o administradores.'
                  : 'Un administrador agrega a las personas que participan.'
              }
            />
            {isAdmin ? (
              <div className="garden-empty-action">
                <Button onClick={() => setDialog({ type: 'add' })}>Agregar participante</Button>
              </div>
            ) : null}
          </>
        ) : (
          <ul className="garden-participants" aria-label="Participantes de la Huerta">
            {participants.map((participant) => (
              <li key={participant.id} className="garden-participant">
                <Avatar name={participant.displayName} colorHex={participant.colorHex} size="sm" />
                <span className="garden-participant__identity">
                  <strong>{participant.displayName}</strong>
                  <small>{participant.roleLabel}</small>
                </span>
                <span className="garden-participant__status">
                  <Badge tone={participant.active ? 'positive' : 'neutral'}>
                    {participant.active ? 'Activo' : 'Inactivo'}
                  </Badge>
                  {!participant.userActive ? <Badge tone="warning">Cuenta suspendida</Badge> : null}
                </span>
                {isAdmin ? (
                  <Button
                    size="sm"
                    variant={participant.active ? 'ghost' : 'secondary'}
                    onClick={() => setDialog({ type: 'toggle', participant })}
                  >
                    {participant.active ? 'Desactivar' : 'Reactivar'}
                    <span className="visually-hidden">: {participant.displayName}</span>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dialog.type === 'add' ? (
        <AddParticipantDialog
          onCancel={close}
          onAdded={(name) => {
            close();
            setNotice(`${name} ya participa de la Huerta.`);
            afterParticipantChange();
          }}
          onSessionExpired={endSession}
        />
      ) : null}

      {dialog.type === 'toggle' ? (
        <ConfirmDialog
          title={`${dialog.participant.active ? 'Desactivar' : 'Reactivar'} a ${dialog.participant.displayName}`}
          description={
            dialog.participant.active
              ? 'Deja de poder recibir y completar actividades de la Huerta. Sus actividades e historial se conservan. Si todavía tiene actividades activas, primero reasignalas o desactivalas.'
              : 'Vuelve a poder recibir y completar actividades de la Huerta.'
          }
          confirmLabel={dialog.participant.active ? 'Desactivar' : 'Reactivar'}
          tone={dialog.participant.active ? 'danger' : 'default'}
          onCancel={close}
          onConfirm={async () => {
            const { participant } = await setGardenParticipantActive(
              dialog.participant.id,
              !dialog.participant.active,
            );
            close();
            setNotice(
              `${participant.displayName} ${participant.active ? 'vuelve a participar' : 'ya no participa'} de la Huerta.`,
            );
            afterParticipantChange();
          }}
        />
      ) : null}
    </div>
  );
}
