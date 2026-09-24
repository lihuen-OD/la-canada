import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiError } from '../../api/httpClient';
import type { AdminUserListItem, AdminUsersListResponse } from '../../api/adminTypes';

const {
  fetchAdminUsersMock,
  activateUserMock,
  resetUserPinMock,
  changeUserStatusMock,
  useAuthMock,
  logoutMock,
} = vi.hoisted(() => ({
  fetchAdminUsersMock: vi.fn(),
  activateUserMock: vi.fn(),
  resetUserPinMock: vi.fn(),
  changeUserStatusMock: vi.fn(),
  useAuthMock: vi.fn(),
  logoutMock: vi.fn(),
}));

vi.mock('../../api/adminApi', () => ({
  fetchAdminUsers: fetchAdminUsersMock,
  activateUser: activateUserMock,
  resetUserPin: resetUserPinMock,
  changeUserStatus: changeUserStatusMock,
}));
vi.mock('../../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { AdminUsersScreen } from './AdminUsersScreen';

const PENDING: AdminUserListItem = {
  id: 'user-pending',
  username: 'coke',
  role: 'EMPLOYEE',
  status: 'PENDING_ACTIVATION',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  employee: { id: 'employee-1', displayName: 'Coke' },
};

const ACTIVE: AdminUserListItem = {
  id: 'user-active',
  username: 'fresa',
  role: 'EMPLOYEE',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  employee: { id: 'employee-2', displayName: 'Fresa' },
};

const ADMIN_SELF: AdminUserListItem = {
  id: 'admin-1',
  username: 'admin',
  role: 'ADMIN',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  employee: null,
};

const ADMIN_OTHER: AdminUserListItem = {
  id: 'admin-2',
  username: 'admin2',
  role: 'ADMIN',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  employee: null,
};

function listResponse(users: AdminUserListItem[]): AdminUsersListResponse {
  return { users, pagination: { page: 1, pageSize: 20, total: users.length } };
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <AdminUsersScreen />
    </MemoryRouter>,
  );
}

