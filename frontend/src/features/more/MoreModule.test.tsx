import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '../../test/render';
import {
  PERSON,
  employeesResponse,
  eventsResponse,
  familyMember,
  gardenResponse,
  gardenVersion,
  personalProfileResponse,
  newsResponse,
  photosResponse,
  profileResponse,
  summaryResponse,
  teamResponse,
  weatherResponse,
} from '../../test/fixtures/more';
import type { TaskItem } from '../../api/taskTypes';
import { ApiError } from '../../api/httpClient';

const api = vi.hoisted(() => ({
  fetchMoreSummary: vi.fn(),
  fetchNews: vi.fn(),
  createNews: vi.fn(),
  fetchEvents: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  fetchWeather: vi.fn(),
  fetchPhotos: vi.fn(),
  fetchPhotoContent: vi.fn(),
  uploadPhoto: vi.fn(),
  deletePhoto: vi.fn(),
  fetchGardenPlanVersions: vi.fn(),
  fetchGardenPlanContent: vi.fn(),
  publishGardenPlanVersion: vi.fn(),
  fetchEmployees: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  setEmployeeActive: vi.fn(),
  fetchTeamProfiles: vi.fn(),
  fetchMyProfile: vi.fn(),
  saveMyProfile: vi.fn(),
  addMyChild: vi.fn(),
  removeMyChild: vi.fn(),
  saveMyOwnBirthday: vi.fn(),
  fetchMyFamily: vi.fn(),
  createFamilyMember: vi.fn(),
  updateFamilyMember: vi.fn(),
  setFamilyMemberActive: vi.fn(),
  deleteFamilyMember: vi.fn(),
}));
const tasksApi = vi.hoisted(() => ({ fetchTaskEmployees: vi.fn(), fetchTasks: vi.fn() }));
const adminApi = vi.hoisted(() => ({ activateUser: vi.fn(), resetUserPin: vi.fn() }));
const { useAuthMock, logoutMock, applyDisplayNameMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  logoutMock: vi.fn(),
  applyDisplayNameMock: vi.fn(),
}));
vi.mock('../../api/moreApi', () => api);
vi.mock('../../api/tasksApi', () => tasksApi);
vi.mock('../../api/adminApi', () => adminApi);
vi.mock('../../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { MoreModule } from './MoreModule';
import { tasksForDay } from './calendarDays';
import {
  ageLabel,
  birthdayOriginLabel,
  familyBirthDateLabel,
  relativeDays,
  timeAgo,
} from './moreLabels';

function asEmployee() {
  useAuthMock.mockReturnValue({
    user: {
      id: 'u-e',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      displayName: PERSON.displayName,
      employee: PERSON,
    },
    logout: logoutMock,
    applyDisplayName: applyDisplayNameMock,
    hasRole: (role: string) => role === 'EMPLOYEE',
  });
}
function asAdmin() {
  useAuthMock.mockReturnValue({
    user: { id: 'u-a', role: 'ADMIN', status: 'ACTIVE', displayName: null, employee: null },
    logout: logoutMock,
    applyDisplayName: applyDisplayNameMock,
    hasRole: (role: string) => role === 'ADMIN',
  });
}
const renderMore = (route = '/more') =>
  render(
    <Routes>
      <Route path="/more/*" element={<MoreModule />} />
    </Routes>,
    { route },
  );

beforeEach(() => {
  for (const mock of [
    ...Object.values(api),
    ...Object.values(tasksApi),
    ...Object.values(adminApi),
  ]) {
    mock.mockReset();
  }
  logoutMock.mockReset();
  applyDisplayNameMock.mockReset();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:sintetico'),
      revokeObjectURL: vi.fn(),
    }),
  );
  api.fetchMoreSummary.mockResolvedValue(summaryResponse());
  api.fetchNews.mockResolvedValue(newsResponse());
  api.fetchEvents.mockResolvedValue(eventsResponse());
  api.fetchWeather.mockResolvedValue(weatherResponse());
  api.fetchPhotos.mockResolvedValue(photosResponse());
  api.fetchPhotoContent.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
  api.fetchGardenPlanVersions.mockResolvedValue(gardenResponse());
  api.fetchGardenPlanContent.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
  api.fetchEmployees.mockResolvedValue(employeesResponse());
  api.fetchTeamProfiles.mockResolvedValue(teamResponse());
  api.fetchMyProfile.mockResolvedValue(profileResponse());
  api.fetchMyFamily.mockResolvedValue({ family: [] });
  tasksApi.fetchTaskEmployees.mockResolvedValue({ employees: [PERSON] });
  tasksApi.fetchTasks.mockResolvedValue({
    period: { today: '2026-09-25', weekStart: '2026-09-22', timeZone: 'x' },
    tasks: [],
  });
  asEmployee();
});

