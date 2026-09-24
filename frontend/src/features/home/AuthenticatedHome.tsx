import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { getRoleLabel, getUserDisplayName } from '../../auth/userDisplay';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { buttonClassName } from '../../components/ui/buttonStyles';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { CheckCircleIcon, UsersIcon } from '../../components/ui/icons';
import { APP_ROUTES } from '../../routes/navigation';
import { LogoutButton } from '../auth/LogoutButton';

/**
 * PANTALLA TEMPORAL — se reemplaza por el módulo Inicio real (KPI, tareas,
 * stock, eventos, novedades con datos reales) en una etapa posterior del
 * plan de migración (docs/MIGRATION_PLAN.md). Hasta entonces no muestra
 * métricas, tareas ni stock (ni reales ni de relleno): solo confirma la
 * sesión, ofrece el acceso administrativo a quien corresponde y el cierre
 * de sesión.
 */
export function AuthenticatedHome() {
  const { user } = useAuth();

  if (!user) {
    return null;
  }

  const displayName = getUserDisplayName(user);
  const roleLabel = getRoleLabel(user.role);
  const isAdmin = user.role === 'ADMIN';

  return (
    <div className="home">
      <PageHeader
        title={
          <>
            Hola, <span className="home__name">{displayName}</span>
          </>
        }
        description="Te damos la bienvenida a La Cañada."
      />

      <div className="home__grid">
        <Card title="Tu sesión">
          <div className="session-summary">
            <Avatar
              name={displayName}
              colorHex={user.employee?.colorHex}
              size="lg"
              variant={isAdmin && !user.employee ? 'admin' : 'person'}
            />
            <div className="session-summary__text">
              <span className="session-summary__name">{displayName}</span>
              {/* Sin persona vinculada, el nombre visible ya es "Administrador". */}
              {user.employee ? (
                <Badge tone={isAdmin ? 'earth' : 'neutral'}>{roleLabel}</Badge>
              ) : null}
            </div>
          </div>
          <p className="session-summary__status" role="status">
            <CheckCircleIcon />
            Sesión iniciada
          </p>
          <div className="home__card-actions">
            <LogoutButton />
          </div>
        </Card>

        {isAdmin ? (
          <Card title="Administración">
            <p className="home__card-text">
              Activá cuentas, asigná el PIN de cada persona y gestioná su estado de acceso.
            </p>
            <div className="home__card-actions">
              <Link to={APP_ROUTES.adminUsers.path} className={buttonClassName()}>
                <UsersIcon />
                Administrar usuarios
              </Link>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
