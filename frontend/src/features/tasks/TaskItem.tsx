import type { TaskItem as TaskItemData } from '../../api/taskTypes';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { FREQUENCY_EMOJI, FREQUENCY_LABEL, FREQUENCY_TONE, formatCompletedAt } from './taskLabels';

interface TaskItemProps {
  task: TaskItemData;
  isAdmin: boolean;
  busy: boolean;
  timeZone: string;
  today: string;
  onComplete: (task: TaskItemData) => void;
  onRevert: (task: TaskItemData) => void;
  onEdit: (task: TaskItemData) => void;
  onToggleActive: (task: TaskItemData) => void;
}

/**
 * Una tarea del período vigente. El check NO es un toggle silencioso:
 * completar y deshacer son acciones distintas, con nombres accesibles
 * distintos, y deshacer abre siempre una confirmación.
 */
export function TaskItem({
  task,
  isAdmin,
  busy,
  timeZone,
  today,
  onComplete,
  onRevert,
  onEdit,
  onToggleActive,
}: TaskItemProps) {
  const execution = task.currentExecution;
  const done = execution !== null;
  const emoji = FREQUENCY_EMOJI[task.frequency];
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
          <Badge tone={FREQUENCY_TONE[task.frequency]}>
            {emoji
              ? `${emoji} ${FREQUENCY_LABEL[task.frequency]}`
              : FREQUENCY_LABEL[task.frequency]}
          </Badge>
          <span className="task-item__assignee">
            <span aria-hidden="true">👤</span>
            <span className="visually-hidden">Responsable:</span>
            <Avatar name={task.assignee.displayName} colorHex={task.assignee.colorHex} size="sm" />
            {task.assignee.displayName}
          </span>
          {!task.active ? <Badge tone="neutral">Desactivada</Badge> : null}
          {!done && task.active ? <span className="visually-hidden">Pendiente</span> : null}
        </div>
        {done && completedBy ? (
          <p className="task-item__completion">
            {assignedDiffers ? `Asignada a ${execution.assignedEmployee.displayName} · ` : ''}
            Completada por <strong>{completedBy.displayName}</strong>
            {execution.completedAt
              ? ` · ${formatCompletedAt(execution.completedAt, timeZone, today)}`
              : ''}
          </p>
        ) : null}
        {isAdmin ? (
          <div className="task-item__actions">
            <Button size="sm" variant="ghost" onClick={() => onEdit(task)} disabled={busy}>
              Editar<span className="visually-hidden">: {task.description}</span>
            </Button>
            <Button
              size="sm"
              variant={task.active ? 'ghost' : 'secondary'}
              onClick={() => onToggleActive(task)}
              disabled={busy}
            >
              {task.active ? 'Desactivar' : 'Reactivar'}
              <span className="visually-hidden">: {task.description}</span>
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