describe('☰ Más — grilla', () => {
  it('EMPLOYEE: Novedades, Eventos, Clima, Fotos, Jardín y Mi perfil con los subtítulos del prototipo; sin Configuración', async () => {
    renderMore();
    const grid = within(await screen.findByRole('list', { name: 'Secciones' }));
    expect(grid.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/more/news',
      '/more/events',
      '/more/weather',
      '/more/photos',
      '/more/garden',
      '/more/profile',
    ]);
    expect(await grid.findByText('2 hoy')).toBeInTheDocument();
    expect(grid.getByText('3 próximos')).toBeInTheDocument();
    expect(grid.getByText('1 foto')).toBeInTheDocument();
    expect(grid.getByText('Arroyo Barú, E.Ríos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cerrar sesión/i })).toBeInTheDocument();
    expect(api.fetchMoreSummary).toHaveBeenCalledTimes(1);
  });

  it('ADMIN: ve Configuración y también Mi perfil (Etapa 5F); sin novedades hoy muestra el total', async () => {
    asAdmin();
    api.fetchMoreSummary.mockResolvedValue(summaryResponse({ news: { today: 0, total: 7 } }));
    renderMore();
    const grid = within(await screen.findByRole('list', { name: 'Secciones' }));
    expect(grid.getByRole('link', { name: /Configuración/ })).toHaveAttribute(
      'href',
      '/more/settings',
    );
    expect(grid.getByRole('link', { name: /Mi perfil/ })).toHaveAttribute('href', '/more/profile');
    expect(await grid.findByText('7 total')).toBeInTheDocument();
  });

  it('🌳 Jardín: la tarjeta va después de Fotos y sin plano lo dice', async () => {
    renderMore();
    const grid = within(await screen.findByRole('list', { name: 'Secciones' }));
    const hrefs = grid.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs.indexOf('/more/garden')).toBe(hrefs.indexOf('/more/photos') + 1);
    expect(grid.getByRole('link', { name: /Jardín/ })).toHaveAttribute('href', '/more/garden');
    expect(await grid.findByText('Sin plano')).toBeInTheDocument();
  });

  it('🌳 Jardín: con versiones, el subtítulo dice cuántas hay', async () => {
    api.fetchMoreSummary.mockResolvedValue(summaryResponse({ garden: { versions: 3 } }));
    renderMore();
    const grid = within(await screen.findByRole('list', { name: 'Secciones' }));
    expect(await grid.findByText('3 versiones')).toBeInTheDocument();
  });
});

describe('📝 Novedades', () => {
  it('EMPLOYEE reporta como sí mismo: nunca envía employeeId; Idempotency-Key en el header', async () => {
    const user = userEvent.setup();
    api.createNews.mockResolvedValue({ news: newsResponse().news[0] });
    renderMore('/more/news');
    expect(await screen.findByText('Aviso sintético 0')).toBeInTheDocument();
    expect(screen.getByLabelText('¿Quién reporta?')).toHaveValue('Persona sintética');
    await user.type(screen.getByLabelText('Novedad'), '  Se cortó   la luz ');
    await user.click(screen.getByRole('button', { name: 'Registrar novedad' }));
    await waitFor(() => expect(api.createNews).toHaveBeenCalledTimes(1));
    const [body, key] = api.createNews.mock.calls[0] as [object, string];
    expect(body).toEqual({ text: 'Se cortó la luz' });
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(await screen.findByText('Novedad registrada ✓')).toBeInTheDocument();
  });

  it('ADMIN elige quién reporta entre las personas activas', async () => {
    asAdmin();
    const user = userEvent.setup();
    api.createNews.mockResolvedValue({ news: newsResponse().news[0] });
    renderMore('/more/news');
    await screen.findByRole('option', { name: 'Persona sintética' });
    await user.type(screen.getByLabelText('Novedad'), 'Aviso');
    await user.click(screen.getByRole('button', { name: 'Registrar novedad' }));
    await waitFor(() =>
      expect(api.createNews.mock.calls[0]?.[0]).toEqual({ text: 'Aviso', employeeId: PERSON.id }),
    );
  });

  it('sin novedades: estado vacío real', async () => {
    api.fetchNews.mockResolvedValue(newsResponse(0));
    renderMore('/more/news');
    expect(await screen.findByText('Sin novedades aún')).toBeInTheDocument();
  });
});

