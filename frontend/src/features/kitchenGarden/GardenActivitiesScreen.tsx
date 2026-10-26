import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  completeGardenActivity,
  createGardenActivity,
  fetchGardenActivities,
  fetchGardenParticipants,
  revertGardenCompletion,
  setGardenActivityActive,
  updateGardenActivity,
} from '../../api/kitchenGardenApi';
import type { GardenActivity } from '../../api/kitchenGardenTypes';
import { ApiError } from '../../api/httpClient';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import type { TaskExecution, TaskItem as TaskItemData } from '../../api/taskTypes';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon, CheckCircleIcon } from '../../components/ui/icons';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { CompleteTaskDialog } from '../tasks/CompleteTaskDialog';
import { errorMessageOf, isSessionExpired } from '../tasks/dialogErrors';
import { RevertTaskDialog } from '../tasks/RevertTaskDialog';
import { FrequencyFilterBar, PersonFilterBar, ScheduleFilterBar } from '../tasks/TaskFilters';
import type { FrequencyFilter, PersonFilter, ScheduleFilter } from '../tasks/TaskFilters';
import { TaskFormDialog } from '../tasks/TaskFormDialog';
import { TaskItem } from '../tasks/TaskItem';
import { AddParticipantDialog } from './AddParticipantDialog';
import { GARDEN_NOUN, toPerson, toTaskItem } from './gardenAdapters';
import { GARDEN_TITLE } from './gardenTitle';
import { KitchenGardenSubnav } from './KitchenGardenSubnav';
import { useGardenCache } from './useGardenCache';

type DialogState =
  | { type: 'none' }
  | { type: 'create' }
  | { type: 'edit'; task: TaskItemData }
  | { type: 'complete'; task: TaskItemData }
  | { type: 'revert'; activityId: string; description: string; execution: TaskExecution }
  | { type: 'toggle'; task: TaskItemData }
  | { type: 'addParticipant' };

type Notice = { tone: 'positive' | 'danger'; text: string } | null;

const STALE_DATA_NOTICE = 'No pudimos actualizar las actividades. Mostramos los últimos datos.';

/**
 * 🥬 Huerta → Actividades: la misma experiencia que 📋 Tareas (filtros por
 * persona y frecuencia, «Hoy»/«Vencidas» en «Una vez», orden y sugerencias,
 * completar y deshacer con confirmación) sobre los datos PROPIOS de la Huerta
 * (`/kitchen-garden/*`, `queryKeys.kitchenGarden`). Se piden solo al entrar al
 * módulo. Permisos: el backend decide; acá solo se ocultan acciones.
 */
