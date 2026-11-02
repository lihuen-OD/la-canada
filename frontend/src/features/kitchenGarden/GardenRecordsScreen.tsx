import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  completeGardenActivity,
  fetchGardenActivities,
  fetchGardenParticipants,
  revertGardenCompletion,
  setGardenActivityActive,
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
import { Chip } from '../../components/ui/Chip';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon, CheckCircleIcon } from '../../components/ui/icons';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { CompleteTaskDialog } from '../tasks/CompleteTaskDialog';
import { errorMessageOf, isSessionExpired } from '../tasks/dialogErrors';
import { RevertTaskDialog } from '../tasks/RevertTaskDialog';
import { PersonFilterBar } from '../tasks/TaskFilters';
import type { PersonFilter } from '../tasks/TaskFilters';
import { TaskItem } from '../tasks/TaskItem';
import { AddParticipantDialog } from './AddParticipantDialog';
import { GARDEN_NOUN, toPerson, toTaskItem } from './gardenAdapters';
import { GardenRecordFormDialog } from './GardenRecordFormDialog';
import { GARDEN_TITLE } from './gardenTitle';
import { KitchenGardenSubnav } from './KitchenGardenSubnav';
import {
  AGENDA_SECTIONS,
  KIND_ICON,
  KIND_LABEL,
  KIND_ORDER,
  UNCLASSIFIED_LABEL,
  type KindFilter,
} from './recordLabels';
import { useGardenCache } from './useGardenCache';

type DialogState =
  | { type: 'none' }
  | { type: 'create' }
  | { type: 'edit'; activity: GardenActivity }
  | { type: 'complete'; task: TaskItemData }
  | { type: 'revert'; activityId: string; description: string; execution: TaskExecution }
  | { type: 'toggle'; task: TaskItemData }
  | { type: 'addParticipant' };

type Notice = { tone: 'positive' | 'danger'; text: string } | null;

const STALE_DATA_NOTICE = 'No pudimos actualizar los registros. Mostramos los últimos datos.';

/** Pendiente del período vigente: activa y sin ejecución vigente (las completadas van aparte). */
const isPending = (activity: GardenActivity) => activity.active && !activity.currentExecution;

/**
 * 🥬 Huerta → 📝 Registros: las actividades de siempre (mismos ids,
 * responsables, frecuencias, planificación y ejecuciones) con su tipo y
 * observaciones, agrupadas como las devuelve el backend: vencidas, para
 * hoy, próximas y sin fecha; las completadas del período, aparte (no cuentan
 * como pendientes). Resumen arriba y filtros por tipo y persona. Crear y
 * editar: ADMIN y participantes activos; desactivar: solo ADMIN; completar y
 * deshacer, las reglas de siempre. Datos propios (`/kitchen-garden/*`).
 */