describe('📅 Eventos', () => {
  it('Próximos con cumpleaños calculados y Pasados; EMPLOYEE no ve acciones de eventos', async () => {
    renderMore('/more/events');
    const upcoming = within(await screen.findByRole('list', { name: 'Próximos' }));
    expect(upcoming.getByText('Visita sintética')).toBeInTheDocument();
    expect(upcoming.getByText(/Mañana/)).toBeInTheDocument();
    expect(upcoming.getByText('Cumpleaños de Familiar sintético')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Pasados' })).getByText(/Hace 5 días/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Eliminar|Editar|\+ Nuevo/ }),
    ).not.toBeInTheDocument();
    // La mascota se puede VER (no editar) desde la ficha.
    expect(screen.getByRole('link', { name: /Ver ficha/ })).toHaveAttribute('href', '/pets/pet-1');
  });

  it('ADMIN: los derivados no se eliminan; eliminar un evento pide confirmación y anula', async () => {
    asAdmin();
    const user = userEvent.setup();
    api.deleteEvent.mockResolvedValue({});
    renderMore('/more/events');
    await screen.findByText('Visita sintética');
    for (const derived of ['Familiar sintético', 'Mascota sintética', 'Otra persona sintética']) {
      expect(
        screen.queryByRole('button', {
          name: new RegExp(`(Eliminar|Editar) Cumpleaños de ${derived}`),
        }),
      ).not.toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'Eliminar Visita sintética' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(api.deleteEvent).toHaveBeenCalledWith('ev-1'));
  });

  it('ADMIN: un cumpleaños MANUAL se edita y se anula con confirmación; invalida Eventos, Más e Inicio', async () => {
    asAdmin();
    const user = userEvent.setup();
    api.updateEvent.mockResolvedValue({});
    api.deleteEvent.mockResolvedValue({});
    const { queryClient } = renderMore('/more/events');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const item = (await screen.findByText('Cumpleaños manual sintético')).closest(
      'li',
    ) as HTMLElement;
    expect(within(item).getByText('Cargado a mano')).toBeInTheDocument();
    await user.click(
      within(item).getByRole('button', { name: 'Editar Cumpleaños manual sintético' }),
    );
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('Tipo')).toHaveValue('BIRTHDAY');
    await user.click(dialog.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(api.updateEvent).toHaveBeenCalledWith('ev-2', {
        title: 'Cumpleaños manual sintético',
        date: '2026-10-07',
        type: 'BIRTHDAY',
        note: null,
      }),
    );
    await user.click(
      within(item).getByRole('button', { name: 'Eliminar Cumpleaños manual sintético' }),
    );
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(api.deleteEvent).toHaveBeenCalledWith('ev-2'));
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(['session', 'u-a', 'more', 'events']),
        JSON.stringify(['session', 'u-a', 'more', 'summary']),
        JSON.stringify(['session', 'u-a', 'dashboard']),
      ]),
    );
    expect(keys.some((key) => /tasks|stock|pets|family|profile/.test(key))).toBe(false);
  });

  it('un duplicado de cumpleaños derivado muestra el mensaje del backend en español', async () => {
    asAdmin();
    const user = userEvent.setup();
    const { ApiError } = await import('../../api/httpClient');
    const message =
      'Este cumpleaños ya se genera automáticamente desde el perfil correspondiente. Editalo desde su perfil para evitar duplicados.';
    api.createEvent.mockRejectedValue(new ApiError(409, message, 'EVENT_BIRTHDAY_DERIVED'));
    renderMore('/more/events');
    await user.click(await screen.findByRole('button', { name: '+ Nuevo' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Título'), 'Cumpleaños de Vicky');
    await user.type(dialog.getByLabelText('Fecha'), '2027-03-10');
    await user.selectOptions(dialog.getByLabelText('Tipo'), 'BIRTHDAY');
    await user.click(dialog.getByRole('button', { name: 'Guardar' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent(message);
  });

  it('derivados: muestran su origen y navegan por SPA a la fuente correcta según quién mira', async () => {
    asAdmin();
    renderMore('/more/events');
    const family = (await screen.findByText('Cumpleaños de Familiar sintético')).closest(
      'li',
    ) as HTMLElement;
    expect(within(family).getByText(/Automático desde Mi familia/)).toBeInTheDocument();
    expect(within(family).getByRole('link', { name: /Editar en Mi familia/ })).toHaveAttribute(
      'href',
      '/more/profile',
    );
    const pet = screen.getByText('Cumpleaños de Mascota sintética').closest('li') as HTMLElement;
    expect(within(pet).getByRole('link', { name: /Editar ficha/ })).toHaveAttribute(
      'href',
      '/pets/pet-1',
    );
    const other = screen
      .getByText('Cumpleaños de Otra persona sintética')
      .closest('li') as HTMLElement;
    expect(within(other).queryByRole('link')).not.toBeInTheDocument();
    expect(within(other).queryByRole('button')).not.toBeInTheDocument();
  });

  it('filtrar por tipo pide ese tipo al backend', async () => {
    const user = userEvent.setup();
    renderMore('/more/events');
    await screen.findByText('Visita sintética');
    await user.click(screen.getByRole('button', { name: 'Cumpleaños' }));
    await waitFor(() =>
      expect(api.fetchEvents).toHaveBeenLastCalledWith({
        type: 'BIRTHDAY',
        pastPage: 1,
        pastPageSize: 20,
      }),
    );
  });
});

describe('🌤️ Clima', () => {
  it('actual, alerta de lluvia, pronóstico de 5 días y recomendaciones del backend', async () => {
    renderMore('/more/weather');
    expect(await screen.findByText('Parcialm. nublado')).toBeInTheDocument();
    expect(screen.getByText(/Lluvia actual/)).toBeInTheDocument();
    const forecast = within(screen.getByRole('list', { name: 'Pronóstico 5 días' }));
    expect(forecast.getAllByRole('listitem')).toHaveLength(5);
    expect(forecast.getByText('Hoy')).toBeInTheDocument();
    expect(forecast.getByText(/80%/)).toBeInTheDocument();
    expect(screen.getByText('Regar hoy — no se esperan lluvias')).toBeInTheDocument();
  });
});

describe('📸 Fotos', () => {
  it('EMPLOYEE ve la galería y el visor sin "Eliminar" (solo ADMIN)', async () => {
    const user = userEvent.setup();
    renderMore('/more/photos');
    await user.click(await screen.findByRole('button', { name: 'Ver Foto sintética' }));
    const viewer = within(screen.getByRole('dialog'));
    expect(viewer.getByText('Foto sintética')).toBeInTheDocument();
    expect(viewer.getByText(/Persona sintética · recuerdo/)).toBeInTheDocument();
    expect(viewer.queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument();
  });

  it('ADMIN elimina con confirmación', async () => {
    asAdmin();
    const user = userEvent.setup();
    api.deletePhoto.mockResolvedValue({});
    renderMore('/more/photos');
    await user.click(await screen.findByRole('button', { name: 'Ver Foto sintética' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Eliminar/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(api.deletePhoto).toHaveBeenCalledWith('photo-1'));
  });

  it('subir: título, tipo y persona viajan como metadatos con Idempotency-Key', async () => {
    const user = userEvent.setup();
    api.uploadPhoto.mockResolvedValue({ photo: photosResponse().photos[0] });
    const { container } = renderMore('/more/photos');
    await screen.findByRole('button', { name: /Subir foto/ });
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'jardin.jpg', {
      type: 'image/jpeg',
    });
    await user.upload(
      container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement,
      file,
    );
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText('Título'), 'Jardín');
    await user.selectOptions(dialog.getByLabelText('Tipo'), 'TASK_EVIDENCE');
    // "Guardar" recién se habilita cuando el navegador terminó de cargar la
    // preview (jsdom no decodifica imágenes: el evento real lo dispara el navegador).
    expect(dialog.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    fireEvent.load(dialog.getByRole('img', { name: 'Vista previa de la foto elegida' }));
    await user.click(dialog.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.uploadPhoto).toHaveBeenCalledTimes(1));
    const [sent, metadata, key] = api.uploadPhoto.mock.calls[0] as [File, object, string];
    expect(sent).toBe(file);
    expect(metadata).toEqual({ title: 'Jardín', category: 'TASK_EVIDENCE', employeeId: null });
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it('sin almacenamiento configurado, la subida queda deshabilitada con aviso claro', async () => {
    api.fetchPhotos.mockResolvedValue(photosResponse('unconfigured'));
    renderMore('/more/photos');
    expect(await screen.findByText(/falta configurar el almacenamiento/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Subir foto/ })).toBeDisabled();
  });
});

describe('🌳 Jardín', () => {
  it('EMPLOYEE ve el plano vigente y el historial, sin botón de publicar', async () => {
    renderMore('/more/garden');
    const current = await screen.findByRole('region', { name: 'Plano vigente' });
    expect(within(current).getByText('Versión 2')).toBeInTheDocument();
    expect(within(current).getByText('Vigente')).toBeInTheDocument();
    const history = screen.getByRole('list', { name: 'Versiones del plano' });
    expect(within(history).getByText('Versión 2 · vigente')).toBeInTheDocument();
    expect(within(history).getByText('Versión 1')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Publicar nueva versión/ }),
    ).not.toBeInTheDocument();
    expect(api.fetchGardenPlanVersions).toHaveBeenCalledWith(1, 20);
  });

  it('abre el visor de una versión con quién la publicó y cuándo', async () => {
    const user = userEvent.setup();
    renderMore('/more/garden');
    await user.click(await screen.findByRole('button', { name: /Ver la versión 1/ }));
    const viewer = within(screen.getByRole('dialog'));
    expect(viewer.getByText('Versión 1')).toBeInTheDocument();
    expect(viewer.getByText(/Publicada por pablo/)).toBeInTheDocument();
  });

  it('sin plano: estado inicial claro según el rol, no un error', async () => {
    api.fetchGardenPlanVersions.mockResolvedValue(gardenResponse('configured', 0));
    const { unmount } = renderMore('/more/garden');
    expect(
      await screen.findByText('Cuando se publique la primera versión, va a aparecer acá.'),
    ).toBeInTheDocument();
    unmount();
    asAdmin();
    api.fetchGardenPlanVersions.mockResolvedValue(gardenResponse('configured', 0));
    renderMore('/more/garden');
    expect(
      await screen.findByText('Publicá la primera versión para que todos la vean.'),
    ).toBeInTheDocument();
  });

  it('ADMIN publica una versión con Idempotency-Key e invalida solo el historial', async () => {
    asAdmin();
    const user = userEvent.setup();
    api.publishGardenPlanVersion.mockResolvedValue({ version: gardenVersion(3) });
    const { container } = renderMore('/more/garden');
    await user.click(await screen.findByRole('button', { name: /Publicar nueva versión/ }));
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'plano.jpg', {
      type: 'image/jpeg',
    });
    await user.upload(
      container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement,
      file,
    );
    const dialog = within(await screen.findByRole('dialog'));
    // El botón recién se habilita cuando la preview cargó (jsdom no decodifica).
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Publicar' })).toBeDisabled());
    fireEvent.load(dialog.getByRole('img', { name: 'Vista previa del plano elegido' }));
    await user.click(dialog.getByRole('button', { name: 'Publicar' }));
    await waitFor(() => expect(api.publishGardenPlanVersion).toHaveBeenCalledTimes(1));
    const [sent, key] = api.publishGardenPlanVersion.mock.calls[0] as [File, string];
    expect(sent).toBe(file);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    await waitFor(() => expect(api.fetchGardenPlanVersions).toHaveBeenCalledTimes(2));
    // Publicar un plano no toca Fotos ni Novedades.
    expect(api.fetchPhotos).not.toHaveBeenCalled();
    expect(api.fetchNews).not.toHaveBeenCalled();
  });

  it('el backend rechaza el tipo: el error se muestra en el diálogo', async () => {
    asAdmin();
    const user = userEvent.setup();
    api.publishGardenPlanVersion.mockRejectedValue(
      new ApiError(415, 'El plano debe ser una imagen JPG, PNG o WebP.', 'PET_PHOTO_INVALID'),
    );
    const { container } = renderMore('/more/garden');
    await user.click(await screen.findByRole('button', { name: /Publicar nueva versión/ }));
    await user.upload(
      container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement,
      new File([new Uint8Array([0xff, 0xd8, 0xff])], 'plano.jpg', { type: 'image/jpeg' }),
    );
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.load(dialog.getByRole('img', { name: 'Vista previa del plano elegido' }));
    await user.click(dialog.getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/JPG, PNG o WebP/);
  });

  it('sin almacenamiento configurado, publicar queda deshabilitado con aviso claro', async () => {
    asAdmin();
    api.fetchGardenPlanVersions.mockResolvedValue(gardenResponse('unconfigured', 0));
    renderMore('/more/garden');
    expect(await screen.findByText(/falta configurar el almacenamiento/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Publicar nueva versión/ })).toBeDisabled();
  });
});

describe('⚙️ Configuración y 👤 Mi perfil', () => {
  it('EMPLOYEE no accede a Configuración ni a Datos del equipo', async () => {
    renderMore('/more/settings');
    expect(await screen.findByText(/acceso/i)).toBeInTheDocument();
    expect(api.fetchEmployees).not.toHaveBeenCalled();
  });

  it('ADMIN: personas con estado de PIN; dar de baja pide confirmación', async () => {
    asAdmin();
    const user = userEvent.setup();
    api.setEmployeeActive.mockResolvedValue({ employee: employeesResponse().employees[0] });
    renderMore('/more/settings');
    const people = within(await screen.findByRole('list', { name: 'Personas' }));
    expect(people.getByText('🔑 PIN asignado')).toBeInTheDocument();
    expect(people.getByText('⚠️ Sin PIN')).toBeInTheDocument();
    expect(people.getByText(/Parque · Inactiva/)).toBeInTheDocument();
    await user.click(people.getAllByRole('button', { name: 'Baja' })[0] as HTMLElement);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Dar de baja a Persona sintética?')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Dar de baja' }));
    await waitFor(() => expect(api.setEmployeeActive).toHaveBeenCalledWith(PERSON.id, false));
  });

  it('ADMIN: Datos del equipo muestra la ficha e hijos cargados por cada persona', async () => {
    asAdmin();
    renderMore('/more/settings/team');
    expect(await screen.findByText('Nombre completo sintético')).toBeInTheDocument();
    expect(screen.getByText('✓ Completo')).toBeInTheDocument();
    expect(screen.getByText('Hijo sintético · 6 años')).toBeInTheDocument();
  });

  it('Mi perfil guarda el formulario completo (vacíos = null) y agrega hijos con Idempotency-Key', async () => {
    const user = userEvent.setup();
    api.saveMyProfile.mockResolvedValue(profileResponse());
    api.addMyChild.mockResolvedValue({
      child: { id: 'c', name: 'Juan', birthDate: null, age: null },
    });
    renderMore('/more/profile');
    await user.type(
      await screen.findByLabelText('Teléfono', { selector: '[autocomplete="tel"]' }),
      '3442 123456',
    );
    await user.click(screen.getByRole('button', { name: 'Guardar mis datos' }));
    await waitFor(() =>
      expect(api.saveMyProfile).toHaveBeenCalledWith({
        displayName: 'Persona sintética',
        fullLegalName: null,
        birthDate: null,
        maritalStatus: null,
        phone: '3442 123456',
        taxId: null,
        healthInsurance: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
      }),
    );
    expect(await screen.findByText('Datos guardados ✓')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ Agregar' }));
    const form = within(screen.getByRole('form', { name: 'Agregar hijo' }));
    await user.type(form.getByLabelText('Nombre'), 'Juan');
    await user.click(form.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.addMyChild).toHaveBeenCalledTimes(1));
    expect(api.addMyChild.mock.calls[0]?.[0]).toEqual({ name: 'Juan', birthDate: null });
  });
});

