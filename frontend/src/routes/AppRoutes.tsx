import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { BootstrappingScreen } from '../components/BootstrappingScreen';
import { SessionRestoreErrorScreen } from '../components/SessionRestoreErrorScreen';
import { LoginScreen } from '../features/auth/LoginScreen';
import { AuthenticatedHome } from '../features/home/AuthenticatedHome';
import { ProtectedRoute } from './ProtectedRoute';

/**
 * `bootstrapping`/`sessionError` se resuelven ACÁ, antes de cualquier
 * `<Routes>` — así nunca hay un parpadeo de "pantalla de login" mientras
 * todavía se está restaurando la sesión (ver auth/AuthProvider.tsx).
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
      <Route path="/" element={<ProtectedRoute />}>
        <Route index element={<AuthenticatedHome />} />
      </Route>
      <Route
        path="*"
        element={<Navigate to={status === 'authenticated' ? '/' : '/login'} replace />}
      />
    </Routes>
  );
}
