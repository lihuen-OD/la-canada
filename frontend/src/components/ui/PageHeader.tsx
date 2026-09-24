import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Único `<h1>` de la pantalla — el header del app shell no usa heading. */
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <h1 className="page-header__title">{title}</h1>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {actions}
    </header>
  );
}
