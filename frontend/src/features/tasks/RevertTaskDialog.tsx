import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { TaskExecution } from '../../api/taskTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { errorMessageOf } from './dialogErrors';
import { useSubmitGuard } from './useSubmitGuard';

const REASON_MAX = 300;

interface RevertTaskDialogProps {
  description: string;
  execution: TaskExecution;
  /** El backend exige motivo cuando corrige un ADMIN; para un empleado es opcional. */
  reasonRequired: boolean;
  onCancel: () => void;
  onConfirm: (reason: string | undefined) => Promise<void>;
}

/** Deshacer nunca borra: la finalización queda marcada como revertida y auditada. */
export function RevertTaskDialog({
  description,
  execution,
  reasonRequired,
  onCancel,
  onConfirm,
}: RevertTaskDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const [reason, setReason] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { isSubmitting, run } = useSubmitGuard();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalized = reason.replace(/\s+/g, ' ').trim();
    if (reasonRequired && normalized.length < 3) {
      setErrorMessage('Indicá el motivo de la corrección (al menos 3 caracteres).');
      return;
    }
    if (normalized.length > 0 && normalized.length < 3) {
      setErrorMessage('El motivo debe tener al menos 3 caracteres.');
      return;
    }
    void run(async () => {
      setErrorMessage(null);
      try {
        await onConfirm(normalized || undefined);
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
          {reasonRequired ? 'Corregir finalización' : 'Deshacer finalización'}
        </h2>
        <p id={descriptionId} className="dialog__description">
          «{description}» volverá a quedar pendiente
          {execution.completedByEmployee
            ? ` (la había completado ${execution.completedByEmployee.displayName})`
            : ''}
          . No se borra nada: el cambio queda registrado en la auditoría.
        </p>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-reason`}>
            Motivo{reasonRequired ? '' : ' (opcional)'}
          </label>
          <textarea
            id={`${titleId}-reason`}
            className="field__input field__input--textarea"
            maxLength={REASON_MAX}
            rows={3}
            value={reason}
            disabled={isSubmitting}
            onChange={(event) => {
              setReason(event.target.value);
              setErrorMessage(null);
            }}
          />
        </div>

        <div aria-live="assertive" className="live-status live-status--start">
          {isSubmitting ? <span role="status">Aplicando…</span> : null}
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
          <Button type="submit" variant="danger" loading={isSubmitting}>
            {reasonRequired ? 'Corregir' : 'Deshacer'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