describe('AdminUsersScreen', () => {
  beforeEach(() => {
    fetchAdminUsersMock.mockReset();
    activateUserMock.mockReset();
    resetUserPinMock.mockReset();
    changeUserStatusMock.mockReset();
    logoutMock.mockReset();
    useAuthMock.mockReturnValue({ user: ADMIN_SELF, logout: logoutMock });
  });

  it('muestra el estado de carga y luego la lista real', async () => {
    fetchAdminUsersMock.mockResolvedValue(listResponse([PENDING, ACTIVE]));
    renderScreen();

    expect(screen.getByText(/cargando usuarios/i)).toBeInTheDocument();

    expect(await screen.findByText('Coke')).toBeInTheDocument();
    expect(screen.getByText('Fresa')).toBeInTheDocument();
  });

  it('estado vacío: no inventa usuarios', async () => {
    fetchAdminUsersMock.mockResolvedValue(listResponse([]));
    renderScreen();

    expect(await screen.findByText(/todavía no hay usuarios/i)).toBeInTheDocument();
  });

  it('error de red permite reintentar, y el reintento exitoso muestra la lista', async () => {
    fetchAdminUsersMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderScreen();

    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos cargar/i);

    fetchAdminUsersMock.mockResolvedValueOnce(listResponse([PENDING]));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText('Coke')).toBeInTheDocument();
  });

  it('activación: envía exactamente { pin } al endpoint correcto y refresca la lista', async () => {
    fetchAdminUsersMock.mockResolvedValueOnce(listResponse([PENDING]));
    activateUserMock.mockResolvedValue({ ok: true });
    renderScreen();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /activar y asignar pin/i }));
    expect(screen.getByText(/activar a coke/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/pin nuevo/i), '0007');
    await user.type(screen.getByLabelText(/confirmar pin/i), '0007');

    fetchAdminUsersMock.mockResolvedValueOnce(listResponse([{ ...PENDING, status: 'ACTIVE' }]));
    await user.click(screen.getByRole('button', { name: 'Activar' }));

    await waitFor(() => expect(activateUserMock).toHaveBeenCalledWith('user-pending', '0007'));
    expect(await screen.findByText(/activado correctamente/i)).toBeInTheDocument();
    expect(fetchAdminUsersMock).toHaveBeenCalledTimes(2);
    // El diálogo se cierra tras el éxito.
    expect(screen.queryByLabelText(/pin nuevo/i)).not.toBeInTheDocument();
  });

  it('reset de PIN de otra persona: refresca la lista, nunca cierra la sesión propia', async () => {
    fetchAdminUsersMock.mockResolvedValueOnce(listResponse([ACTIVE]));
    resetUserPinMock.mockResolvedValue({ ok: true });
    renderScreen();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /cambiar pin/i }));
    await user.type(screen.getByLabelText(/pin nuevo/i), '4821');
    await user.type(screen.getByLabelText(/confirmar pin/i), '4821');

    fetchAdminUsersMock.mockResolvedValueOnce(listResponse([ACTIVE]));
    await user.click(screen.getByRole('button', { name: 'Guardar PIN' }));

    await waitFor(() => expect(resetUserPinMock).toHaveBeenCalledWith('user-active', '4821'));
    expect(logoutMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/pin actualizado correctamente/i)).toBeInTheDocument();
  });

  it('cambio de PIN propio: nunca refresca la lista, cierra sesión mediante el logout existente', async () => {
    fetchAdminUsersMock.mockResolvedValueOnce(listResponse([ADMIN_SELF]));
    resetUserPinMock.mockResolvedValue({ ok: true });
    renderScreen();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /cambiar pin/i }));
    await user.type(screen.getByLabelText(/pin nuevo/i), '9999');
    await user.type(screen.getByLabelText(/confirmar pin/i), '9999');
    await user.click(screen.getByRole('button', { name: 'Guardar PIN' }));

    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
    // Nunca se vuelve a pedir la lista tras el propio logout.
    expect(fetchAdminUsersMock).toHaveBeenCalledTimes(1);
  });

  it('suspender a otra persona: pide confirmación, envía el status exacto, refresca la lista', async () => {
    fetchAdminUsersMock.mockResolvedValueOnce(listResponse([ACTIVE]));
    changeUserStatusMock.mockResolvedValue({ ok: true });
    renderScreen();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Suspender' }));
    expect(screen.getByText(/se cerrarán todas sus sesiones activas/i)).toBeInTheDocument();

    fetchAdminUsersMock.mockResolvedValueOnce(listResponse([{ ...ACTIVE, status: 'SUSPENDED' }]));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Suspender' }));

    await waitFor(() =>
      expect(changeUserStatusMock).toHaveBeenCalledWith('user-active', 'SUSPENDED'),
    );
    expect(logoutMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/estado actualizado correctamente/i)).toBeInTheDocument();
  });

  it('auto-suspensión del propio admin: cierra sesión en vez de refrescar', async () => {
    // Con otro ADMIN activo real en la lista, la protección de auto-bloqueo
    // no deshabilita el botón — así se puede probar el flujo hasta el final.
    fetchAdminUsersMock.mockResolvedValueOnce(listResponse([ADMIN_SELF, ADMIN_OTHER]));
    changeUserStatusMock.mockResolvedValue({ ok: true });
    renderScreen();
    const user = userEvent.setup();

    const adminUsername = await screen.findByText('@admin');
    const adminRow = adminUsername.closest('li') as HTMLElement;
    await user.click(within(adminRow).getByRole('button', { name: 'Suspender' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Suspender' }));

    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
    expect(fetchAdminUsersMock).toHaveBeenCalledTimes(1);
  });

  it('un error de la API durante la activación se muestra en el propio diálogo, sin JSON crudo', async () => {
    fetchAdminUsersMock.mockResolvedValueOnce(listResponse([PENDING]));
    activateUserMock.mockRejectedValue(
      new ApiError(400, 'El PIN no cumple la política mínima.', 'WEAK_PIN'),
    );
    renderScreen();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /activar y asignar pin/i }));
    await user.type(screen.getByLabelText(/pin nuevo/i), '1111');
    await user.type(screen.getByLabelText(/confirmar pin/i), '1111');
    await user.click(screen.getByRole('button', { name: 'Activar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El PIN no cumple la política mínima.',
    );
    // El diálogo sigue abierto (la activación no se dio por exitosa).
    expect(screen.getByLabelText(/pin nuevo/i)).toBeInTheDocument();
    expect(fetchAdminUsersMock).toHaveBeenCalledTimes(1);
  });

  it('nunca muestra pinHash ni JSON crudo en ningún estado', async () => {
    fetchAdminUsersMock.mockResolvedValue(listResponse([PENDING, ACTIVE]));
    renderScreen();
    await screen.findByText('Coke');

    expect(document.body.textContent).not.toMatch(/\$argon2/i);
    expect(document.body.textContent).not.toMatch(/pinHash/i);
  });

  it('estructura semántica válida: región con nombre, lista y un ítem por usuario', async () => {
    fetchAdminUsersMock.mockResolvedValue(listResponse([PENDING, ACTIVE, ADMIN_SELF]));
    renderScreen();

    const region = await screen.findByRole('region', { name: 'Usuarios del sistema' });
    const list = within(region).getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(screen.getByRole('heading', { level: 1, name: 'Usuarios' })).toBeInTheDocument();
    // Cada fila expone nombre, rol y estado como texto propio.
    expect(within(items[0] as HTMLElement).getByText('Coke')).toBeInTheDocument();
    expect(
      within(items[0] as HTMLElement).getByText('Pendiente de activación'),
    ).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).getByText('Equipo')).toBeInTheDocument();
  });

  it('tras una mutación exitosa refresca sin volver a "Cargando…" (sin salto de layout)', async () => {
    fetchAdminUsersMock.mockResolvedValueOnce(listResponse([ACTIVE]));
    changeUserStatusMock.mockResolvedValue({ ok: true });
    renderScreen();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Suspender' }));
    fetchAdminUsersMock.mockReturnValueOnce(new Promise(() => {}));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Suspender' }));

    await waitFor(() => expect(fetchAdminUsersMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/cargando usuarios/i)).not.toBeInTheDocument();
    expect(screen.getByText('Fresa')).toBeInTheDocument();
  });
});
