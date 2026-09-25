import type { ReactNode } from 'react';
import { Spinner } from './Spinner';

interface PageHeaderProps {
  /** Único `<h1>` de la pantalla — el header del app shell no usa heading. */
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /**
   * Revalidación en segundo plano (Etapa 5P): los datos ya visibles se
   * conservan y solo aparece este indicador discreto junto al título. Su
   * espacio está siempre reservado — nunca provoca saltos de layout.
   */
  refreshing?: boolean;
}

export function PageHeader({ title, description, actions, refreshing }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <div className="page-header__title-row">
          <h1 className="page-header__title">{title}</h1>
          {refreshing !== undefined ? (
            <span
              className={`page-header__refreshing${refreshing ? ' is-active' : ''}`}
              role="status"
              aria-live="polite"
            >
              {refreshing ? (
                <>
                  <Spinner size="sm" />
                  <span>Actualizando…</span>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {actions}
    </header>
  );
}
