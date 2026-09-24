import type { ReactNode } from 'react';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { AlertIcon, CloudOffIcon, SproutIcon } from './icons';

type HeadingTag = 'h1' | 'h2' | 'h3' | 'p';

interface StateMessageProps {
  icon?: ReactNode;
  title: ReactNode;
  titleAs?: HeadingTag;
  description?: ReactNode;
  actions?: ReactNode;
  role?: 'status' | 'alert';
  layout?: 'section' | 'page';
  tone?: 'default' | 'error';
}

/**
 * Base común de los estados vacío/error/acceso denegado: icono, título
 * breve, explicación y siguiente acción cuando exista.
 */
export function StateMessage({
  icon,
  title,
  titleAs: Title = 'h2',
  description,
  actions,
  role,
  layout = 'section',
  tone = 'default',
}: StateMessageProps) {
  const classes = [
    'state',
    layout === 'page' ? 'state--page' : null,
    tone === 'error' ? 'state--error' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} role={role}>
      {icon ? (
        <span className="state__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <Title className="state__title">{title}</Title>
      {description ? <p className="state__description">{description}</p> : null}
      {actions ? <div className="state__actions">{actions}</div> : null}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  titleAs?: HeadingTag;
  icon?: ReactNode;
}

/** Ausencia real de datos — distinta de una falla de carga (`ErrorState`). Nunca ofrece acciones falsas. */
export function EmptyState({ title, description, titleAs, icon }: EmptyStateProps) {
  return (
    <StateMessage
      icon={icon ?? <SproutIcon size="xl" />}
      title={title}
      titleAs={titleAs}
      description={description}
    />
  );
}

interface ErrorStateProps {
  title: string;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  titleAs?: HeadingTag;
  /** `connectivity`: icono de sin conexión; `generic`: alerta. */
  kind?: 'connectivity' | 'generic';
}

/** Falla recuperable — mensaje claro, nunca el error técnico crudo, y reintento real. */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = 'Reintentar',
  titleAs,
  kind = 'connectivity',
}: ErrorStateProps) {
  return (
    <StateMessage
      role="alert"
      tone="error"
      icon={kind === 'connectivity' ? <CloudOffIcon size="xl" /> : <AlertIcon size="xl" />}
      title={title}
      titleAs={titleAs}
      description={description}
      actions={
        onRetry ? (
          <Button variant="primary" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null
      }
    />
  );
}

interface LoadingStateProps {
  label: string;
}

/** Carga con contexto: el texto siempre acompaña al spinner y se anuncia por `aria-live`. */
export function LoadingState({ label }: LoadingStateProps) {
  return (
    <div className="state state--inline" role="status" aria-live="polite">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}