describe('👤 Mi perfil del ADMIN (sin Employee) — 🎂 Mi cumpleaños y 👨‍👩‍👧‍👦 Mi familia', () => {
  beforeEach(() => {
    asAdmin();
    api.fetchMyProfile.mockResolvedValue(
      personalProfileResponse({ displayName: null, birthDate: '1985-07-20' }),
    );
  });

  it('muestra su fecha dd/mm/aaaa, sin campos laborales; guardar envía ISO y solo invalida lo propio', async () => {
    const user = userEvent.setup();
    api.saveMyOwnBirthday.mockResolvedValue(
      personalProfileResponse({ displayName: 'Nombre sintético', birthDate: '1985-07-21' }),
    );
    const { queryClient } = renderMore('/more/profile');
    const card = within(await screen.findByRole('region', { name: /Mi cumpleaños/ }));
    expect(card.getByText('20/07/1985')).toBeInTheDocument();
    for (const labor of [
      /CUIL/,
      /Obra social/,
      /Estado civil/,
      /Contacto de emergencia/,
      /Hijos/,
    ]) {
      expect(screen.queryByText(labor)).not.toBeInTheDocument();
    }
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await user.click(card.getByRole('button', { name: 'Editar' }));
    const date = card.getByLabelText('Fecha de nacimiento');
    expect(date).toHaveAttribute('type', 'date');
    expect(date).toHaveValue('1985-07-20');
    await user.clear(date);
    await user.type(date, '1985-07-21');
    await user.type(card.getByLabelText('Nombre visible'), '  Nombre   sintético ');
    await user.click(card.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(api.saveMyOwnBirthday).toHaveBeenCalledWith({
        displayName: 'Nombre sintético',
        birthDate: '1985-07-21',
      }),
    );
    expect(applyDisplayNameMock).toHaveBeenCalledWith('Nombre sintético');
    expect(await card.findByText('21/07/1985')).toBeInTheDocument();
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    // El nombre del ADMIN aparece en su sesión, su cumpleaños, Usuarios y, como
    // participante o autor, en Stock y Gallinero (y sus selectores). Nada más.
    expect(keys.some((key) => /tasks|pets|team|family|performance/.test(key))).toBe(false);
    expect(keys).toContain(JSON.stringify(['session', 'u-a', 'participants']));
    expect(keys).toContain(JSON.stringify(['session', 'u-a', 'stock']));
    expect(keys).toContain(JSON.stringify(['session', 'u-a', 'chickenCoop']));
    expect(keys).toContain(JSON.stringify(['session', 'u-a', 'more', 'events']));
    expect(keys).toContain(JSON.stringify(['session', 'u-a', 'admin', 'users']));
    expect(api.fetchMyProfile).toHaveBeenCalledTimes(1);
  });

  it('el nombre visible es obligatorio y se valida en español antes de enviar', async () => {
    const user = userEvent.setup();
    renderMore('/more/profile');
    const card = within(await screen.findByRole('region', { name: /Mi cumpleaños/ }));
    expect(card.getByText('Sin cargar (se muestra «Administrador»)')).toBeInTheDocument();
    await user.click(card.getByRole('button', { name: 'Editar' }));
    await user.click(card.getByRole('button', { name: 'Guardar' }));
    expect(await card.findByRole('alert')).toHaveTextContent('Ingresá el nombre.');
    await user.type(card.getByLabelText('Nombre visible'), 'Ana2');
    await user.click(card.getByRole('button', { name: 'Guardar' }));
    expect(await card.findByRole('alert')).toHaveTextContent(/solo puede tener letras/);
    expect(api.saveMyOwnBirthday).not.toHaveBeenCalled();
  });

  it('estado vacío de la familia', async () => {
    renderMore('/more/profile');
    expect(await screen.findByText('Todavía no agregaste familiares.')).toBeInTheDocument();
  });

  it('error al cargar la familia: mensaje en español y reintento', async () => {
    const user = userEvent.setup();
    api.fetchMyFamily.mockRejectedValueOnce(new Error('offline'));
    renderMore('/more/profile');
    expect(await screen.findByText('No pudimos cargar tu familia')).toBeInTheDocument();
    api.fetchMyFamily.mockResolvedValue({ family: [familyMember()] });
    await user.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByText('Familiar sintético')).toBeInTheDocument();
  });

  it('carga: indicador accesible mientras llega la familia', async () => {
    api.fetchMyFamily.mockReturnValue(new Promise(() => undefined));
    renderMore('/more/profile');
    expect(await screen.findByText('Cargando tu familia…')).toBeInTheDocument();
  });

  it('crear: nombre, relación y fecha ISO; sin año envía --MM-DD; Idempotency-Key; doble clic = 1 request', async () => {
    const user = userEvent.setup();
    let resolve: (value: unknown) => void = () => undefined;
    api.createFamilyMember.mockReturnValue(new Promise((r) => (resolve = r)));
    renderMore('/more/profile');
    await screen.findByText('Todavía no agregaste familiares.');
    await user.click(screen.getByRole('button', { name: '+ Agregar' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Nombre'), 'Hija sintética');
    await user.selectOptions(dialog.getByLabelText('Relación'), 'CHILD');
    await user.click(dialog.getByLabelText(/No sé el año/));
    await user.selectOptions(dialog.getByLabelText('Día'), '4');
    await user.selectOptions(dialog.getByLabelText('Mes'), '5');
    const save = dialog.getByRole('button', { name: 'Guardar' });
    await user.dblClick(save);
    expect(api.createFamilyMember).toHaveBeenCalledTimes(1);
    const [body, key] = api.createFamilyMember.mock.calls[0] as [object, string];
    expect(body).toEqual({ name: 'Hija sintética', relation: 'CHILD', birthDate: '--05-04' });
    expect(JSON.stringify(body)).not.toMatch(/userId|owner/);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    resolve({ member: familyMember() });
    expect(await screen.findByText(/se agregó a tu familia/)).toBeInTheDocument();
  });

  it('lista con fecha visible dd/mm/aaaa (o dd/mm sin año); editar, desactivar y reactivar', async () => {
    const user = userEvent.setup();
    api.fetchMyFamily.mockResolvedValue({
      family: [
        familyMember({
          id: 'fam-1',
          name: 'Pareja sintética',
          relation: 'PARTNER',
          birthDate: '1984-02-01',
          age: { years: 42, months: 511 },
        }),
        familyMember({ id: 'fam-2', name: 'Vicky sintética', birthDate: '--03-10', seeded: true }),
        familyMember({
          id: 'fam-3',
          name: 'Inactivo sintético',
          birthDate: '2001-06-01',
          active: false,
        }),
      ],
    });
    api.updateFamilyMember.mockResolvedValue({ member: familyMember() });
    api.setFamilyMemberActive.mockResolvedValue({ member: familyMember() });
    renderMore('/more/profile');
    const list = within(await screen.findByRole('list', { name: 'Mi familia' }));
    expect(list.getByText('Pareja · 01/02/1984 · 42 años')).toBeInTheDocument();
    expect(list.getByText('Familia · 10/03')).toBeInTheDocument();
    expect(list.getByText('Inactivo')).toBeInTheDocument();
    // Los del seed se desactivan, no se eliminan.
    expect(
      list.queryByRole('button', { name: 'Eliminar a Vicky sintética' }),
    ).not.toBeInTheDocument();

    await user.click(list.getByRole('button', { name: 'Editar a Pareja sintética' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('Fecha de nacimiento')).toHaveValue('1984-02-01');
    await user.selectOptions(dialog.getByLabelText('Relación'), 'OTHER');
    await user.click(dialog.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(api.updateFamilyMember).toHaveBeenCalledWith('fam-1', {
        name: 'Pareja sintética',
        relation: 'OTHER',
        birthDate: '1984-02-01',
      }),
    );

    await user.click(list.getByRole('button', { name: 'Desactivar a Pareja sintética' }));
    await waitFor(() => expect(api.setFamilyMemberActive).toHaveBeenCalledWith('fam-1', false));
    expect(
      await screen.findByText('Pareja sintética ya no aparece en Eventos.'),
    ).toBeInTheDocument();
    await user.click(list.getByRole('button', { name: 'Reactivar a Inactivo sintético' }));
    await waitFor(() => expect(api.setFamilyMemberActive).toHaveBeenCalledWith('fam-3', true));
  });

  it('eliminar pide confirmación irreversible y solo entonces llama al backend', async () => {
    const user = userEvent.setup();
    api.fetchMyFamily.mockResolvedValue({ family: [familyMember({ name: 'Error sintético' })] });
    api.deleteFamilyMember.mockResolvedValue(undefined);
    const { queryClient } = renderMore('/more/profile');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await user.click(await screen.findByRole('button', { name: 'Eliminar a Error sintético' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(/No se puede deshacer/)).toBeInTheDocument();
    expect(api.deleteFamilyMember).not.toHaveBeenCalled();
    await user.click(dialog.getByRole('button', { name: 'Eliminar definitivamente' }));
    await waitFor(() => expect(api.deleteFamilyMember).toHaveBeenCalledWith('fam-1'));
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(['session', 'u-a', 'more', 'family']),
        JSON.stringify(['session', 'u-a', 'more', 'events']),
        JSON.stringify(['session', 'u-a', 'dashboard']),
      ]),
    );
    expect(keys.some((key) => /tasks|stock|pets|team/.test(key))).toBe(false);
  });

  it('el EMPLOYEE conserva su ficha de equipo e hijos (no ve Mi familia)', async () => {
    asEmployee();
    api.fetchMyProfile.mockResolvedValue(profileResponse());
    renderMore('/more/profile');
    expect(await screen.findByRole('button', { name: 'Guardar mis datos' })).toBeInTheDocument();
    expect(screen.getByText(/Contacto de emergencia/)).toBeInTheDocument();
    expect(screen.queryByText('Mi familia')).not.toBeInTheDocument();
    expect(api.fetchMyFamily).not.toHaveBeenCalled();
  });
});

describe('🪪 nombre visible del EMPLOYEE y del equipo (Etapa 5F)', () => {
  it('EMPLOYEE corrige su nombre: va a Employee.displayName, se refleja en la sesión y refresca los nombres', async () => {
    const user = userEvent.setup();
    api.saveMyProfile.mockResolvedValue({
      ...profileResponse(),
      employee: { ...PERSON, displayName: 'Persona Renombrada', role: 'Doméstica' },
    });
    const { queryClient } = renderMore('/more/profile');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const field = await screen.findByLabelText('Nombre visible');
    expect(field).toHaveValue('Persona sintética');
    expect(screen.getByText('Así te ve el equipo en toda la app.')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, '  Persona   Renombrada ');
    await user.click(screen.getByRole('button', { name: 'Guardar mis datos' }));
    await waitFor(() => expect(api.saveMyProfile).toHaveBeenCalledTimes(1));
    const body = api.saveMyProfile.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.displayName).toBe('Persona Renombrada');
    for (const forbidden of ['userId', 'employeeId', 'username', 'role', 'code']) {
      expect(body).not.toHaveProperty(forbidden);
    }
    await waitFor(() => expect(applyDisplayNameMock).toHaveBeenCalledWith('Persona Renombrada'));
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    for (const domain of ['tasks', 'performance', 'chickenCoop', 'stock', 'news', 'dashboard']) {
      expect(
        keys.some((key) => key.includes(domain)),
        domain,
      ).toBe(true);
    }
  });

  it('EMPLOYEE sin cambiar el nombre: no invalida los otros módulos', async () => {
    const user = userEvent.setup();
    api.saveMyProfile.mockResolvedValue(profileResponse());
    const { queryClient } = renderMore('/more/profile');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await user.click(await screen.findByRole('button', { name: 'Guardar mis datos' }));
    await waitFor(() => expect(api.saveMyProfile).toHaveBeenCalledTimes(1));
    await screen.findByText('Datos guardados ✓');
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys.some((key) => /tasks|stock|chickenCoop|performance|pets/.test(key))).toBe(false);
  });

  it('ADMIN edita el nombre de una persona desde Datos del equipo con el endpoint existente', async () => {
    asAdmin();
    const user = userEvent.setup();
    api.updateEmployee.mockResolvedValue({
      employee: { ...employeesResponse().employees[0], displayName: 'Nombre Corregido' },
    });
    renderMore('/more/settings/team');
    await user.click(
      await screen.findByRole('button', {
        name: `Editar nombre de ${teamResponse().team[0]?.displayName}`,
      }),
    );
    const dialog = within(screen.getByRole('dialog'));
    expect(
      dialog.getByText(/No cambia su identidad de ingreso, su PIN ni su historial/),
    ).toBeInTheDocument();
    const field = dialog.getByLabelText('Nombre visible');
    await user.clear(field);
    await user.type(field, 'X');
    await user.click(dialog.getByRole('button', { name: 'Guardar' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('al menos 2 letras');
    await user.clear(field);
    await user.type(field, 'Nombre  Corregido');
    await user.click(dialog.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(api.updateEmployee).toHaveBeenCalledWith(teamResponse().team[0]?.id, {
        displayName: 'Nombre Corregido',
      }),
    );
    expect(await screen.findByText('Nombre actualizado: Nombre Corregido ✓')).toBeInTheDocument();
  });
});

describe('reglas de presentación del prototipo', () => {
  it('origen de un derivado: primera persona solo para su dueño; fechas sin año como dd/mm', () => {
    expect(birthdayOriginLabel('USER_FAMILY', true)).toBe('desde Mi familia');
    expect(birthdayOriginLabel('USER_FAMILY', false)).toBe('desde la familia del administrador');
    expect(birthdayOriginLabel('USER_PROFILE', false)).toBe('desde el perfil del administrador');
    expect(birthdayOriginLabel('ANIMAL', false)).toBe('desde la ficha de la mascota');
    expect(familyBirthDateLabel('--03-10')).toBe('10/03');
    expect(familyBirthDateLabel('1984-02-01')).toBe('01/02/1984');
  });

  it('relativeDays / timeAgo / ageLabel', () => {
    expect([
      relativeDays(0),
      relativeDays(1),
      relativeDays(4),
      relativeDays(-1),
      relativeDays(-3),
    ]).toEqual(['Hoy', 'Mañana', 'En 4 días', 'Hace 1 día', 'Hace 3 días']);
    const now = Date.parse('2026-09-25T12:00:00Z');
    expect(timeAgo('2026-09-25T11:59:30Z', now)).toBe('hace un momento');
    expect(timeAgo('2026-09-25T11:50:00Z', now)).toBe('hace 10 min');
    expect(timeAgo('2026-09-25T09:00:00Z', now)).toBe('hace 3 h');
    expect(timeAgo('2026-09-23T12:00:00Z', now)).toBe('hace 2 días');
    expect(ageLabel({ years: 0, months: 1 })).toBe('1 mes');
    expect(ageLabel({ years: 2, months: 27 })).toBe('2 años');
  });

  it('calendario: diarias siempre, semanales lunes a viernes, mensuales el día 1', () => {
    const task = (id: string, frequency: TaskItem['frequency']) => ({ id, frequency }) as TaskItem;
    const tasks = [
      task('d', 'DAILY'),
      task('w', 'WEEKLY'),
      task('m', 'MONTHLY'),
      task('u', 'URGENT'),
    ];
    // Septiembre 2026: el 1 es martes, el 6 domingo.
    expect(tasksForDay(tasks, 2026, 8, 1).map((t) => t.id)).toEqual(['d', 'w', 'm']);
    expect(tasksForDay(tasks, 2026, 8, 6).map((t) => t.id)).toEqual(['d']);
    expect(tasksForDay(tasks, 2026, 8, 7).map((t) => t.id)).toEqual(['d', 'w']);
  });
});
