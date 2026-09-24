import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { TaskEmployee, TaskItem } from '../../api/taskTypes';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { errorMessageOf } from './dialogErrors';
import { useSubmitGuard } from './useSubmitGuard';

interface CompleteTaskDialogProps {
  task: TaskItem;
  /** Empleados ACTIVOS reales (`GET /tasks/employees`) — nunca una lista fija. */
  employees: TaskEmployee[];
  onCancel: () => void;
  onConfirm: (employeeId: string) => Promise<void>;
}

/**
 * Solo para ADMIN: registra qué empleado realizó la tarea. La elección es
 * explícita (sin preselección) y el backend vuelve a verificar que el
 * empleado exista y esté activo.
 */
export function CompleteTaskDialog({
  task,
  employees,
  onCancel,
  onConfirm,
}: CompleteTaskDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const [employeeId, setEmployeeId] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { isSubmitting, run } = useSubmitGuard();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!employeeId) {
      setErrorMessage('Elegí quién realizó la tarea.');
      return;
    }
    void run(async () => {
      setErrorMessage(null);
      try {
        await onConfirm(employeeId);
      } catch (error) {
        setErrorMessage(errorMessageOf(error));
      }
    });
  }

  function handleCancel(): void {
    if (!isSubmitting) onCancel();
  }

  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onRequestClose={handleCancel}
      closeDisabled={isSubmitting}
    >
      <form className="dialog" onSubmit={handleSubmit}>
        <h2 id={titleId} className="dialog__title">
          ✅ Registrar tarea completada
        </h2>
        <p id={descriptionId} className="dialog__description">
          «{task.description}» quedará registrada como realizada por la persona que elijas. En la
          auditoría figurás vos como quien la registró.
        </p>

        <fieldset className="choice-list" disabled={isSubmitting}>
          <legend className="field__label">¿Quién la realizó?</legend>
          {employees.map((employee) => (
            <label key={employee.id} className="choice">
              <input
                type="radio"
                name={`${titleId}-employee`}
                value={employee.id}
                checked={employeeId === employee.id}
                onChange={() => {
                  setEmployeeId(employee.id);
                  setErrorMessage(null);
                }}
              />
              <Avatar name={employee.displayName} colorHex={employee.colorHex} size="sm" />
              <span>{employee.displayName}</span>
              {employee.id === task.assignee.id ? (
                <span className="choice__hint">(responsable)</span>
              ) : null}
            </label>
          ))}
        </fieldset>

        <div aria-live="assertive" className="live-status live-status--start">
          {isSubmitting ? <span role="status">Registrando…</span> : null}
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
            Registrar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
