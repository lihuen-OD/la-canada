import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '../../test/render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiError } from '../../api/httpClient';
import type { AdminUserListItem, AdminUsersListResponse } from '../../api/adminTypes';

const {
  fetchAdminUsersMock,
  activateUserMock,
  resetUserPinMock,
  changeUserStatusMock,
  createAdminUserMock,
  changeUserDisplayNameMock,
  useAuthMock,
  logoutMock,
} = vi.hoisted(() => ({
  createAdminUserMock: vi.fn(),
  changeUserDisplayNameMock: vi.fn(),
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
  createAdminUser: createAdminUserMock,
  changeUserDisplayName: changeUserDisplayNameMock,
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
    createAdminUserMock.mockReset();
    changeUserDisplayNameMock.mockReset();
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

  it('la propia cuenta nunca se suspende ni deshabilita, aunque haya otro ADMIN activo (Etapa 5U)', async () => {
    fetchAdminUsersMock.mockResolvedValueOnce(listResponse([ADMIN_SELF, ADMIN_OTHER]));
    renderScreen();
    const user = userEvent.setup();

    const adminRow = (await screen.findByText('@admin')).closest('li') as HTMLElement;
    for (const name of ['Suspender', 'Deshabilitar']) {
      const button = within(adminRow).getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription('No podés desactivar tu propia cuenta.');
      await user.click(button);
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(changeUserStatusMock).not.toHaveBeenCalled();
    // El OTRO administrador sí se puede suspender (queda la propia cuenta activa).
    const otherRow = screen.getByText('@admin2').closest('li') as HTMLElement;
    expect(within(otherRow).getByRole('button', { name: 'Suspender' })).toBeEnabled();
  });

  it('el 409 de la carrera (último activo / cuenta propia) se muestra en español sin cerrar el diálogo', async () => {
    fetchAdminUsersMock.mockResolvedValue(listResponse([ADMIN_SELF, ADMIN_OTHER]));
    changeUserStatusMock.mockRejectedValue(
      new ApiError(409, 'No podés desactivar al último administrador activo.', 'ADMIN_LAST_ACTIVE'),
    );
    renderScreen();
    const user = userEvent.setup();
    const otherRow = (await screen.findByText('@admin2')).closest('li') as HTMLElement;
    await user.click(within(otherRow).getByRole('button', { name: 'Suspender' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Suspender' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'No podés desactivar al último administrador activo.',
    );
    expect(logoutMock).not.toHaveBeenCalled();
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

  describe('＋ Nuevo administrador (Etapa 5U)', () => {
    const CREATED = {
      id: 'admin-new',
      role: 'ADMIN' as const,
      status: 'ACTIVE' as const,
      displayName: 'Administradora sintética',
      createdAt: '2026-09-28T18:00:00.000Z',
    };

    async function openDialog() {
      fetchAdminUsersMock.mockResolvedValue(listResponse([ADMIN_SELF, ACTIVE]));
      const user = userEvent.setup();
      renderScreen();
      await user.click(await screen.findByRole('button', { name: '＋ Nuevo administrador' }));
      return { user, dialog: within(screen.getByRole('dialog')) };
    }

    it('envía solo { displayName, pin } con el PIN como string (cero inicial) e Idempotency-Key', async () => {
      createAdminUserMock.mockResolvedValue({ user: CREATED });
      const { user, dialog } = await openDialog();
      await user.type(dialog.getByLabelText('Nombre visible'), '  Administradora   sintética ');
      await user.type(dialog.getByLabelText('PIN (4 dígitos)'), '0123');
      await user.type(dialog.getByLabelText('Confirmar PIN'), '0123');
      await user.click(dialog.getByRole('button', { name: 'Crear administrador' }));
      await waitFor(() => expect(createAdminUserMock).toHaveBeenCalledTimes(1));
      const [body, key] = createAdminUserMock.mock.calls[0] as [Record<string, unknown>, string];
      expect(body).toEqual({ displayName: 'Administradora sintética', pin: '0123' });
      for (const forbidden of ['role', 'userId', 'employeeId', 'username', 'status', 'pinHash']) {
        expect(body).not.toHaveProperty(forbidden);
      }
      expect(key).toMatch(/^[0-9a-f]{32}$/);
      expect(key).not.toContain('0123');
      expect(
        await screen.findByText(
          'Administrador creado: Administradora sintética. Ya puede ingresar con su PIN.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('los campos de PIN no sugieren nada y solo aceptan 4 dígitos', async () => {
      const { user, dialog } = await openDialog();
      const pin = dialog.getByLabelText('PIN (4 dígitos)');
      expect(pin).toHaveValue('');
      expect(pin).toHaveAttribute('type', 'password');
      expect(pin).toHaveAttribute('inputmode', 'numeric');
      expect(pin).not.toHaveAttribute('placeholder');
      await user.type(pin, '12a345');
      expect(pin).toHaveValue('1234');
    });

    it('valida en español antes de enviar: nombre, largo del PIN y confirmación', async () => {
      const { user, dialog } = await openDialog();
      const submit = dialog.getByRole('button', { name: 'Crear administrador' });
      await user.click(submit);
      expect(await dialog.findByRole('alert')).toHaveTextContent('Ingresá el nombre.');
      await user.type(dialog.getByLabelText('Nombre visible'), 'Ana');
      await user.type(dialog.getByLabelText('PIN (4 dígitos)'), '12');
      await user.click(submit);
      expect(await dialog.findByRole('alert')).toHaveTextContent('exactamente 4 dígitos');
      await user.type(dialog.getByLabelText('PIN (4 dígitos)'), '34');
      await user.type(dialog.getByLabelText('Confirmar PIN'), '4321');
      await user.click(submit);
      expect(await dialog.findByRole('alert')).toHaveTextContent('no coinciden');
      expect(dialog.getByLabelText('Confirmar PIN')).toHaveValue('');
      expect(createAdminUserMock).not.toHaveBeenCalled();
    });

    it('doble clic = una sola request; un error limpia ambos PIN y se muestra sin cerrar', async () => {
      let reject: (error: unknown) => void = () => undefined;
      createAdminUserMock.mockReturnValue(new Promise((_, r) => (reject = r)));
      const { user, dialog } = await openDialog();
      await user.type(dialog.getByLabelText('Nombre visible'), 'Ana');
      await user.type(dialog.getByLabelText('PIN (4 dígitos)'), '0123');
      await user.type(dialog.getByLabelText('Confirmar PIN'), '0123');
      await user.dblClick(dialog.getByRole('button', { name: 'Crear administrador' }));
      expect(createAdminUserMock).toHaveBeenCalledTimes(1);
      reject(new ApiError(400, 'El nombre debe tener al menos 2 letras.', 'VALIDATION_ERROR'));
      expect(await dialog.findByRole('alert')).toHaveTextContent('al menos 2 letras');
      expect(dialog.getByLabelText('PIN (4 dígitos)')).toHaveValue('');
      expect(dialog.getByLabelText('Confirmar PIN')).toHaveValue('');
      expect(dialog.getByLabelText('Nombre visible')).toHaveValue('Ana');
    });

    it('cancelar limpia los PIN: al reabrir, están vacíos', async () => {
      const { user, dialog } = await openDialog();
      await user.type(dialog.getByLabelText('PIN (4 dígitos)'), '0123');
      await user.click(dialog.getByRole('button', { name: 'Cancelar' }));
      await user.click(screen.getByRole('button', { name: '＋ Nuevo administrador' }));
      const reopened = within(screen.getByRole('dialog'));
      expect(reopened.getByLabelText('PIN (4 dígitos)')).toHaveValue('');
    });

    it('no muestra el username técnico generado en el listado', async () => {
      fetchAdminUsersMock.mockResolvedValue(
        listResponse([
          ADMIN_SELF,
          {
            ...ADMIN_OTHER,
            username: 'admin-0123456789abcdef',
            technicalUsername: true,
            personalProfile: { displayName: 'Administradora sintética' },
          },
        ]),
      );
      renderScreen();
      expect(await screen.findByText('Administradora sintética')).toBeInTheDocument();
      expect(screen.queryByText(/admin-0123456789abcdef/)).not.toBeInTheDocument();
      expect(screen.getByText('@admin')).toBeInTheDocument();
    });
  });

  it('otro ADMIN (sin Employee) se renombra desde Usuarios; una persona del equipo no (Datos del equipo)', async () => {
    fetchAdminUsersMock.mockResolvedValue(
      listResponse([
        ADMIN_SELF,
        { ...ADMIN_OTHER, personalProfile: { displayName: 'Segundo sintético' } },
        ACTIVE,
      ]),
    );
    changeUserDisplayNameMock.mockResolvedValue({
      user: { id: ADMIN_OTHER.id, displayName: 'Segundo Corregido' },
    });
    renderScreen();
    const user = userEvent.setup();
    const fresaRow = (await screen.findByText('Fresa')).closest('li') as HTMLElement;
    expect(
      within(fresaRow).queryByRole('button', { name: /Editar nombre/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar nombre de Segundo sintético' }));
    const dialog = within(screen.getByRole('dialog'));
    const field = dialog.getByLabelText('Nombre visible');
    expect(field).toHaveValue('Segundo sintético');
    await user.clear(field);
    await user.type(field, 'Segundo  Corregido');
    await user.click(dialog.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(changeUserDisplayNameMock).toHaveBeenCalledWith(ADMIN_OTHER.id, 'Segundo Corregido'),
    );
    expect(await screen.findByText('Nombre actualizado: Segundo Corregido ✓')).toBeInTheDocument();
  });
});
