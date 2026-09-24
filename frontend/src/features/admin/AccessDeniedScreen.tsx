import { Link } from 'react-router-dom';
import { buttonClassName } from '../../components/ui/buttonStyles';
import { StateMessage } from '../../components/ui/StateMessage';
import { ArrowLeftIcon, LockIcon } from '../../components/ui/icons';
import { APP_ROUTES } from '../../routes/navigation';

/**
 * Fallback de `RequireRole` para rutas admin-only — se muestra a cualquier
 * usuario autenticado que no tenga el rol requerido (hoy, `EMPLOYEE`),
 * dentro del app shell (solo existe detrás de `ProtectedRoute`). El backend
 * también rechaza estas rutas de forma independiente (`requireRole`, 403);
 * esta pantalla solo evita mostrar contenido administrativo, nunca reemplaza
 * esa verificación real. Sin detalles técnicos: no nombra la ruta ni el rol
 * exigido.
 */
export function AccessDeniedScreen() {
  return (
    <StateMessage
      role="alert"
      layout="page"
      icon={<LockIcon size="xl" />}
      titleAs="h1"
      title="Acceso restringido"
      description="No tenés permisos para ver esta sección. Si necesitás entrar, pedíselo a un administrador."
      actions={
        <Link to={APP_ROUTES.home.path} className={buttonClassName({ variant: 'secondary' })}>
          <ArrowLeftIcon />
          Volver al inicio
        </Link>
      }
    />
  );
}
