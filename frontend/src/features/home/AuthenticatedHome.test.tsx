import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('../../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { AuthenticatedHome } from './AuthenticatedHome';

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

    render(<AuthenticatedHome />);

    expect(screen.getByText('Coke')).toBeInTheDocument();
    expect(screen.getByText(/rol: equipo/i)).toBeInTheDocument();
    expect(screen.getByText('Sesión iniciada')).toBeInTheDocument();
  });

  it('un ADMIN sin Employee vinculado se muestra con la etiqueta genérica, nunca con el username', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'admin-1', role: 'ADMIN', status: 'ACTIVE', employee: null },
      logout: vi.fn(),
    });

    render(<AuthenticatedHome />);

    expect(screen.getByText('Administrador')).toBeInTheDocument();
  });

  it('el botón "Cerrar sesión" llama a logout', async () => {
    const logout = vi.fn();
    useAuthMock.mockReturnValue({
      user: { id: 'user-1', role: 'EMPLOYEE', status: 'ACTIVE', employee: null },
      logout,
    });

    render(<AuthenticatedHome />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('no muestra ningún dato de negocio (tareas, stock, métricas) — es un punto de entrada temporal', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'user-1', role: 'EMPLOYEE', status: 'ACTIVE', employee: null },
      logout: vi.fn(),
    });

    render(<AuthenticatedHome />);
    const content = screen.getByRole('main').textContent ?? '';
    expect(content).not.toMatch(/tarea|stock|gallina|mascota/i);
  });
});
