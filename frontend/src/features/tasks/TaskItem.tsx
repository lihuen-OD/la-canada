import type { TaskItem as TaskItemData } from '../../api/taskTypes';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { FREQUENCY_LABEL, FREQUENCY_TONE, formatCompletedAt } from './taskLabels';

interface TaskItemProps {
  task: TaskItemData;
  isAdmin: boolean;
  busy: boolean;
  timeZone: string;
  today: string;
  /** El prototipo muestra el responsable solo con el filtro "Todos". */
  showAssignee: boolean;
  onComplete: (task: TaskItemData) => void;
  onRevert: (task: TaskItemData) => void;
  onEdit: (task: TaskItemData) => void;
  onToggleActive: (task: TaskItemData) => void;
}

/**
 * Una tarea del período vigente, con la fila del prototipo (`.ti`): check
 * cuadrado, descripción, etiqueta de frecuencia y responsable, y a la
 * derecha ✏️/✕ para el ADMIN. El check NO es un toggle silencioso:
 * completar y deshacer son acciones distintas, con nombres accesibles
 * distintos, y deshacer abre siempre una confirmación.
 */
export function TaskItem({
  task,
  isAdmin,
  busy,
  timeZone,
  today,
  showAssignee,
  onComplete,
  onRevert,
  onEdit,
  onToggleActive,
}: TaskItemProps) {
  const execution = task.currentExecution;
  const done = execution !== null;
  const completedBy = execution?.completedByEmployee ?? null;
  const assignedDiffers =
    execution !== null && completedBy !== null && completedBy.id !== execution.assignedEmployee.id;

  let check;
  if (done && execution.canRevert) {
    check = (
      <button
        type="button"
        className="task-check task-check--done"
        aria-label={`Deshacer finalización: ${task.description}`}
        disabled={busy}
        onClick={() => onRevert(task)}
      >
        <span aria-hidden="true">✓</span>
      </button>
    );
  } else if (done) {
    check = (
      <span className="task-check task-check--done task-check--static">
        <span aria-hidden="true">✓</span>
        <span className="visually-hidden">Completada</span>
      </span>
    );
  } else {
    check = (
      <button
        type="button"
        className="task-check"
        aria-label={`Marcar como completada: ${task.description}`}
        disabled={busy || !task.canComplete}
        onClick={() => onComplete(task)}
      >
        <span aria-hidden="true" />
      </button>
    );
  }

  return (
    <li className={done ? 'task-item task-item--done' : 'task-item'} aria-busy={busy || undefined}>
      {check}
      <div className="task-item__body">
        <p className="task-item__description">{task.description}</p>
        <div className="task-item__meta">
          <Badge tone={FREQUENCY_TONE[task.frequency]}>{FREQUENCY_LABEL[task.frequency]}</Badge>
          {showAssignee ? (
            <span className="task-item__assignee">
              <span className="visually-hidden">Responsable: </span>
              {task.assignee.displayName}
            </span>
          ) : null}
          {!task.active ? <Badge tone="neutral">Desactivada</Badge> : null}
          {!done && task.active ? <span className="visually-hidden">Pendiente</span> : null}
          {done && completedBy ? (
            <span
              className={
                assignedDiffers
                  ? 'task-item__completion task-item__completion--covered'
                  : 'task-item__completion'
              }
            >
              <span aria-hidden="true">✓ </span>
              {assignedDiffers ? `Asignada a ${execution.assignedEmployee.displayName} · ` : ''}
              Completada por <strong>{completedBy.displayName}</strong>
              {execution.completedAt
                ? ` · ${formatCompletedAt(execution.completedAt, timeZone, today)}`
                : ''}
            </span>
          ) : null}
        </div>
      </div>
      {isAdmin ? (
        <div className="task-item__actions">
          <Button
            size="sm"
            variant="ghost"
            className="icon-button"
            aria-label={`Editar: ${task.description}`}
            title="Editar"
            onClick={() => onEdit(task)}
            disabled={busy}
          >
            <span aria-hidden="true">✏️</span>
          </Button>
          {task.active ? (
            <Button
              size="sm"
              variant="danger"
              className="icon-button"
              aria-label={`Desactivar: ${task.description}`}
              title="Desactivar"
              onClick={() => onToggleActive(task)}
              disabled={busy}
            >
              <span aria-hidden="true">✕</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onToggleActive(task)}
              disabled={busy}
            >
              Reactivar<span className="visually-hidden">: {task.description}</span>
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}
