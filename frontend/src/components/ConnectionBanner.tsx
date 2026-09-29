import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { classifyError } from '../api/errorClassification';
import { retryUncertainRefresh } from '../auth/refreshCoordinator';
import { useAuth } from '../auth/useAuth';
import { retryBackendNow } from '../connectivity/backendAvailability';
import {
  LONG_WAIT_MESSAGE,
  OFFLINE_APP_MESSAGE,
  OFFLINE_TITLE,
  RECONNECTING_MESSAGE,
  RECOVERED_MESSAGE,
  RETRY_NOW_LABEL,
  SESSION_UNCERTAIN_ACTION,
  SESSION_UNCERTAIN_MESSAGE,
  SESSION_UNCERTAIN_RETRY,
  SESSION_UNCERTAIN_TITLE,
} from '../connectivity/connectivityMessages';
import { useRefreshRecovery, useWakeNotice } from '../connectivity/useBackendAvailability';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';

/** "Conexión restablecida" se retira sola después de este tiempo. */
export const RECOVERED_VISIBLE_MS = 4_000;

/**
 * Aviso discreto de conectividad dentro de la app (Etapa 5R). Flota sobre el
 * contenido (posición fija): aparecer o desaparecer no mueve el layout, no
 * desmonta la ruta y no reemplaza los datos visibles por un loader. Las dos
 * regiones vivas están siempre montadas para que los lectores de pantalla
 * anuncien cada cambio.
 */
export function ConnectionBanner() {
  const { logout } = useAuth();
  const notice = useWakeNotice();
  const recovery = useRefreshRecovery();
  const { status } = notice.snapshot;
  const [problemShown, setProblemShown] = useState(false);
  const [retryingSession, setRetryingSession] = useState(false);
  const queryClient = useQueryClient();

  /**
   * Reintento manual del refresh en duda: mismo intento, sin riesgo de
   * revocar sesiones. Si funciona, se revalida lo que quedó en error; si el
   * backend confirma que la sesión terminó (401), se vuelve al ingreso.
   */
  const retrySession = useCallback(() => {
    setRetryingSession(true);
    retryUncertainRefresh()
      .then(() =>
        queryClient.refetchQueries({
          type: 'active',
          predicate: (query) => query.state.status === 'error',
        }),
      )
      .catch((error: unknown) => {
        if (classifyError(error) === 'authentication') void logout();
      })
      .finally(() => setRetryingSession(false));
  }, [logout, queryClient]);

  // Se recuerda que hubo un aviso visible para confirmar la recuperación
  // (ajuste de estado durante el render, patrón documentado de React).
  if (notice.visible && !problemShown) setProblemShown(true);
  const recovered = problemShown && (status === 'online' || status === 'idle');

  useEffect(() => {
    if (!recovered) return undefined;
    const id = setTimeout(() => setProblemShown(false), RECOVERED_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [recovered]);

  let content = null;
  if (notice.visible && notice.offline) {
    content = (
      <div className="connection-banner connection-banner--offline theme-inverse">
        <span className="connection-banner__text">
          <strong>{OFFLINE_TITLE}</strong> {OFFLINE_APP_MESSAGE}
        </span>
      </div>
    );
  } else if (notice.visible) {
    content = (
      <div className="connection-banner theme-inverse">
        <Spinner size="sm" />
        <span className="connection-banner__text">
          {notice.longWait ? LONG_WAIT_MESSAGE : RECONNECTING_MESSAGE}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={retryBackendNow}
          disabled={notice.snapshot.attemptInFlight}
        >
          {RETRY_NOW_LABEL}
        </Button>
      </div>
    );
  } else if (recovered) {
    content = (
      <div className="connection-banner connection-banner--recovered theme-inverse">
        <span className="connection-banner__text">{RECOVERED_MESSAGE}</span>
      </div>
    );
  }

  return (
    <div className="connection-banner-region">
      <div role="alert" aria-live="assertive">
        {recovery === 'uncertain' ? (
          <div className="connection-banner connection-banner--alert theme-inverse">
            <span className="connection-banner__text">
              <strong>{SESSION_UNCERTAIN_TITLE}</strong> {SESSION_UNCERTAIN_MESSAGE}
            </span>
            <Button variant="primary" size="sm" onClick={retrySession} loading={retryingSession}>
              {SESSION_UNCERTAIN_RETRY}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void logout()}>
              {SESSION_UNCERTAIN_ACTION}
            </Button>
          </div>
        ) : null}
      </div>
      <div role="status" aria-live="polite">
        {recovery === 'uncertain' ? null : content}
      </div>
    </div>
  );
}
