import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '../test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemRole } from '../api/types';

const {
  useAuthMock,
  fetchLoginOptionsMock,
  fetchAdminUsersMock,
  fetchStockItemsMock,
  fetchStockCategoriesMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  fetchLoginOptionsMock: vi.fn(),
  fetchAdminUsersMock: vi.fn(),
  fetchStockItemsMock: vi.fn(),
  fetchStockCategoriesMock: vi.fn(),
}));
vi.mock('../auth/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('../api/authApi', () => ({ fetchLoginOptions: fetchLoginOptionsMock }));
vi.mock('../api/adminApi', () => ({
  fetchAdminUsers: fetchAdminUsersMock,
  activateUser: vi.fn(),
  resetUserPin: vi.fn(),
  changeUserStatus: vi.fn(),
}));
vi.mock('../api/stockApi', () => ({
  fetchStockItems: fetchStockItemsMock,
  fetchStockCategories: fetchStockCategoriesMock,
  fetchStockDestinations: vi.fn(),
  fetchStockItem: vi.fn(),
  fetchStockItemMovements: vi.fn(),
  createStockMovement: vi.fn(),
  createStockCategory: vi.fn(),
  createStockItem: vi.fn(),
  updateStockCategory: vi.fn(),
  updateStockItem: vi.fn(),
  setStockItemActive: vi.fn(),
}));

import { AppRoutes } from './AppRoutes';

type Status = 'bootstrapping' | 'sessionError' | 'anonymous' | 'authenticated';

function renderAt(path: string, status: Status, role?: SystemRole) {
  useAuthMock.mockReturnValue({
    status,
    user: role ? { id: 'u1', role, status: 'ACTIVE', employee: null } : null,
    hasRole: (r: SystemRole) => r === role,
    login: vi.fn(),
    logout: vi.fn(),
    retryBootstrap: vi.fn(),
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('AppRoutes (con app shell real)', () => {
  beforeEach(() => {
    fetchLoginOptionsMock.mockReset();
    fetchLoginOptionsMock.mockReturnValue(new Promise(() => {}));
    fetchAdminUsersMock.mockReset();
    fetchAdminUsersMock.mockReturnValue(new Promise(() => {}));
    fetchStockItemsMock.mockReset();
    fetchStockItemsMock.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
      totalPages: 1,
    });
    fetchStockCategoriesMock.mockReset();
    fetchStockCategoriesMock.mockResolvedValue({ categories: [] });
  });

  it('restaurando sesión: pantalla estable con estado anunciado, nunca el login ni el shell', () => {
    renderAt('/', 'bootstrapping');

    expect(screen.getByRole('status')).toHaveTextContent(/restaurando tu sesión/i);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByText(/elegí tu identidad/i)).not.toBeInTheDocument();
  });

  it('error de conectividad al restaurar: mensaje claro y reintento, sin detalles técnicos', async () => {
    renderAt('/', 'sessionError');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/no pudimos conectarnos/i);
    expect(alert.textContent).not.toMatch(/error:|stack|typeerror|fetch/i);
    const user = userEvent.setup();
    await user.click(within(alert).getByRole('button', { name: /reintentar/i }));
    expect(useAuthMock.mock.results[0]?.value.retryBootstrap).toHaveBeenCalledTimes(1);
  });

  it('anónimo: el login se muestra sin app shell', () => {
    renderAt('/login', 'anonymous');

    expect(screen.getByRole('heading', { level: 1, name: 'La Cañada' })).toBeInTheDocument();
    expect(screen.getByText('Sistema de gestión')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('autenticado: el Inicio se muestra dentro del app shell', () => {
    renderAt('/', 'authenticated', 'EMPLOYEE');

    expect(screen.getByRole('navigation', { name: /navegación principal/i })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 1 })).toHaveTextContent(
      /hola/i,
    );
  });

  it('/stock (autenticado): la pantalla real de Stock se muestra dentro del shell', async () => {
    renderAt('/stock', 'authenticated', 'ADMIN');

    expect(screen.getByRole('navigation', { name: /navegación principal/i })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Stock' })).toHaveTextContent('📦');
    expect(fetchStockItemsMock).toHaveBeenCalled();
  });

  it('rutas de módulos que todavía no existen redirigen al login (anónimo)', () => {
    renderAt('/gallinero', 'anonymous');

    expect(screen.getByRole('heading', { level: 1, name: 'La Cañada' })).toBeInTheDocument();
  });

  it('EMPLOYEE en /admin/users: acceso denegado dentro del shell, con salida segura al Inicio', async () => {
    renderAt('/admin/users', 'authenticated', 'EMPLOYEE');

    const main = screen.getByRole('main');
    expect(within(main).getByRole('alert')).toHaveTextContent(/no tenés permisos/i);
    // Sin revelar rutas ni roles internos.
    expect(main.textContent).not.toMatch(/admin\/users|ADMIN|EMPLOYEE|403/);
    expect(fetchAdminUsersMock).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(within(main).getByRole('link', { name: /volver al inicio/i }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/hola/i);
  });

  it('ADMIN en /admin/users: pantalla real de usuarios dentro del shell', () => {
    renderAt('/admin/users', 'authenticated', 'ADMIN');

    expect(screen.getByRole('heading', { level: 1, name: 'Usuarios' })).toBeInTheDocument();
    expect(fetchAdminUsersMock).toHaveBeenCalledTimes(1);
  });
});
