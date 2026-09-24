import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  completeTask,
  createTask,
  fetchTaskEmployees,
  fetchTasks,
  revertTaskCompletion,
  setTaskActive,
  updateTask,
} from '../../api/tasksApi';
import type {
  CreateTaskRequest,
  HistoryTask,
  TaskEmployee,
  TaskExecution,
  TaskItem as TaskItemData,
  TasksListResponse,
  UpdateTaskRequest,
} from '../../api/taskTypes';
import { ApiError } from '../../api/httpClient';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon, CheckCircleIcon } from '../../components/ui/icons';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { CompleteTaskDialog } from './CompleteTaskDialog';
import { errorMessageOf, isSessionExpired } from './dialogErrors';
import { RevertTaskDialog } from './RevertTaskDialog';
import { FrequencyFilterBar, PersonFilterBar } from './TaskFilters';
import type { FrequencyFilter, PersonFilter } from './TaskFilters';
import { TaskFormDialog } from './TaskFormDialog';
import { TaskHistory } from './TaskHistory';
import { TaskItem } from './TaskItem';
import { TasksSubnav } from './TasksSubnav';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; data: TasksListResponse; employees: TaskEmployee[] };

type DialogState =
  | { type: 'none' }
  | { type: 'create' }
  | { type: 'edit'; task: TaskItemData }
  | { type: 'complete'; task: TaskItemData }
  | { type: 'revert'; taskId: string; description: string; execution: TaskExecution }
  | { type: 'toggle'; task: TaskItemData };

type Notice = { tone: 'positive' | 'danger'; text: string } | null;

/**
 * ✅ Tareas — módulo operativo real (Etapa 4A). Consulta `GET /tasks` y
 * `GET /tasks/employees`; los filtros por persona y frecuencia se aplican
 * sobre la lista ya cargada (decenas de tareas: filtrado inmediato y
 * pendientes por persona sin requests extra). Sin actualizaciones
 * optimistas: cada operación espera la respuesta real y luego se vuelve a
 * pedir la lista. Permisos: el backend decide; la pantalla solo oculta lo
 * que un EMPLOYEE no puede hacer.
 */
