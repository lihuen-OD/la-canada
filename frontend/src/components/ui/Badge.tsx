export type BadgeTone = 'positive' | 'warning' | 'danger' | 'info' | 'earth' | 'neutral';

interface BadgeProps {
  tone: BadgeTone;
  /** El texto es obligatorio: el color nunca es el único portador del significado. */
  children: string;
  /** Punto de color antes del texto — refuerzo visual para estados, nunca sustituto del texto. */
  dot?: boolean;
  className?: string;
}

export function Badge({ tone, children, dot = false, className }: BadgeProps) {
  return (
    <span className={['badge', `badge--${tone}`, className].filter(Boolean).join(' ')}>
      {dot ? <span className="badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
