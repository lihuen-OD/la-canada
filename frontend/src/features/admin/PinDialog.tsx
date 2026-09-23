import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Modal } from '../../components/Modal';
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

  return (
    <Modal titleId={titleId} onRequestClose={handleCancel} closeDisabled={isSubmitting}>
      <form onSubmit={handleSubmit} className="pin-dialog">
        <h2 id={titleId} className="pin-dialog__title">
          {heading}
        </h2>

        {mode === 'reset' ? (
          <p className="pin-dialog__warning" role="note">
            Al cambiar el PIN se cerrarán todas las sesiones activas de esta persona.
            {isSelf ? ' Incluida tu propia sesión actual: volverás a la pantalla de login.' : ''}
          </p>
        ) : null}

        <div className="pin-dialog__field">
          <label htmlFor={`${titleId}-pin`}>PIN nuevo (4 dígitos)</label>
          <input
            id={`${titleId}-pin`}
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

        <div className="pin-dialog__field">
          <label htmlFor={`${titleId}-confirm`}>Confirmar PIN</label>
          <input
            id={`${titleId}-confirm`}
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

        <div aria-live="assertive" className="pin-dialog__status">
          {isSubmitting ? <span role="status">Guardando…</span> : null}
          {errorMessage ? <span role="alert">{errorMessage}</span> : null}
        </div>

        <div className="pin-dialog__actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            Cancelar
          </button>
          <button type="submit" className="button button--primary" disabled={isSubmitting}>
            {mode === 'activate' ? 'Activar' : 'Guardar PIN'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
