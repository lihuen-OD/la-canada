import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { classifyError } from '../../api/errorClassification';
import { RATE_LIMITED_MESSAGE, TEMPORARY_ERROR_MESSAGE } from '../../api/errorMessages';
import { ApiError } from '../../api/httpClient';
import {
  LOGIN_OFFLINE_MESSAGE,
  LOGIN_WAKING_MESSAGE,
} from '../../connectivity/connectivityMessages';
import type { LoginOption } from '../../api/types';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { AlertIcon, ArrowLeftIcon } from '../../components/ui/icons';
import { PinPad } from './PinPad';

const PIN_LENGTH = 4;
const GENERIC_ERROR_MESSAGE = 'Identidad o PIN incorrectos.';

/**
 * Identidad/PIN incorrectos, cuenta bloqueada o inactiva: el mismo mensaje
 * genérico (sin enumerar usuarios). El límite de intentos (429) y un servicio
 * caído (5xx) NO son "PIN incorrecto": se dice lo que realmente pasó.
 *
 * Etapa 5R: si el backend no respondió (red, timeout, Render despertando),
 * el login NO se reenvía solo — no se sabe si llegó — y se pide volver a
 * ingresar el PIN cuando el servidor termine de iniciar. El frontend nunca
 * cuenta intentos ni inventa un resultado.
 */
function loginErrorMessage(error: unknown): string {
  switch (classifyError(error)) {
    case 'rateLimit':
      return RATE_LIMITED_MESSAGE;
    case 'offline':
      return LOGIN_OFFLINE_MESSAGE;
    case 'backendUnavailable':
    case 'network':
    case 'timeout':
      return LOGIN_WAKING_MESSAGE;
    case 'server':
      return TEMPORARY_ERROR_MESSAGE;
    default:
      return error instanceof ApiError ? GENERIC_ERROR_MESSAGE : TEMPORARY_ERROR_MESSAGE;
  }
}

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
  const nameId = useId();
  const instructionsId = useId();

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
          setErrorMessage(loginErrorMessage(error));
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
    <div
      className="pin-entry"
      ref={containerRef}
      tabIndex={-1}
      aria-labelledby={nameId}
      aria-describedby={instructionsId}
      role="group"
    >
      <Button
        variant="ghost"
        className="pin-entry__back"
        icon={<ArrowLeftIcon />}
        onClick={handleBack}
      >
        Volver
      </Button>

      <div className="pin-entry__identity">
        <Avatar
          name={option.displayName}
          colorHex={option.colorHex}
          size="lg"
          variant={option.role === 'ADMIN' ? 'admin' : 'person'}
        />
        <p className="pin-entry__name" id={nameId}>
          {option.displayName}
        </p>
      </div>
      <p className="pin-entry__instructions" id={instructionsId}>
        Ingresá tu PIN de 4 dígitos
      </p>

      {/* Solo cantidad de dígitos, nunca su valor; todos los puntos se
          llenan igual para no permitir inferir qué tecla se usó. */}
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

      <div aria-live="assertive" className="live-status">
        {isSubmitting ? (
          <span role="status">
            <Spinner size="sm" />
            Verificando…
          </span>
        ) : null}
        {errorMessage ? (
          <span role="alert">
            <AlertIcon size="sm" />
            {errorMessage}
          </span>
        ) : null}
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
