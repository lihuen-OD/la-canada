import { Brand } from './ui/Brand';
import { ErrorState } from './ui/StateMessage';

interface SessionRestoreErrorScreenProps {
  onRetry: () => void;
}

/**
 * Se muestra únicamente cuando la restauración de sesión falló por un
 * problema de conectividad real (no por "no había sesión", que es el
 * estado normal `anonymous` y va directo al selector de login). Nunca
 * expone detalles técnicos del error.
 */
export function SessionRestoreErrorScreen({ onRetry }: SessionRestoreErrorScreenProps) {
  return (
    <main className="splash theme-inverse">
      <Brand as="h1" size="hero" />
      <ErrorState
        title="No pudimos conectarnos con el servidor para verificar tu sesión."
        description="Revisá tu conexión e intentá de nuevo."
        onRetry={onRetry}
      />
    </main>
  );
}
