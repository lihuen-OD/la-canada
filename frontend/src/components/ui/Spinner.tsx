interface SpinnerProps {
  size?: 'sm' | 'md';
}

/**
 * Indicador de actividad puramente decorativo — siempre acompañado de un
 * texto de estado visible (`LoadingState`, "Verificando…", etc.), nunca
 * aislado. Con `prefers-reduced-motion` queda estático (ver base.css).
 */
export function Spinner({ size = 'md' }: SpinnerProps) {
  return <span className={size === 'sm' ? 'spinner spinner--sm' : 'spinner'} aria-hidden="true" />;
}
