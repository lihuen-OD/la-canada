import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '../../test/render';
import {
  PERSON,
  employeesResponse,
  eventsResponse,
  newsResponse,
  photosResponse,
  profileResponse,
  summaryResponse,
  teamResponse,
  weatherResponse,
} from '../../test/fixtures/more';
import type { TaskItem } from '../../api/taskTypes';

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
  fetchEmployees: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  setEmployeeActive: vi.fn(),
  fetchTeamProfiles: vi.fn(),
  fetchMyProfile: vi.fn(),
  saveMyProfile: vi.fn(),
  addMyChild: vi.fn(),
  removeMyChild: vi.fn(),
}));
const tasksApi = vi.hoisted(() => ({ fetchTaskEmployees: vi.fn(), fetchTasks: vi.fn() }));
const adminApi = vi.hoisted(() => ({ activateUser: vi.fn(), resetUserPin: vi.fn() }));
const { useAuthMock, logoutMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  logoutMock: vi.fn(),
}));
vi.mock('../../api/moreApi', () => api);
vi.mock('../../api/tasksApi', () => tasksApi);
vi.mock('../../api/adminApi', () => adminApi);
vi.mock('../../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { MoreModule } from './MoreModule';
import { tasksForDay } from './calendarDays';
import { ageLabel, relativeDays, timeAgo } from './moreLabels';

function asEmployee() {
  useAuthMock.mockReturnValue({
    user: { id: 'u-e', role: 'EMPLOYEE', status: 'ACTIVE', employee: PERSON },
    logout: logoutMock,
    hasRole: (role: string) => role === 'EMPLOYEE',
  });
}
function asAdmin() {
  useAuthMock.mockReturnValue({
    user: { id: 'u-a', role: 'ADMIN', status: 'ACTIVE', employee: null },
    logout: logoutMock,
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
  api.fetchEmployees.mockResolvedValue(employeesResponse());
  api.fetchTeamProfiles.mockResolvedValue(teamResponse());
  api.fetchMyProfile.mockResolvedValue(profileResponse());
  tasksApi.fetchTaskEmployees.mockResolvedValue({ employees: [PERSON] });
  tasksApi.fetchTasks.mockResolvedValue({
    period: { today: '2026-09-25', weekStart: '2026-09-22', timeZone: 'x' },
    tasks: [],
  });
  asEmployee();
});

describe('☰ Más — grilla', () => {
  it('EMPLOYEE: Novedades, Eventos, Clima, Fotos y Mi perfil con los subtítulos del prototipo; sin Configuración', async () => {
    renderMore();
    const grid = within(await screen.findByRole('list', { name: 'Secciones' }));
    expect(grid.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/more/news',
      '/more/events',
      '/more/weather',
      '/more/photos',
      '/more/profile',
    ]);
    expect(await grid.findByText('2 hoy')).toBeInTheDocument();
    expect(grid.getByText('3 próximos')).toBeInTheDocument();
    expect(grid.getByText('1 foto')).toBeInTheDocument();
    expect(grid.getByText('Villa Elisa, E.Ríos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cerrar sesión/i })).toBeInTheDocument();
    expect(api.fetchMoreSummary).toHaveBeenCalledTimes(1);
  });

  it('ADMIN: ve Configuración y no Mi perfil; sin novedades hoy muestra el total', async () => {
    asAdmin();
    api.fetchMoreSummary.mockResolvedValue(summaryResponse({ news: { today: 0, total: 7 } }));
    renderMore();
    const grid = within(await screen.findByRole('list', { name: 'Secciones' }));
    expect(grid.getByRole('link', { name: /Configuración/ })).toHaveAttribute(
      'href',
      '/more/settings',
    );
    expect(grid.queryByRole('link', { name: /Mi perfil/ })).not.toBeInTheDocument();
    expect(await grid.findByText('7 total')).toBeInTheDocument();
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
  it('Próximos con cumpleaños calculados y Pasados; EMPLOYEE no ve acciones', async () => {
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
  });

  it('ADMIN: los cumpleaños no se editan; eliminar pide confirmación y anula', async () => {
    asAdmin();
    const user = userEvent.setup();
    api.deleteEvent.mockResolvedValue({});
    renderMore('/more/events');
    await screen.findByText('Visita sintética');
    expect(screen.queryByRole('button', { name: /Eliminar Cumpleaños/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Eliminar Visita sintética' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(api.deleteEvent).toHaveBeenCalledWith('ev-1'));
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

describe('reglas de presentación del prototipo', () => {
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
