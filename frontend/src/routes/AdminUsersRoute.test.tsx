import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '../test/render';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { useAuthMock, fetchAdminUsersMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  fetchAdminUsersMock: vi.fn(),
}));
vi.mock('../auth/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('../api/adminApi', () => ({
  fetchAdminUsers: fetchAdminUsersMock,
  activateUser: vi.fn(),
  resetUserPin: vi.fn(),
  changeUserStatus: vi.fn(),
}));

import { ProtectedRoute } from './ProtectedRoute';
import { RequireRole } from './RequireRole';
import { AdminUsersScreen } from '../features/admin/AdminUsersScreen';
import { AccessDeniedScreen } from '../features/admin/AccessDeniedScreen';

/**
 * Réplica mínima de la rama `/admin/users` real de `AppRoutes.tsx` — no se
 * reimporta `AppRoutes` completo para no tener que resolver también
 * `bootstrapping`/`sessionError` acá; lo único bajo prueba es que
 * `ProtectedRoute` + `RequireRole` protegen `AdminUsersScreen` exactamente
 * como en la app real.
 */
function renderAdminRoute(status: 'anonymous' | 'authenticated', role?: 'ADMIN' | 'EMPLOYEE') {
  useAuthMock.mockReturnValue({
    status,
    user: role ? { id: 'u1', role, status: 'ACTIVE', employee: null } : null,
    hasRole: (r: string) => r === role,
    logout: vi.fn(),
  });

  return render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <Routes>
        <Route path="/login" element={<div>pantalla de login</div>} />
        <Route path="/" element={<ProtectedRoute />}>
          <Route
            path="admin/users"
            element={
              <RequireRole role="ADMIN" fallback={<AccessDeniedScreen />}>
                <AdminUsersScreen />
              </RequireRole>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('/admin/users — protección de acceso', () => {
  beforeEach(() => {
    fetchAdminUsersMock.mockReset();
    fetchAdminUsersMock.mockReturnValue(new Promise(() => {}));
  });

  it('anónimo: nunca ve la pantalla, redirige al login', () => {
    renderAdminRoute('anonymous');
    expect(screen.queryByText('Usuarios')).not.toBeInTheDocument();
    expect(screen.getByText('pantalla de login')).toBeInTheDocument();
  });

  it('EMPLOYEE autenticado: acceso denegado, nunca ve la pantalla administrativa', () => {
    renderAdminRoute('authenticated', 'EMPLOYEE');
    expect(screen.queryByText('Usuarios')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/no tenés permisos/i);
  });

  it('ADMIN autenticado: ve la pantalla de usuarios', () => {
    renderAdminRoute('authenticated', 'ADMIN');
    expect(screen.getByText('Usuarios')).toBeInTheDocument();
    expect(screen.queryByText(/no tenés permisos/i)).not.toBeInTheDocument();
  });
});
