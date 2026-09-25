import type { PropsWithChildren, ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { PageHeader } from '../../components/ui/PageHeader';

/**
 * Pestañas del módulo con los emojis del prototipo (decorativos,
 * `aria-hidden`; el nombre accesible es el texto). `NavLink` marca la activa
 * con `aria-current="page"`: navegación del router, nunca `<a href>`.
 */
export function StockSubnav() {
  const { user } = useAuth();
  const tabs = [
    { to: '/stock', end: true, emoji: '🏠', label: 'Casa' },
    { to: '/stock/garden', emoji: '🌿', label: 'Jardín' },
    { to: '/stock/purchases', emoji: '🛒', label: 'Compras' },
    { to: '/stock/reports', emoji: '📊', label: 'Reportes' },
    ...(user?.role === 'ADMIN' ? [{ to: '/stock/catalog', emoji: '⚙️', label: 'Catálogo' }] : []),
  ];
  return (
    <nav className="stock-subnav" aria-label="Secciones de Stock">
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end}>
          <span aria-hidden="true">{tab.emoji} </span>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

interface StockPageProps extends PropsWithChildren {
  description: ReactNode;
  /** Revalidación en segundo plano de la vista (datos visibles + "Actualizando…"). */
  refreshing?: boolean;
  actions?: ReactNode;
}

/** Encabezado 📦 Stock + subnavegación, comunes a todas las vistas del módulo. */
export function StockPage({ description, refreshing, actions, children }: StockPageProps) {
  return (
    <div className="stock">
      <PageHeader
        title={
          <>
            <span aria-hidden="true">📦 </span>Stock
          </>
        }
        description={description}
        refreshing={refreshing ?? false}
        actions={actions}
      />
      <StockSubnav />
      {children}
    </div>
  );
}