export function GardenActivitiesScreen() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const { afterActivityChange, afterParticipantChange } = useGardenCache();
  const [showAll, setShowAll] = useState(false);
  const [person, setPerson] = useState<PersonFilter>('all');
  const [frequency, setFrequency] = useState<FrequencyFilter>('all');
  const [schedule, setSchedule] = useState<ScheduleFilter>('all');
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const [notice, setNotice] = useState<Notice>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const busyRef = useRef(new Set<string>());

  const status = showAll ? 'all' : 'active';
  const activitiesQuery = useQuery({
    queryKey: queryKeys.kitchenGarden.activities(userId, status),
    queryFn: () => fetchGardenActivities(status),
    enabled,
    placeholderData: keepPreviousData,
  });
  const participantsQuery = useQuery({
    queryKey: queryKeys.kitchenGarden.participants(userId),
    queryFn: fetchGardenParticipants,
    enabled,
    staleTime: STALE_TIME.catalog,
  });

  const endSession = useCallback(() => void logout(), [logout]);
  const expired =
    isSessionExpired(activitiesQuery.error) || isSessionExpired(participantsQuery.error);
  useEffect(() => {
    if (expired) endSession();
  }, [expired, endSession]);

  const activities = activitiesQuery.data?.activities;
  const participants = participantsQuery.data?.participants;
  const byId = useMemo(
    () => new Map((activities ?? []).map((activity) => [activity.id, activity])),
    [activities],
  );
  const activeParticipants = useMemo(
    () => (participants ?? []).filter((participant) => participant.active).map(toPerson),
    [participants],
  );
  const pendingByPerson = useMemo(() => {
    const counts = new Map<string, number>();
    for (const activity of activities ?? []) {
      if (
        activity.active &&
        !activity.currentExecution &&
        activity.scheduleStatus !== 'SCHEDULED'
      ) {
        counts.set(activity.responsible.id, (counts.get(activity.responsible.id) ?? 0) + 1);
      }
    }
    return counts;
  }, [activities]);

  const closeDialog = useCallback(() => setDialog({ type: 'none' }), []);
  const afterSuccess = useCallback(
    (text: string) => {
      closeDialog();
      setNotice({ tone: 'positive', text });
      afterActivityChange();
    },
    [closeDialog, afterActivityChange],
  );
  /** Errores dentro de un diálogo: sesión vencida → login; conflicto → refresca. */
  const rethrowForDialog = useCallback(
    (error: unknown): never => {
      if (isSessionExpired(error)) endSession();
      if (error instanceof ApiError && error.status === 409) afterActivityChange();
      throw error;
    },
    [endSession, afterActivityChange],
  );

  /** Un participante completa lo suyo sin diálogo: el backend usa su propia participación. */
  const completeOwn = useCallback(
    (task: TaskItemData) => {
      if (busyRef.current.has(task.id)) return;
      busyRef.current.add(task.id);
      setBusyIds(new Set(busyRef.current));
      setNotice(null);
      completeGardenActivity(task.id)
        .then(() => {
          setNotice({ tone: 'positive', text: `«${task.description}» quedó completada.` });
          afterActivityChange();
        })
        .catch((error: unknown) => {
          if (isSessionExpired(error)) return endSession();
          if (error instanceof ApiError && error.status === 409) afterActivityChange();
          setNotice({ tone: 'danger', text: errorMessageOf(error) });
        })
        .finally(() => {
          busyRef.current.delete(task.id);
          setBusyIds(new Set(busyRef.current));
        });
    },
    [afterActivityChange, endSession],
  );

  const header = (
    <PageHeader
      title={GARDEN_TITLE}
      actions={
        isAdmin && activeParticipants.length > 0 ? (
          <Button className="desktop-add" onClick={() => setDialog({ type: 'create' })}>
            + Nueva actividad
          </Button>
        ) : null
      }
      refreshing={Boolean(activities && participants) && activitiesQuery.isFetching}
    />
  );

  if (!activities || !participants) {
    const failed = activitiesQuery.isError || participantsQuery.isError;
    return (
      <div className="tasks garden">
        {header}
        <KitchenGardenSubnav />
        <Card>
          {failed ? (
            <ErrorState
              title="No pudimos cargar la Huerta."
              onRetry={() => {
                void activitiesQuery.refetch();
                void participantsQuery.refetch();
              }}
            />
          ) : (
            <LoadingState label="Cargando actividades…" />
          )}
        </Card>
      </div>
    );
  }

  const ofPerson = activities.filter(
    (activity) => person === 'all' || activity.responsible.id === person,
  );
  const scheduleFilter = frequency === 'ONE_TIME' ? schedule : 'all';
  const visible = ofPerson.filter(
    (activity) =>
      (frequency === 'all' || activity.frequency === frequency) &&
      (scheduleFilter === 'all' || activity.scheduleStatus === scheduleFilter),
  );
  const scheduleCounts = {
    DUE_TODAY: ofPerson.filter((activity) => activity.scheduleStatus === 'DUE_TODAY').length,
    OVERDUE: ofPerson.filter((activity) => activity.scheduleStatus === 'OVERDUE').length,
  };
  const timeZone = activitiesQuery.data!.period.timeZone;
  const today = activitiesQuery.data!.period.today;
  const noParticipants = participants.length === 0;

  let content;
  if (noParticipants && activities.length === 0) {
    content = (
      <>
        <EmptyState
          icon={<span aria-hidden="true">🥬</span>}
          title="Todavía no hay participantes en la Huerta."
          description={
            isAdmin
              ? 'Para empezar, agregá a las personas que trabajan en la Huerta. Después vas a poder crearles actividades.'
              : 'Un administrador agrega a las personas que participan y sus actividades.'
          }
        />
        {isAdmin ? (
          <div className="garden-empty-action">
            <Button onClick={() => setDialog({ type: 'addParticipant' })}>
              Agregar participante
            </Button>
          </div>
        ) : null}
      </>
    );
  } else if (activities.length === 0) {
    content = (
      <>
        <EmptyState
          icon={<span aria-hidden="true">🌱</span>}
          title="Todavía no hay actividades."
          description={
            isAdmin
              ? activeParticipants.length > 0
                ? 'Creá la primera con «Crear actividad».'
                : 'Primero reactivá o agregá un participante: cada actividad necesita un responsable.'
              : 'Un administrador las crea y asigna.'
          }
        />
        {isAdmin && activeParticipants.length > 0 ? (
          <div className="garden-empty-action">
            <Button onClick={() => setDialog({ type: 'create' })}>Crear actividad</Button>
          </div>
        ) : null}
      </>
    );
  } else if (visible.length === 0) {
    content = (
      <EmptyState
        icon={<span aria-hidden="true">🌱</span>}
        title="No hay actividades con estos filtros."
        description="Probá con otra persona o frecuencia."
      />
    );
  } else {
    content = (
      <ul className="task-list" role="list" aria-label="Actividades del período">
        {visible.map((activity) => (
          <TaskItem
            key={activity.id}
            task={toTaskItem(activity)}
            isAdmin={isAdmin}
            busy={busyIds.has(activity.id)}
            timeZone={timeZone}
            today={today}
            showAssignee={person === 'all'}
            onComplete={(target) =>
              isAdmin ? setDialog({ type: 'complete', task: target }) : completeOwn(target)
            }
            onRevert={(target) =>
              target.currentExecution
                ? setDialog({
                    type: 'revert',
                    activityId: target.id,
                    description: target.description,
                    execution: target.currentExecution,
                  })
                : undefined
            }
            onEdit={(target) => setDialog({ type: 'edit', task: target })}
            onToggleActive={(target) => setDialog({ type: 'toggle', task: target })}
          />
        ))}
      </ul>
    );
  }

  const target = (task: TaskItemData): GardenActivity | undefined => byId.get(task.id);

  return (
    <div className="tasks garden">
      {header}
      <KitchenGardenSubnav />

      <div aria-live="polite" className="tasks__notice">
        {activitiesQuery.isError ? (
          <p role="alert" className="notice notice--danger">
            <AlertIcon size="sm" />
            {STALE_DATA_NOTICE}
            <Button size="sm" variant="ghost" onClick={() => void activitiesQuery.refetch()}>
              Reintentar
            </Button>
          </p>
        ) : null}
        {notice ? (
          <p
            role={notice.tone === 'danger' ? 'alert' : 'status'}
            className={`notice notice--${notice.tone}`}
          >
            {notice.tone === 'danger' ? <AlertIcon size="sm" /> : <CheckCircleIcon size="sm" />}
            {notice.text}
          </p>
        ) : null}
      </div>

      {activities.length > 0 || activeParticipants.length > 0 ? (
        <div className="tasks__filters">
          {activeParticipants.length > 0 ? (
            <PersonFilterBar
              employees={activeParticipants}
              selected={person}
              pendingByEmployee={pendingByPerson}
              onSelect={setPerson}
            />
          ) : null}
          <FrequencyFilterBar
            selected={frequency}
            onSelect={(value) => {
              setFrequency(value);
              setSchedule('all');
            }}
          />
          {frequency === 'ONE_TIME' ? (
            <ScheduleFilterBar
              selected={schedule}
              counts={scheduleCounts}
              onSelect={setSchedule}
              noun={GARDEN_NOUN}
            />
          ) : null}
          {isAdmin ? (
            <label className="tasks__admin-toggle">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => setShowAll(event.target.checked)}
              />
              Incluir desactivadas y únicas ya completadas
            </label>
          ) : null}
        </div>
      ) : null}

      <Card className={activitiesQuery.isPlaceholderData ? 'is-stale' : undefined}>{content}</Card>

      {isAdmin && activeParticipants.length > 0 ? (
        <Button
          className="app-fab"
          aria-label="Nueva actividad"
          title="Nueva actividad"
          onClick={() => setDialog({ type: 'create' })}
        >
          ＋
        </Button>
      ) : null}

      {dialog.type === 'create' || dialog.type === 'edit' ? (
        <TaskFormDialog
          task={dialog.type === 'edit' ? dialog.task : undefined}
          employees={activeParticipants}
          noun={GARDEN_NOUN}
          onCancel={closeDialog}
          onCreate={async ({ employeeId, ...body }) => {
            await createGardenActivity({ ...body, participantId: employeeId }).catch(
              rethrowForDialog,
            );
            afterSuccess('Actividad creada.');
          }}
          onUpdate={async (activityId, { employeeId, ...body }) => {
            await updateGardenActivity(activityId, {
              ...body,
              ...(employeeId !== undefined ? { participantId: employeeId } : {}),
            }).catch(rethrowForDialog);
            afterSuccess('Actividad actualizada.');
          }}
        />
      ) : null}

      {dialog.type === 'complete' ? (
        <CompleteTaskDialog
          task={dialog.task}
          employees={activeParticipants}
          noun={GARDEN_NOUN}
          onCancel={closeDialog}
          onConfirm={async (participantId) => {
            await completeGardenActivity(dialog.task.id, participantId).catch(rethrowForDialog);
            afterSuccess(`«${dialog.task.description}» quedó completada.`);
          }}
        />
      ) : null}

      {dialog.type === 'revert' ? (
        <RevertTaskDialog
          description={dialog.description}
          execution={dialog.execution}
          reasonRequired={isAdmin}
          onCancel={closeDialog}
          onConfirm={async (reason) => {
            await revertGardenCompletion(dialog.activityId, dialog.execution.id, reason).catch(
              rethrowForDialog,
            );
            afterSuccess(`«${dialog.description}» volvió a quedar pendiente.`);
          }}
        />
      ) : null}

      {dialog.type === 'toggle' ? (
        <ConfirmDialog
          title={`${dialog.task.active ? 'Desactivar' : 'Reactivar'} «${dialog.task.description}»`}
          description={
            dialog.task.active
              ? 'La actividad deja de aparecer en el listado y no se puede completar. No se borra: su historial se conserva y podés reactivarla cuando quieras.'
              : target(dialog.task)?.responsible.active === false
                ? 'Su responsable ya no participa de la Huerta: reasignala (✏️) a un participante activo antes de reactivarla.'
                : 'La actividad vuelve a aparecer en el listado y se puede completar.'
          }
          confirmLabel={dialog.task.active ? 'Desactivar' : 'Reactivar'}
          tone={dialog.task.active ? 'danger' : 'default'}
          onCancel={closeDialog}
          onConfirm={async () => {
            await setGardenActivityActive(dialog.task.id, !dialog.task.active).catch(
              rethrowForDialog,
            );
            afterSuccess(dialog.task.active ? 'Actividad desactivada.' : 'Actividad reactivada.');
          }}
        />
      ) : null}

      {dialog.type === 'addParticipant' ? (
        <AddParticipantDialog
          onCancel={closeDialog}
          onAdded={(name) => {
            closeDialog();
            setNotice({ tone: 'positive', text: `${name} ya participa de la Huerta.` });
            afterParticipantChange();
          }}
          onSessionExpired={endSession}
        />
      ) : null}
    </div>
  );
}
