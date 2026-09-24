import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { ApiError } from '../../api/httpClient';

const NETWORK_ERROR_MESSAGE = 'No se pudo conectar. Intentá de nuevo.';

export interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** `danger`: la acción corta el acceso de alguien (suspender/deshabilitar). Solo cambia la jerarquía visual. */
  tone?: 'default' | 'danger';
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

/** Confirmación genérica para cambios de estado (suspender/reactivar/deshabilitar) — sin ningún dato sensible involucrado. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  tone = 'default',
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

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
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onRequestClose={handleCancel}
      closeDisabled={isSubmitting}
    >
      <div className="dialog">
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        <p className="dialog__description" id={descriptionId}>
          {description}
        </p>

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
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={handleConfirm}
            loading={isSubmitting}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