export function TasksScreen() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [showAll, setShowAll] = useState(false);
  const [person, setPerson] = useState<PersonFilter>('all');
  const [frequency, setFrequency] = useState<FrequencyFilter>('all');
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const [notice, setNotice] = useState<Notice>(null);
  const [busyTaskIds, setBusyTaskIds] = useState<ReadonlySet<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const [historyKey, setHistoryKey] = useState(0);

  const handleSessionExpired = useCallback(() => {
    // Mismo cierre de sesión de siempre (AuthProvider): vuelve al login.
    void logout();
  }, [logout]);

  const load = useCallback(() => {
    Promise.all([fetchTasks(showAll ? 'all' : 'active'), fetchTaskEmployees()])
      .then(([data, employeesResponse]) =>
        setState({ status: 'loaded', data, employees: employeesResponse.employees }),
      )
      .catch((error: unknown) => {
        if (isSessionExpired(error)) handleSessionExpired();
        setState({ status: 'error' });
      });
  }, [showAll, handleSessionExpired]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => {
    load();
    setHistoryKey((key) => key + 1);
  }, [load]);

  const closeDialog = useCallback(() => setDialog({ type: 'none' }), []);

  /** Tras una mutación exitosa: aviso, cierre del diálogo y refresco en segundo plano. */
  const afterSuccess = useCallback(
    (text: string) => {
      closeDialog();
      setNotice({ tone: 'positive', text });
      refresh();
    },
    [closeDialog, refresh],
  );

  /** Errores dentro de un diálogo: sesión vencida → login; conflicto → refresca y lo explica. */
  const rethrowForDialog = useCallback(
    (error: unknown): never => {
      if (isSessionExpired(error)) handleSessionExpired();
      if (error instanceof ApiError && error.status === 409) refresh();
      throw error;
    },
    [handleSessionExpired, refresh],
  );

  /** Completar como EMPLOYEE: sin diálogo; el backend usa su propio empleado. */
  const completeAsEmployee = useCallback(
    (task: TaskItemData) => {
      if (busyRef.current.has(task.id)) return;
      busyRef.current.add(task.id);
      setBusyTaskIds(new Set(busyRef.current));
      setNotice(null);
      completeTask(task.id)
        .then(() => {
          setNotice({ tone: 'positive', text: `«${task.description}» quedó completada.` });
          refresh();
        })
        .catch((error: unknown) => {
          if (isSessionExpired(error)) return handleSessionExpired();
          if (error instanceof ApiError && error.status === 409) refresh();
          setNotice({ tone: 'danger', text: errorMessageOf(error) });
        })
        .finally(() => {
          busyRef.current.delete(task.id);
          setBusyTaskIds(new Set(busyRef.current));
        });
    },
    [refresh, handleSessionExpired],
  );

  const pendingByEmployee = useMemo(() => {
    const counts = new Map<string, number>();
    if (state.status !== 'loaded') return counts;
    for (const task of state.data.tasks) {
      if (task.active && !task.currentExecution) {
        counts.set(task.assignee.id, (counts.get(task.assignee.id) ?? 0) + 1);
      }
    }
    return counts;
  }, [state]);

  const header = (
    <PageHeader
      title={
        <>
          <span aria-hidden="true">✅ </span>Tareas
        </>
      }
      description="Lo que hay que hacer hoy, esta semana y este mes, y quién lo hizo."
      actions={
        isAdmin && state.status === 'loaded' ? (
          <Button onClick={() => setDialog({ type: 'create' })}>+ Nueva tarea</Button>
        ) : null
      }
    />
  );

  if (state.status === 'loading') {
    return (
      <div className="tasks">
        {header}
        <TasksSubnav active="tasks" />
        <Card>
          <LoadingState label="Cargando tareas…" />
        </Card>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="tasks">
        {header}
        <TasksSubnav active="tasks" />
        <Card>
          <ErrorState
            title="No pudimos cargar las tareas."
            onRetry={() => {
              setState({ status: 'loading' });
              load();
            }}
          />
        </Card>
      </div>
    );
  }

  const { data, employees } = state;
  const visible = data.tasks.filter(
    (task) =>
      (person === 'all' || task.assignee.id === person) &&
      (frequency === 'all' || task.frequency === frequency),
  );
  const personName =
    person === 'all'
      ? null
      : (employees.find((employee) => employee.id === person)?.displayName ?? null);

  return (
    <div className="tasks">
      {header}
      <TasksSubnav active="tasks" />

      <div aria-live="polite" className="tasks__notice">
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

      <div className="tasks__filters">
        <PersonFilterBar
          employees={employees}
          selected={person}
          pendingByEmployee={pendingByEmployee}
          onSelect={setPerson}
        />
        <FrequencyFilterBar selected={frequency} onSelect={setFrequency} />
        {isAdmin ? (
          <label className="tasks__admin-toggle">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(event) => {
                setShowAll(event.target.checked);
                setState({ status: 'loading' });
              }}
            />
            Incluir desactivadas y únicas ya completadas
          </label>
        ) : null}
      </div>

      <Card>
        {data.tasks.length === 0 ? (
          <EmptyState
            title="Todavía no hay tareas."
            description={isAdmin ? 'Creá la primera con «Nueva tarea».' : undefined}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No hay tareas con estos filtros."
            description="Probá con otra persona o frecuencia."
          />
        ) : (
          <ul className="task-list" role="list" aria-label="Tareas del período">
            {visible.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                isAdmin={isAdmin}
                busy={busyTaskIds.has(task.id)}
                timeZone={data.period.timeZone}
                today={data.period.today}
                onComplete={(target) =>
                  isAdmin
                    ? setDialog({ type: 'complete', task: target })
                    : completeAsEmployee(target)
                }
                onRevert={(target) =>
                  target.currentExecution
                    ? setDialog({
                        type: 'revert',
                        taskId: target.id,
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
        )}
      </Card>

      <TaskHistory
        currentWeekStart={data.period.weekStart}
        today={data.period.today}
        employeeId={person === 'all' ? null : person}
        employeeName={personName}
        refreshKey={historyKey}
        onSessionExpired={handleSessionExpired}
        onRevert={(task: HistoryTask, execution: TaskExecution) =>
          setDialog({ type: 'revert', taskId: task.id, description: task.description, execution })
        }
      />

      {dialog.type === 'create' || dialog.type === 'edit' ? (
        <TaskFormDialog
          task={dialog.type === 'edit' ? dialog.task : undefined}
          employees={employees}
          onCancel={closeDialog}
          onCreate={async (body: CreateTaskRequest) => {
            await createTask(body).catch(rethrowForDialog);
            afterSuccess('Tarea creada.');
          }}
          onUpdate={async (taskId: string, body: UpdateTaskRequest) => {
            await updateTask(taskId, body).catch(rethrowForDialog);
            afterSuccess('Tarea actualizada.');
          }}
        />
      ) : null}

      {dialog.type === 'complete' ? (
        <CompleteTaskDialog
          task={dialog.task}
          employees={employees}
          onCancel={closeDialog}
          onConfirm={async (employeeId) => {
            await completeTask(dialog.task.id, employeeId).catch(rethrowForDialog);
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
            await revertTaskCompletion(dialog.taskId, dialog.execution.id, reason).catch(
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
              ? 'La tarea deja de aparecer en el listado operativo y no se puede completar. No se borra: su historial se conserva y podés reactivarla cuando quieras.'
              : 'La tarea vuelve a aparecer en el listado operativo y se puede completar.'
          }
          confirmLabel={dialog.task.active ? 'Desactivar' : 'Reactivar'}
          tone={dialog.task.active ? 'danger' : 'default'}
          onCancel={closeDialog}
          onConfirm={async () => {
            await setTaskActive(dialog.task.id, !dialog.task.active).catch(rethrowForDialog);
            afterSuccess(dialog.task.active ? 'Tarea desactivada.' : 'Tarea reactivada.');
          }}
        />
      ) : null}
    </div>
  );
}