export function GardenRecordsScreen() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const { afterActivityChange, afterParticipantChange } = useGardenCache();
  const [showAll, setShowAll] = useState(false);
  const [person, setPerson] = useState<PersonFilter>('all');
  const [kind, setKind] = useState<KindFilter>('all');
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
  const canWrite = activitiesQuery.data?.viewer?.canWrite ?? isAdmin;
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
      if (isPending(activity) && activity.agenda !== 'UPCOMING' && activity.agenda !== 'NO_DATE') {
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

  const canCreate = canWrite && activeParticipants.length > 0;
  const header = (
    <PageHeader
      title={GARDEN_TITLE}
      actions={
        canCreate ? (
          <Button className="desktop-add" onClick={() => setDialog({ type: 'create' })}>
            + Nuevo registro
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
            <LoadingState label="Cargando registros…" />
          )}
        </Card>
      </div>
    );
  }

  const period = activitiesQuery.data!.period;
  const ofPerson = activities.filter(
    (activity) => person === 'all' || activity.responsible.id === person,
  );
  const visible = ofPerson.filter(
    (activity) =>
      kind === 'all' || (kind === 'UNCLASSIFIED' ? activity.kind === null : activity.kind === kind),
  );
  const hasUnclassified = activities.some((activity) => activity.kind === null);
  const pending = visible.filter(isPending);
  const summary = {
    overdue: pending.filter((activity) => activity.agenda === 'OVERDUE').length,
    today: pending.filter((activity) => activity.agenda === 'TODAY').length,
    soon: pending.filter(
      (activity) =>
        activity.agenda === 'UPCOMING' &&
        activity.agendaDate !== null &&
        (!period.soonUntil || activity.agendaDate <= period.soonUntil),
    ).length,
  };
  const done = visible.filter((activity) => activity.active && activity.currentExecution);
  const inactive = visible.filter((activity) => !activity.active);
  const noParticipants = participants.length === 0;

  const renderItem = (activity: GardenActivity) => (
    <TaskItem
      key={activity.id}
      task={toTaskItem(activity)}
      isAdmin={isAdmin}
      canEdit={canWrite && (activity.active || isAdmin)}
      canToggleActive={isAdmin}
      busy={busyIds.has(activity.id)}
      timeZone={period.timeZone}
      today={period.today}
      showAssignee={person === 'all'}
      note={activity.notes}
      tags={
        activity.kind ? (
          <span className="garden-kind">
            <span aria-hidden="true">{KIND_ICON[activity.kind]} </span>
            {KIND_LABEL[activity.kind]}
          </span>
        ) : (
          <span className="garden-kind garden-kind--unclassified">{UNCLASSIFIED_LABEL}</span>
        )
      }
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
      onEdit={() => setDialog({ type: 'edit', activity })}
      onToggleActive={(target) => setDialog({ type: 'toggle', task: target })}
    />
  );

  const section = (title: string, icon: string, items: GardenActivity[], extra = '') =>
    items.length === 0 ? null : (
      <section className={`garden-section ${extra}`.trim()} key={title} aria-label={title}>
        <h2 className="garden-section__title">
          <span aria-hidden="true">{icon} </span>
          {title} <span className="garden-section__count">({items.length})</span>
        </h2>
        <ul className="task-list" role="list" aria-label={title}>
          {items.map(renderItem)}
        </ul>
      </section>
    );

  let content;
  if (noParticipants && activities.length === 0) {
    content = (
      <>
        <EmptyState
          icon={<span aria-hidden="true">🥬</span>}
          title="Todavía no hay participantes en la Huerta."
          description={
            isAdmin
              ? 'Para empezar, agregá a las personas que trabajan en la Huerta. Después vas a poder cargar registros.'
              : 'Un administrador agrega a las personas que participan.'
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
          title="Todavía no hay registros."
          description={
            canCreate
              ? 'Cargá la primera siembra, trasplante u otra actividad con «Crear registro».'
              : canWrite
                ? 'Primero tiene que haber un participante activo: cada registro necesita un responsable.'
                : 'Los participantes y los administradores cargan los registros.'
          }
        />
        {canCreate ? (
          <div className="garden-empty-action">
            <Button onClick={() => setDialog({ type: 'create' })}>Crear registro</Button>
          </div>
        ) : null}
      </>
    );
  } else if (visible.length === 0) {
    content = (
      <EmptyState
        icon={<span aria-hidden="true">🌱</span>}
        title="No hay registros con estos filtros."
        description="Probá con otro tipo o persona."
      />
    );
  } else {
    content = (
      <>
        {AGENDA_SECTIONS.map(({ agenda, title, icon }) =>
          section(
            title,
            icon,
            pending.filter((activity) => activity.agenda === agenda),
          ),
        )}
        {section('Completadas', '✅', done, 'garden-section--done')}
        {section('Desactivadas', '⏸️', inactive, 'garden-section--done')}
        {pending.length === 0 ? (
          <p className="garden-all-done" role="status">
            No quedan registros pendientes
            {person === 'all' && kind === 'all' ? '' : ' con estos filtros'}.
          </p>
        ) : null}
      </>
    );
  }

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

      {activities.length > 0 ? (
        <ul className="garden-summary" aria-label="Resumen de pendientes">
          <li
            className={
              summary.overdue > 0 ? 'garden-summary__item is-alert' : 'garden-summary__item'
            }
          >
            <strong>{summary.overdue}</strong> {summary.overdue === 1 ? 'vencida' : 'vencidas'}
          </li>
          <li className="garden-summary__item">
            <strong>{summary.today}</strong> para hoy
          </li>
          <li className="garden-summary__item">
            <strong>{summary.soon}</strong> en los próximos 7 días
          </li>
        </ul>
      ) : null}

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
          <div className="filter-scroller" role="group" aria-label="Filtrar por tipo">
            <Chip selected={kind === 'all'} onSelect={() => setKind('all')}>
              Todos
            </Chip>
            {KIND_ORDER.map((value) => (
              <Chip key={value} selected={kind === value} onSelect={() => setKind(value)}>
                {`${KIND_ICON[value]} ${KIND_LABEL[value]}`}
              </Chip>
            ))}
            {hasUnclassified || kind === 'UNCLASSIFIED' ? (
              <Chip selected={kind === 'UNCLASSIFIED'} onSelect={() => setKind('UNCLASSIFIED')}>
                {UNCLASSIFIED_LABEL}
              </Chip>
            ) : null}
          </div>
          {isAdmin ? (
            <label className="tasks__admin-toggle">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => setShowAll(event.target.checked)}
              />
              Incluir desactivados y únicos ya completados
            </label>
          ) : null}
        </div>
      ) : null}

      <Card className={activitiesQuery.isPlaceholderData ? 'is-stale' : undefined}>{content}</Card>

      {canCreate ? (
        <Button
          className="app-fab"
          aria-label="Nuevo registro"
          title="Nuevo registro"
          onClick={() => setDialog({ type: 'create' })}
        >
          ＋
        </Button>
      ) : null}

      {dialog.type === 'create' || dialog.type === 'edit' ? (
        <GardenRecordFormDialog
          activity={dialog.type === 'edit' ? dialog.activity : undefined}
          participants={activeParticipants}
          onCancel={closeDialog}
          onSessionExpired={endSession}
          onCreated={({ transplant }) =>
            afterSuccess(transplant ? 'Siembra y trasplante creados.' : 'Registro creado.')
          }
          onUpdated={() => afterSuccess('Registro actualizado.')}
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
              ? 'El registro deja de aparecer en el listado y no se puede completar. No se borra: su historial se conserva y podés reactivarlo cuando quieras.'
              : byId.get(dialog.task.id)?.responsible.active === false
                ? 'Su responsable ya no participa de la Huerta: reasignalo (✏️) a un participante activo antes de reactivarlo.'
                : 'El registro vuelve a aparecer en el listado y se puede completar.'
          }
          confirmLabel={dialog.task.active ? 'Desactivar' : 'Reactivar'}
          tone={dialog.task.active ? 'danger' : 'default'}
          onCancel={closeDialog}
          onConfirm={async () => {
            await setGardenActivityActive(dialog.task.id, !dialog.task.active).catch(
              rethrowForDialog,
            );
            afterSuccess(dialog.task.active ? 'Registro desactivado.' : 'Registro reactivado.');
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
