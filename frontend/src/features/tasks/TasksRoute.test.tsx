import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemRole } from '../../api/types';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('../../auth/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('../../api/authApi', () => ({ fetchLoginOptions: () => new Promise(() => {}) }));
vi.mock('../../api/tasksApi', () => ({
  fetchTasks: vi.fn(() => new Promise(() => {})),
  fetchTaskEmployees: vi.fn(() => new Promise(() => {})),
  fetchTaskHistory: vi.fn(() => new Promise(() => {})),
}));

import { AppRoutes } from '../../routes/AppRoutes';

function renderAt(status: 'anonymous' | 'authenticated', role?: SystemRole) {
  useAuthMock.mockReturnValue({
    status,
    user: role ? { id: 'u1', role, status: 'ACTIVE', employee: null } : null,
    hasRole: (r: SystemRole) => r === role,
    logout: vi.fn(),
    login: vi.fn(),
    retryBootstrap: vi.fn(),
  });
  return render(
    <MemoryRouter initialEntries={['/tasks']}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('/tasks — ruta protegida', () => {
  beforeEach(() => useAuthMock.mockReset());

  it('anónimo: nunca ve Tareas, va al login', () => {
    renderAt('anonymous');
    expect(screen.queryByRole('heading', { name: 'Tareas' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'La Cañada' })).toBeInTheDocument();
  });

  it.each(['EMPLOYEE', 'ADMIN'] as const)(
    '%s autenticado: ve Tareas con el destino activo marcado',
    (role) => {
      renderAt('authenticated', role);
      expect(screen.getByRole('heading', { level: 1, name: 'Tareas' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Tareas' })).toHaveAttribute('aria-current', 'page');
    },
  );
});
