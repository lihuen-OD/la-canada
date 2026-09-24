import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { AppShell } from '../app/AppShell';
import { BootstrappingScreen } from '../components/BootstrappingScreen';
import { SessionRestoreErrorScreen } from '../components/SessionRestoreErrorScreen';
import { LoginScreen } from '../features/auth/LoginScreen';
import { AuthenticatedHome } from '../features/home/AuthenticatedHome';
import { AccessDeniedScreen } from '../features/admin/AccessDeniedScreen';
import { AdminUsersScreen } from '../features/admin/AdminUsersScreen';
import { APP_ROUTES } from './navigation';
import { ProtectedRoute } from './ProtectedRoute';
import { RequireRole } from './RequireRole';

/**
 * `bootstrapping`/`sessionError` se resuelven ACÁ, antes de cualquier
 * `<Routes>` — así nunca hay un parpadeo de "pantalla de login" mientras
 * todavía se está restaurando la sesión (ver auth/AuthProvider.tsx).
 *
 * `AppShell` es una ruta de layout DENTRO de `ProtectedRoute`: solo existe
 * para usuarios autenticados. Cualquier ruta no declarada (incluidos
 * módulos futuros como /tareas) cae en el catch-all y redirige.
 */
export function AppRoutes() {
  const { status, retryBootstrap } = useAuth();

  if (status === 'bootstrapping') {
    return <BootstrappingScreen />;
  }
  if (status === 'sessionError') {
    return <SessionRestoreErrorScreen onRetry={retryBootstrap} />;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={status === 'authenticated' ? <Navigate to="/" replace /> : <LoginScreen />}
      />
      <Route path={APP_ROUTES.home.path} element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<AuthenticatedHome />} />
          <Route
            path={APP_ROUTES.adminUsers.path}
            element={
              <RequireRole
                role={APP_ROUTES.adminUsers.requiredRole}
                fallback={<AccessDeniedScreen />}
              >
                <AdminUsersScreen />
              </RequireRole>
            }
          />
        </Route>
      </Route>
      <Route
        path="*"
        element={<Navigate to={status === 'authenticated' ? '/' : '/login'} replace />}
      />
    </Routes>
  );
}
