import type { ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { getRoleLabel, getUserDisplayName } from '../auth/userDisplay';
import { Avatar } from '../components/ui/Avatar';
import { Brand } from '../components/ui/Brand';
import { HomeIcon, UsersIcon } from '../components/ui/icons';
import { LogoutButton } from '../features/auth/LogoutButton';
import { APP_ROUTES, getVisibleNavigation } from '../routes/navigation';
import type { NavIconName } from '../routes/navigation';

/** Emoji del prototipo — decorativo; el nombre accesible es siempre la etiqueta de texto. */
function TasksNavEmoji() {
  return (
    <span className="nav-emoji" aria-hidden="true">
      ✅
    </span>
  );
}

/** 📦 Stock — emoji del prototipo, decorativo (mismo patrón que TasksNavEmoji). */
function StockNavEmoji() {
  return (
    <span className="nav-emoji" aria-hidden="true">
      📦
    </span>
  );
}

/** 🐔 Gallinero — emoji del prototipo, decorativo. */
function ChickenCoopNavEmoji() {
  return (
    <span className="nav-emoji" aria-hidden="true">
      🐔
    </span>
  );
}

/** 🐾 Mascotas — emoji del prototipo, decorativo. */
function PetsNavEmoji() {
  return (
    <span className="nav-emoji" aria-hidden="true">
      🐾
    </span>
  );
}

/** ☰ Más — símbolo del prototipo, decorativo. */
function MoreNavEmoji() {
  return (
    <span className="nav-emoji" aria-hidden="true">
      ☰
    </span>
  );
}

const NAV_ICONS: Record<NavIconName, ComponentType<{ size?: 'lg' }>> = {
  home: HomeIcon,
  tasks: TasksNavEmoji,
  stock: StockNavEmoji,
  chickenCoop: ChickenCoopNavEmoji,
  pets: PetsNavEmoji,
  more: MoreNavEmoji,
  users: UsersIcon,
};

/**
 * Estructura visual del área autenticada: header verde bosque, navegación
 * inferior en móvil / sidebar de 210px en escritorio, y contenido con ancho
 * máximo legible. Se monta únicamente dentro de `ProtectedRoute`, así que
 * siempre hay un usuario autenticado. La navegación sale de
 * `routes/navigation.ts` filtrada por el rol real (`hasRole`, el usuario
 * devuelto por el backend) — nunca muestra destinos que no existen.
 */
export function AppShell() {
  const { user, hasRole } = useAuth();
  const { pathname } = useLocation();
  const items = getVisibleNavigation(hasRole);

  if (!user) {
    return null;
  }

  const displayName = getUserDisplayName(user);
  const isAdminAccount = user.role === 'ADMIN' && !user.employee;

  return (
    <div className="app-shell">
      <a href="#contenido" className="skip-link">
        Saltar al contenido
      </a>

      <header className="app-header theme-inverse">
        <Link
          to={APP_ROUTES.home.path}
          className="app-header__brand"
          aria-label="La Cañada, inicio"
        >
          <Brand />
        </Link>

        <div className="app-header__session">
          <div className="app-header__user">
            <Avatar
              name={displayName}
              colorHex={user.employee?.colorHex}
              size="sm"
              variant={isAdminAccount ? 'admin' : 'person'}
            />
            <span className="app-header__user-text">
              <span className="app-header__user-name">{displayName}</span>
              {/* Sin persona vinculada, el nombre ya es la etiqueta del rol. */}
              {user.employee ? (
                <span className="app-header__user-role">{getRoleLabel(user.role)}</span>
              ) : null}
            </span>
          </div>
          <LogoutButton
            variant="ghost"
            label={<span className="app-header__logout-label">Cerrar sesión</span>}
          />
        </div>
      </header>

      <nav className="app-nav theme-inverse" aria-label="Navegación principal">
        <ul className="app-nav__list">
          {items.map((item) => {
            const Icon = NAV_ICONS[item.icon];
            return (
              <li key={item.path} className="app-nav__item">
                {item.activeFor?.some((prefix) => pathname.startsWith(prefix)) ? (
                  <Link to={item.path} className="app-nav__link active" aria-current="page">
                    <Icon size="lg" />
                    <span>{item.label}</span>
                  </Link>
                ) : (
                  <NavLink
                    to={item.path}
                    end={item.path === APP_ROUTES.home.path}
                    className="app-nav__link"
                  >
                    <Icon size="lg" />
                    <span>{item.label}</span>
                  </NavLink>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <main id="contenido" className="app-main" tabIndex={-1}>
        <div className="app-main__inner">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
