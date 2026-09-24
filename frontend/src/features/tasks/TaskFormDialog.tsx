import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  CreateTaskRequest,
  TaskEmployee,
  TaskFrequency,
  TaskItem,
  UpdateTaskRequest,
} from '../../api/taskTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { errorMessageOf } from './dialogErrors';
import { FREQUENCY_LABEL, FREQUENCY_ORDER } from './taskLabels';
import { useSubmitGuard } from './useSubmitGuard';

const DESCRIPTION_MAX = 200;

/** Misma normalización que el backend (que igual vuelve a validar todo). */
function normalizeDescription(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function validateDescription(value: string): string | null {
  if (value.length < 3) return 'La descripción debe tener al menos 3 caracteres.';
  if (value.length > DESCRIPTION_MAX)
    return `La descripción no puede superar ${DESCRIPTION_MAX} caracteres.`;
  if (/[<>]/.test(value)) return 'La descripción no puede contener HTML.';
  return null;
}

interface TaskFormDialogProps {
  /** Sin `task`: creación. Con `task`: edición (solo se envían los campos que cambiaron). */
  task?: TaskItem;
  employees: TaskEmployee[];
  onCancel: () => void;
  onCreate: (body: CreateTaskRequest) => Promise<void>;
  onUpdate: (taskId: string, body: UpdateTaskRequest) => Promise<void>;
}

export function TaskFormDialog({
  task,
  employees,
  onCancel,
  onCreate,
  onUpdate,
}: TaskFormDialogProps) {
  const titleId = useId();
  const [description, setDescription] = useState(task?.description ?? '');
  const [employeeId, setEmployeeId] = useState(task?.assignee.id ?? '');
  const [frequency, setFrequency] = useState<TaskFrequency | ''>(task?.frequency ?? '');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { isSubmitting, run } = useSubmitGuard();
  const isEdit = task !== undefined;

  // Un responsable reasignado a alguien que ya no está activo sigue
  // apareciendo como opción actual (no se puede "perder" en el select), pero
  // el backend rechaza reasignar a un empleado inactivo.
  const options =
    task && !employees.some((employee) => employee.id === task.assignee.id)
      ? [...employees, task.assignee]
      : employees;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalized = normalizeDescription(description);
    const problem = validateDescription(normalized);
    if (problem) return setErrorMessage(problem);
    if (!employeeId) return setErrorMessage('Elegí un responsable.');
    if (!frequency) return setErrorMessage('Elegí una frecuencia.');

    void run(async () => {
      setErrorMessage(null);
      try {
        if (!task) {
          await onCreate({ description: normalized, employeeId, frequency });
          return;
        }
        const changes: UpdateTaskRequest = {};
        if (normalized !== task.description) changes.description = normalized;
        if (employeeId !== task.assignee.id) changes.employeeId = employeeId;
        if (frequency !== task.frequency) changes.frequency = frequency;
        if (Object.keys(changes).length === 0) {
          onCancel();
          return;
        }
        await onUpdate(task.id, changes);
      } catch (error) {
        setErrorMessage(errorMessageOf(error));
      }
    });
  }

  function handleCancel(): void {
    if (!isSubmitting) onCancel();
  }

  return (
    <Modal titleId={titleId} onRequestClose={handleCancel} closeDisabled={isSubmitting}>
      <form className="dialog" onSubmit={handleSubmit} noValidate>
        <h2 id={titleId} className="dialog__title">
          {isEdit ? 'Editar tarea' : 'Nueva tarea'}
        </h2>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-description`}>
            Descripción
          </label>
          <input
            id={`${titleId}-description`}
            className="field__input"
            type="text"
            maxLength={DESCRIPTION_MAX}
            autoComplete="off"
            value={description}
            disabled={isSubmitting}
            onChange={(event) => {
              setDescription(event.target.value);
              setErrorMessage(null);
            }}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-employee`}>
            Responsable
          </label>
          <select
            id={`${titleId}-employee`}
            className="field__input"
            value={employeeId}
            disabled={isSubmitting}
            onChange={(event) => {
              setEmployeeId(event.target.value);
              setErrorMessage(null);
            }}
          >
            <option value="">Elegí una persona</option>
            {options.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.displayName}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-frequency`}>
            Frecuencia
          </label>
          <select
            id={`${titleId}-frequency`}
            className="field__input"
            value={frequency}
            disabled={isSubmitting}
            onChange={(event) => {
              setFrequency(event.target.value as TaskFrequency | '');
              setErrorMessage(null);
            }}
          >
            <option value="">Elegí una frecuencia</option>
            {FREQUENCY_ORDER.map((value) => (
              <option key={value} value={value}>
                {FREQUENCY_LABEL[value]}
              </option>
            ))}
          </select>
        </div>

        <div aria-live="assertive" className="live-status live-status--start">
          {isSubmitting ? <span role="status">Guardando…</span> : null}
          {errorMessage ? (
            <span role="alert">
              <AlertIcon size="sm" />
              {errorMessage}
            </span>
          ) : null}
        </div>

        <div className="dialog__actions">
          <Button variant="secondary" onClick={handleCancel} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {isEdit ? 'Guardar cambios' : 'Crear tarea'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
