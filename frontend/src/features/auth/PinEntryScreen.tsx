import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { ApiError } from '../../api/httpClient';
import type { LoginOption } from '../../api/types';
import { PinPad } from './PinPad';

const PIN_LENGTH = 4;
const GENERIC_ERROR_MESSAGE = 'Identidad o PIN incorrectos.';
const NETWORK_ERROR_MESSAGE = 'No se pudo conectar. Intentá de nuevo.';

interface PinEntryScreenProps {
  option: LoginOption;
  onBack: () => void;
}

/**
 * El PIN vive únicamente acá, como state local de este componente — nunca
 * en el contexto de auth, nunca en `accessTokenStore`, nunca en la URL.
 * Se limpia ante error, al volver al selector, y al desmontar. Es siempre
 * un `string`: nunca se convierte a número en ningún punto (perdería un
 * cero inicial).
 */
export function PinEntryScreen({ option, onBack }: PinEntryScreenProps) {
  const { login } = useAuth();
  const [pin, setPin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const clearPin = useCallback(() => setPin(''), []);

  const handleBack = useCallback(() => {
    clearPin();
    onBack();
  }, [clearPin, onBack]);

  const submit = useCallback(
    (candidate: string) => {
      // Guarda contra doble envío real, no solo visual: el flag vive en un
      // ref (síncrono, no espera al próximo render como un `useState`),
      // así que una segunda invocación disparada en el mismo instante
      // (click + Enter casi simultáneos) no alcanza a colarse.
      if (submittingRef.current || candidate.length !== PIN_LENGTH) {
        return;
      }
      submittingRef.current = true;
      setIsSubmitting(true);
      setErrorMessage(null);

      login(option.id, candidate)
        .then(() => {
          // Éxito: se limpia igual, sin esperar al desmontaje (la
          // navegación la dispara `AppRoutes` al ver `status==='authenticated'`).
          clearPin();
        })
        .catch((error: unknown) => {
          clearPin();
          setErrorMessage(
            error instanceof ApiError ? GENERIC_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE,
          );
        })
        .finally(() => {
          submittingRef.current = false;
          setIsSubmitting(false);
        });
    },
    [login, option.id, clearPin],
  );

  const appendDigit = useCallback(
    (digit: string) => {
      // A propósito, sin el updater funcional de `setState`: llamar a
      // `submit` (un efecto real, no una operación pura) desde dentro de un
      // updater es justo el tipo de impureza que StrictMode ejecuta dos
      // veces para detectar — dispararía dos logins reales por cada dígito
      // que completa el PIN. `pin` viene del closure del render actual, por
      // eso está en las dependencias.
      if (isSubmitting || pin.length >= PIN_LENGTH) return;
      setErrorMessage(null);
      const next = pin + digit;
      setPin(next);
      if (next.length === PIN_LENGTH) {
        submit(next);
      }
    },
    [isSubmitting, pin, submit],
  );

  const removeLastDigit = useCallback(() => {
    if (isSubmitting) return;
    setPin((current) => current.slice(0, -1));
  }, [isSubmitting]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Desmontaje (cambio de identidad, navegación, etc.): nunca dejar el PIN
  // en memoria más tiempo del necesario.
  useEffect(() => clearPin, [clearPin]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (isSubmitting) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        appendDigit(event.key);
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        removeLastDigit();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        handleBack();
        return;
      }
      if (event.key === 'Enter' && pin.length === PIN_LENGTH) {
        event.preventDefault();
        submit(pin);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appendDigit, removeLastDigit, handleBack, submit, pin, isSubmitting]);

  return (
    <div className="pin-entry" ref={containerRef} tabIndex={-1}>
      <button type="button" className="pin-entry__back" onClick={handleBack}>
        ← Volver
      </button>

      <p className="pin-entry__name">{option.displayName}</p>
      <p className="pin-entry__instructions" id="pin-instructions">
        Ingresá tu PIN de 4 dígitos
      </p>

      <div
        className="pin-entry__dots"
        role="img"
        aria-label={`PIN: ${pin.length} de ${PIN_LENGTH} dígitos ingresados`}
      >
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            className={`pin-entry__dot${index < pin.length ? ' pin-entry__dot--filled' : ''}`}
            aria-hidden="true"
          />
        ))}
      </div>

      <div aria-live="assertive" className="pin-entry__status">
        {isSubmitting ? <span role="status">Verificando…</span> : null}
        {errorMessage ? <span role="alert">{errorMessage}</span> : null}
      </div>

      <PinPad
        onDigit={appendDigit}
        onBackspace={removeLastDigit}
        onClear={clearPin}
        disabled={isSubmitting}
      />
    </div>
  );
}
