import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchMoreSummary } from '../../api/moreApi';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { PageHeader } from '../../components/ui/PageHeader';
import { LogoutButton } from '../auth/LogoutButton';

interface Tile {
  to: string;
  icon: string;
  title: string;
  subtitle: string;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Grilla de ☰ Más del prototipo (`pg-mas`), mismo orden: Novedades, Eventos,
 * Clima, Fotos, Configuración (solo ADMIN) y Mi perfil (empleado), más
 * "Cerrar sesión". Los subtítulos salen de UNA request de conteos.
 */
export function MoreHome() {
  const { user } = useAuth();
  const { userId, enabled } = useSessionScope();
  const isAdmin = user?.role === 'ADMIN';
  const summary = useQuery({
    queryKey: queryKeys.more.summary(userId),
    queryFn: fetchMoreSummary,
    enabled,
  });
  const data = summary.data;
  const tiles: Tile[] = [
    {
      to: '/more/news',
      icon: '📝',
      title: 'Novedades',
      subtitle: data
        ? data.news.today > 0
          ? `${data.news.today} hoy`
          : `${data.news.total} total`
        : '—',
    },
    {
      to: '/more/events',
      icon: '📅',
      title: 'Eventos',
      subtitle: data ? plural(data.events.upcoming, 'próximo', 'próximos') : '—',
    },
    { to: '/more/weather', icon: '🌤️', title: 'Clima', subtitle: 'Villa Elisa, E.Ríos' },
    {
      to: '/more/photos',
      icon: '📸',
      title: 'Fotos',
      subtitle: data ? plural(data.photos.total, 'foto', 'fotos') : '—',
    },
    ...(isAdmin
      ? [{ to: '/more/settings', icon: '⚙️', title: 'Configuración', subtitle: 'Solo admin' }]
      : []),
    ...(!isAdmin && user?.employee
      ? [{ to: '/more/profile', icon: '👤', title: 'Mi perfil', subtitle: 'Mis datos' }]
      : []),
  ];

  return (
    <div className="more">
      <PageHeader title="Más" refreshing={Boolean(data) && summary.isFetching} />
      <ul className="more-grid" aria-label="Secciones">
        {tiles.map((tile) => (
          <li key={tile.to}>
            <Link to={tile.to} className="more-tile">
              <span className="more-tile__icon" aria-hidden="true">
                {tile.icon}
              </span>
              <span className="more-tile__title">{tile.title}</span>
              <span className="more-tile__subtitle">{tile.subtitle}</span>
            </Link>
          </li>
        ))}
      </ul>
      <LogoutButton className="more__logout" />
    </div>
  );
}
