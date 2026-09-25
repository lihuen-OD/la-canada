import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '../../test/render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('../../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { AuthenticatedHome } from './AuthenticatedHome';

function renderHome() {
  return render(
    <MemoryRouter>
      <AuthenticatedHome />
    </MemoryRouter>,
  );
}

describe('AuthenticatedHome', () => {
  it('muestra el nombre real del empleado y su rol', () => {
    const logout = vi.fn();
    useAuthMock.mockReturnValue({
      user: {
        id: 'user-1',
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        employee: { id: 'e1', displayName: 'Coke', colorHex: '#4a7c59' },
      },
      logout,
    });

    renderHome();

    expect(screen.getByRole('heading', { level: 1, name: 'Hola, Coke' })).toBeInTheDocument();
    // Rol traducido, como texto (no solo un color).
    expect(screen.getByText('Equipo')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Sesión iniciada');
  });

  it('un ADMIN sin Employee vinculado se muestra con la etiqueta genérica, nunca con el username', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'admin-1', role: 'ADMIN', status: 'ACTIVE', employee: null },
      logout: vi.fn(),
    });

    const { container } = renderHome();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Hola, Administrador' }),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/@|username/i);
  });

  it('el botón "Cerrar sesión" llama a logout', async () => {
    const logout = vi.fn();
    useAuthMock.mockReturnValue({
      user: { id: 'user-1', role: 'EMPLOYEE', status: 'ACTIVE', employee: null },
      logout,
    });

    renderHome();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('no muestra ningún dato de negocio (tareas, stock, métricas) — es un punto de entrada temporal', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'user-1', role: 'EMPLOYEE', status: 'ACTIVE', employee: null },
      logout: vi.fn(),
    });

    const { container } = renderHome();
    const content = container.textContent ?? '';
    expect(content).not.toMatch(/tarea|stock|gallina|mascota|evento|novedad|clima|foto/i);
    // Sin KPI ni cifras de ningún tipo: ningún número se renderiza en la pantalla temporal.
    expect(content).not.toMatch(/\d/);
  });

  it('no renderiza <main> propio: vive dentro del app shell, que ya lo provee', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'user-1', role: 'EMPLOYEE', status: 'ACTIVE', employee: null },
      logout: vi.fn(),
    });

    renderHome();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('"Cerrar sesión" no permite un segundo envío mientras el primero sigue en curso', async () => {
    const logout = vi.fn().mockReturnValue(new Promise(() => {}));
    useAuthMock.mockReturnValue({
      user: { id: 'user-1', role: 'EMPLOYEE', status: 'ACTIVE', employee: null },
      logout,
    });

    renderHome();
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: /cerrar sesión/i });
    await user.click(button);
    await user.click(button);

    expect(logout).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
  });

  it('un ADMIN ve el enlace de administración de usuarios', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'admin-1', role: 'ADMIN', status: 'ACTIVE', employee: null },
      logout: vi.fn(),
    });

    renderHome();

    expect(screen.getByRole('link', { name: /administrar usuarios/i })).toBeInTheDocument();
  });

  it('un EMPLOYEE nunca ve el enlace de administración de usuarios', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'user-1', role: 'EMPLOYEE', status: 'ACTIVE', employee: null },
      logout: vi.fn(),
    });

    renderHome();

    expect(screen.queryByRole('link', { name: /administrar usuarios/i })).not.toBeInTheDocument();
  });
});
