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
    <main className="full-screen-status">
      <p className="full-screen-status__text" role="alert">
        No pudimos conectarnos con el servidor para verificar tu sesión.
      </p>
      <button type="button" className="button button--primary" onClick={onRetry}>
        Reintentar
      </button>
    </main>
  );
}
