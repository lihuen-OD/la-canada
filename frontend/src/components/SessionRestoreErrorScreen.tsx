import { RATE_LIMITED_MESSAGE } from '../api/errorMessages';
import type { SessionIssue } from '../auth/authContext';
import {
  SESSION_UNCERTAIN_ACTION,
  SESSION_UNCERTAIN_MESSAGE,
  SESSION_UNCERTAIN_RETRY,
  SESSION_UNCERTAIN_TITLE,
} from '../connectivity/connectivityMessages';
import { Brand } from './ui/Brand';
import { Button } from './ui/Button';
import { ErrorState, StateMessage } from './ui/StateMessage';
import { AlertIcon } from './ui/icons';

interface SessionRestoreErrorScreenProps {
  issue?: SessionIssue | null;
  onRetry: () => void;
  /** Descarta localmente la sesión en duda y vuelve al selector (logout seguro). */
  onReenter: () => void;
}

/**
 * Se muestra únicamente cuando la restauración de sesión no pudo terminar por
 * un motivo que NO prueba que la sesión venció (eso es el estado normal
 * `anonymous` y va directo al selector de login). Nunca expone detalles
 * técnicos del error. Etapa 5R — tres variantes (ver `SessionIssue`):
 * temporal y límite de intentos ofrecen reintentar; un refresh en duda
 * ofrece reintentar (reenvía el mismo intento, que el backend reconoce sin
 * revocar nada) o volver a ingresar.
 */
export function SessionRestoreErrorScreen({
  issue = 'temporary',
  onRetry,
  onReenter,
}: SessionRestoreErrorScreenProps) {
  return (
    <main className="splash theme-inverse">
      <Brand as="h1" size="hero" />
      {issue === 'uncertain' ? (
        <StateMessage
          role="alert"
          tone="error"
          icon={<AlertIcon size="xl" />}
          title={SESSION_UNCERTAIN_TITLE}
          description={SESSION_UNCERTAIN_MESSAGE}
          actions={
            <>
              <Button variant="primary" onClick={onRetry}>
                {SESSION_UNCERTAIN_RETRY}
              </Button>
              <Button variant="secondary" onClick={onReenter}>
                {SESSION_UNCERTAIN_ACTION}
              </Button>
            </>
          }
        />
      ) : issue === 'rateLimited' ? (
        <ErrorState title={RATE_LIMITED_MESSAGE} kind="generic" onRetry={onRetry} />
      ) : (
        <ErrorState
          title="No pudimos conectarnos con el servidor para verificar tu sesión."
          description="Tu sesión no se cerró. Revisá tu conexión e intentá de nuevo."
          onRetry={onRetry}
        />
      )}
    </main>
  );
}
