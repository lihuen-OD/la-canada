import { useId } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';

interface CardProps extends PropsWithChildren {
  /** Con título, la tarjeta se vuelve una región con nombre (`<section aria-labelledby>`). */
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Superficie blanca con borde cálido, radio de 16px y sombra discreta. */
export function Card({ title, actions, className, children }: CardProps) {
  const titleId = useId();
  const classes = ['card', className].filter(Boolean).join(' ');

  if (title === undefined) {
    return (
      <div className={classes}>
        <div className="card__body">{children}</div>
      </div>
    );
  }

  return (
    <section className={classes} aria-labelledby={titleId}>
      <div className="card__header">
        <h2 id={titleId} className="card__title">
          {title}
        </h2>
        {actions}
      </div>
      <div className="card__body">{children}</div>
    </section>
  );
}
