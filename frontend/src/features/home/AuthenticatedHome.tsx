import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';

const ADMIN_FALLBACK_DISPLAY_NAME = 'Administrador';

/**
 * Punto de entrada temporal tras el login — NO es el dashboard definitivo.
 * No tiene métricas, tareas ni stock (ni reales ni de relleno): esos
 * módulos todavía no se migraron (ver docs/MIGRATION_PLAN.md, próximas
 * etapas). Su único trabajo es confirmar que la autenticación funciona de
 * punta a punta y ofrecer cerrar sesión.
 */
export function AuthenticatedHome() {
  const { user, logout } = useAuth();

  if (!user) {
    return null;
  }

  const displayName = user.employee?.displayName ?? ADMIN_FALLBACK_DISPLAY_NAME;

  return (
    <main className="authenticated-home">
      <h1 className="authenticated-home__title">La Cañada</h1>
      <p className="authenticated-home__welcome">
        Hola, <strong>{displayName}</strong>
      </p>
      <p className="authenticated-home__role">
        Rol: {user.role === 'ADMIN' ? 'Administrador' : 'Equipo'}
      </p>
      <p className="authenticated-home__status" role="status">
        Sesión iniciada
      </p>
      {user.role === 'ADMIN' ? (
        <Link to="/admin/users" className="authenticated-home__admin-link">
          Administrar usuarios
        </Link>
      ) : null}
      <button type="button" className="button button--secondary" onClick={() => void logout()}>
        Cerrar sesión
      </button>
    </main>
  );
}
