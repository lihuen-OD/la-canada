import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createAdminUser } from '../../api/adminApi';
import type { CreatedAdminResponse } from '../../api/adminTypes';
import { ApiError } from '../../api/httpClient';
import { NETWORK_ERROR_MESSAGE } from '../../api/errorMessages';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { PERSON_NAME_MAX, normalizePersonName, personNameError } from '../../utils/personName';

const PIN_PATTERN = /^\d{4}$/;

interface CreateAdminDialogProps {
  onCancel: () => void;
  onCreated: (user: CreatedAdminResponse['user']) => void;
}

/**
 * "＋ Nuevo administrador" (Etapa 5U): nombre visible + PIN de 4 dígitos +
 * confirmación. Mismas garantías que `PinDialog`: el PIN es siempre string
 * (ceros iniciales intactos), nunca se sugiere ni se genera, y ambos campos
 * se limpian al cancelar, al fallar, al completar y al desmontar. Un doble
 * clic genera una sola request (guarda síncrona + `Idempotency-Key`, cuya
 * huella nunca incluye el PIN). El rol, el estado y el username técnico los
 * decide el backend.
 */
export function CreateAdminDialog({ onCancel, onCreated }: CreateAdminDialogProps) {
  const titleId = useId();
  const [displayName, setDisplayName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const intent = useRef(new IdempotencyIntent());

  const clearPins = useCallback(() => {
    setPin('');
    setConfirmPin('');
  }, []);

  useEffect(() => clearPins, [clearPins]);

  const handleCancel = useCallback(() => {
    if (submittingRef.current) return;
    clearPins();
    intent.current.discard();
    onCancel();
  }, [clearPins, onCancel]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submittingRef.current) return;
    const nameProblem = personNameError(displayName);
    if (nameProblem) {
      setErrorMessage(nameProblem);
      return;
    }
    if (!PIN_PATTERN.test(pin)) {
      setErrorMessage('El PIN debe tener exactamente 4 dígitos.');
      return;
    }
    if (pin !== confirmPin) {
      setErrorMessage('El PIN y su confirmación no coinciden.');
      setConfirmPin('');
      return;
    }
    const name = normalizePersonName(displayName);
    submittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);
    // La huella de la intención identifica el formulario por el nombre: nunca incluye el PIN.
    const key = intent.current.keyFor(intentFingerprint('admin-create', { displayName: name }));
    createAdminUser({ displayName: name, pin }, key)
      .then((result) => {
        clearPins();
        intent.current.discard();
        onCreated(result.user);
      })
      .catch((error: unknown) => {
        clearPins();
        if (!(error instanceof ApiError && error.code === 'IDEMPOTENCY_RECORD_PENDING')) {
          intent.current.discard();
        }
        setErrorMessage(error instanceof ApiError ? error.message : NETWORK_ERROR_MESSAGE);
      })
      .finally(() => {
        submittingRef.current = false;
        setIsSubmitting(false);
      });
  }

  const pinInput = (id: string, label: string, value: string, set: (next: string) => void) => (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field__input field__input--pin"
        type="password"
        inputMode="numeric"
        pattern="\d*"
        maxLength={4}
        autoComplete="one-time-code"
        value={value}
        disabled={isSubmitting}
        onChange={(change) => {
          set(change.target.value.replace(/\D/g, '').slice(0, 4));
          setErrorMessage(null);
        }}
      />
    </div>
  );

  return (
    <Modal titleId={titleId} onRequestClose={handleCancel} closeDisabled={isSubmitting}>
      <form onSubmit={handleSubmit} className="dialog" noValidate>
        <h2 id={titleId} className="dialog__title">
          Nuevo administrador
        </h2>
        <p className="dialog__description">
          Va a poder ingresar con su nombre y este PIN, y administrar todo el sistema. No se crea
          como persona del equipo: no recibe tareas ni aparece en Desempeño.
        </p>
        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-name`}>
            Nombre visible
          </label>
          <input
            id={`${titleId}-name`}
            className="field__input"
            maxLength={PERSON_NAME_MAX}
            autoComplete="off"
            value={displayName}
            disabled={isSubmitting}
            onChange={(change) => {
              setDisplayName(change.target.value);
              setErrorMessage(null);
            }}
          />
        </div>
        {pinInput(`${titleId}-pin`, 'PIN (4 dígitos)', pin, setPin)}
        {pinInput(`${titleId}-confirm`, 'Confirmar PIN', confirmPin, setConfirmPin)}
        <div aria-live="assertive" className="live-status live-status--start">
          {isSubmitting ? <span role="status">Creando…</span> : null}
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
            Crear administrador
          </Button>
        </div>
      </form>
    </Modal>
  );
}
