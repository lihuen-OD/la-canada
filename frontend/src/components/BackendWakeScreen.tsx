import { retryBackendNow } from '../connectivity/backendAvailability';
import {
  formatWaitTime,
  LONG_WAIT_MESSAGE,
  OFFLINE_TITLE,
  OFFLINE_WAKE_MESSAGE,
  RETRY_NOW_LABEL,
  WAKE_MESSAGE,
  WAKE_RETRYING,
  WAKE_TITLE,
} from '../connectivity/connectivityMessages';
import { useWakeNotice } from '../connectivity/useBackendAvailability';
import type { WakeNotice } from '../connectivity/useBackendAvailability';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';

interface BackendWakePanelProps {
  notice: WakeNotice;
  titleAs: 'h1' | 'h2';
}

/**
 * Contenido compartido del aviso de arranque en frío (Etapa 5R). La región
 * `aria-live` solo contiene el mensaje, que cambia en las transiciones
 * reales (iniciando → espera prolongada → sin conexión); el contador de
 * segundos queda fuera para no anunciarse cada medio segundo.
 */
function BackendWakePanel({ notice, titleAs: Title }: BackendWakePanelProps) {
  const { offline, longWait, elapsedSeconds, secondsToNextAttempt, snapshot } = notice;
  const message = offline
    ? `${OFFLINE_TITLE} ${OFFLINE_WAKE_MESSAGE}`
    : longWait
      ? LONG_WAIT_MESSAGE
      : WAKE_MESSAGE;
  const timing = offline
    ? 'Esperando la conexión a Internet.'
    : secondsToNextAttempt !== null
      ? `Esperando hace ${formatWaitTime(elapsedSeconds)} · Próximo intento en ${secondsToNextAttempt} s`
      : `Esperando hace ${formatWaitTime(elapsedSeconds)} · Intentando conectar…`;

  return (
    <div className="wake">
      <span className="wake__emoji" aria-hidden="true">
        🌿
      </span>
      <Title className="wake__title">{WAKE_TITLE}</Title>
      <div className="wake__message" role="status" aria-live="polite">
        <p>{message}</p>
      </div>
      <p className="wake__progress">
        {offline ? null : <Spinner size="sm" />}
        <span>{offline ? OFFLINE_TITLE : WAKE_RETRYING}</span>
      </p>
      <p className="wake__timing">{timing}</p>
      <div className="wake__actions">
        {offline ? null : (
          <Button variant="primary" onClick={retryBackendNow} disabled={snapshot.attemptInFlight}>
            {RETRY_NOW_LABEL}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Pantalla completa mientras el backend despierta en la carga inicial. Mismo
 * fondo verde bosque que el splash y el login: las transiciones no producen
 * saltos de color. Nunca manda al login ni borra la sesión.
 */
export function BackendWakeScreen({ notice }: { notice: WakeNotice }) {
  return (
    <main className="splash theme-inverse">
      <BackendWakePanel notice={notice} titleAs="h1" />
    </main>
  );
}

/** Versión dentro de la tarjeta del login, mientras se esperan las identidades. */
export function BackendWakeNotice() {
  const notice = useWakeNotice();
  return <BackendWakePanel notice={notice} titleAs="h2" />;
}
