import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

/**
 * Solo se monta cuando `status` ya es `'anonymous' | 'authenticating' |
 * 'authenticated'` — `AppRoutes` resuelve `'bootstrapping'`/`'sessionError'`
 * antes de llegar acá, así que nunca hay parpadeo del login mientras se
 * restaura la sesión. El backend sigue siendo la autoridad final: esto
 * solo evita renderizar contenido protegido, nunca reemplaza la
 * verificación real que ya hace cada request autenticada.
 */
export function ProtectedRoute() {
  const { status } = useAuth();
  return status === 'authenticated' ? <Outlet /> : <Navigate to="/login" replace />;
}
