import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from '../../components/Modal';
import { ApiError } from '../../api/httpClient';

const NETWORK_ERROR_MESSAGE = 'No se pudo conectar. Intentá de nuevo.';

export interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

/** Confirmación genérica para cambios de estado (suspender/reactivar/deshabilitar) — sin ningún dato sensible involucrado. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const titleId = useId();

  function handleCancel(): void {
    if (submittingRef.current) return;
    onCancel();
  }

  function handleConfirm(): void {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    onConfirm()
      .catch((error: unknown) => {
        setErrorMessage(error instanceof ApiError ? error.message : NETWORK_ERROR_MESSAGE);
      })
      .finally(() => {
        submittingRef.current = false;
        setIsSubmitting(false);
      });
  }

  return (
    <Modal titleId={titleId} onRequestClose={handleCancel} closeDisabled={isSubmitting}>
      <div className="confirm-dialog">
        <h2 id={titleId} className="confirm-dialog__title">
          {title}
        </h2>
        <p className="confirm-dialog__description">{description}</p>

        <div aria-live="assertive" className="confirm-dialog__status">
          {isSubmitting ? <span role="status">Aplicando…</span> : null}
          {errorMessage ? <span role="alert">{errorMessage}</span> : null}
        </div>

        <div className="confirm-dialog__actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={handleConfirm}
            disabled={isSubmitting}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
