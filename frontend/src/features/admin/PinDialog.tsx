import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { ApiError } from '../../api/httpClient';

const PIN_PATTERN = /^\d{4}$/;
const NETWORK_ERROR_MESSAGE = 'No se pudo conectar. Intentá de nuevo.';

export interface PinDialogProps {
  /** `activate`: usuario PENDING_ACTIVATION, primer PIN. `reset`: usuario ACTIVE, cambio de PIN. */
  mode: 'activate' | 'reset';
  targetDisplayName: string;
  /** Si el objetivo es el propio admin logueado — cambia la advertencia mostrada, nunca el flujo de envío en sí. */
  isSelf: boolean;
  onCancel: () => void;
  onSubmit: (pin: string) => Promise<void>;
}

/**
 * Componente reutilizable para activación y cambio de PIN — nunca pide ni
 * muestra el PIN anterior (no existe ningún campo para eso), nunca sugiere
 * o genera un PIN automáticamente. El PIN es siempre `string` (`inputMode`,
 * no `type="number"`) para preservar ceros iniciales sin conversión
 * alguna. Ambos campos se limpian al cancelar, al completar, al fallar, y
 * al desmontar — nunca quedan en un estado ni en un closure vivo más
 * tiempo del necesario.
 */
export function PinDialog({ mode, targetDisplayName, isSelf, onCancel, onSubmit }: PinDialogProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const titleId = useId();

  const clearFields = useCallback(() => {
    setPin('');
    setConfirmPin('');
  }, []);

  useEffect(() => clearFields, [clearFields]);

  const handleCancel = useCallback(() => {
    if (submittingRef.current) return;
    clearFields();
    onCancel();
  }, [clearFields, onCancel]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submittingRef.current) return;

    if (!PIN_PATTERN.test(pin)) {
      setErrorMessage('El PIN debe tener exactamente 4 dígitos.');
      return;
    }
    if (pin !== confirmPin) {
      setErrorMessage('El PIN y su confirmación no coinciden.');
      setConfirmPin('');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    onSubmit(pin)
      .then(() => {
        clearFields();
      })
      .catch((error: unknown) => {
        clearFields();
        setErrorMessage(error instanceof ApiError ? error.message : NETWORK_ERROR_MESSAGE);
      })
      .finally(() => {
        submittingRef.current = false;
        setIsSubmitting(false);
      });
  }

  const heading =
    mode === 'activate' ? `Activar a ${targetDisplayName}` : `Cambiar PIN de ${targetDisplayName}`;

  const warningId = `${titleId}-warning`;

  return (
    <Modal
      titleId={titleId}
      descriptionId={mode === 'reset' ? warningId : undefined}
      onRequestClose={handleCancel}
      closeDisabled={isSubmitting}
    >
      <form onSubmit={handleSubmit} className="dialog">
        <h2 id={titleId} className="dialog__title">
          {heading}
        </h2>

        {mode === 'reset' ? (
          <p className="notice notice--warning" role="note" id={warningId}>
            <AlertIcon size="sm" />
            <span>
              Al cambiar el PIN se cerrarán todas las sesiones activas de esta persona.
              {isSelf ? ' Incluida tu propia sesión actual: volverás a la pantalla de login.' : ''}
            </span>
          </p>
        ) : null}

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-pin`}>
            PIN nuevo (4 dígitos)
          </label>
          <input
            id={`${titleId}-pin`}
            className="field__input field__input--pin"
            type="password"
            inputMode="numeric"
            pattern="\d*"
            maxLength={4}
            autoComplete="one-time-code"
            value={pin}
            disabled={isSubmitting}
            onChange={(event) => {
              const next = event.target.value.replace(/\D/g, '').slice(0, 4);
              setPin(next);
              setErrorMessage(null);
            }}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-confirm`}>
            Confirmar PIN
          </label>
          <input
            id={`${titleId}-confirm`}
            className="field__input field__input--pin"
            type="password"
            inputMode="numeric"
            pattern="\d*"
            maxLength={4}
            autoComplete="one-time-code"
            value={confirmPin}
            disabled={isSubmitting}
            onChange={(event) => {
              const next = event.target.value.replace(/\D/g, '').slice(0, 4);
              setConfirmPin(next);
              setErrorMessage(null);
            }}
          />
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
            {mode === 'activate' ? 'Activar' : 'Guardar PIN'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
