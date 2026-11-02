import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/httpClient';
import { OfflineError } from '../../api/transportErrors';
import type {
  GardenActivity,
  GardenParticipant,
  GardenPerformanceResponse,
} from '../../api/kitchenGardenTypes';
import { createTestQueryClient, render, screen, waitFor, within } from '../../test/render';

const gardenApi = vi.hoisted(() => ({
  fetchGardenParticipants: vi.fn(),
  fetchGardenCandidates: vi.fn(),
  addGardenParticipant: vi.fn(),
  setGardenParticipantActive: vi.fn(),
  fetchGardenActivities: vi.fn(),
  createGardenActivity: vi.fn(),
  updateGardenActivity: vi.fn(),
  setGardenActivityActive: vi.fn(),
  completeGardenActivity: vi.fn(),
  revertGardenCompletion: vi.fn(),
  fetchGardenHistory: vi.fn(),
  fetchGardenPerformance: vi.fn(),
  fetchGardenParticipantPerformance: vi.fn(),
}));
// ✅ Tareas, Desempeño general e Inicio: la Huerta nunca los pide.
const tasksApi = vi.hoisted(() => ({
  fetchTasks: vi.fn(),
  fetchTaskEmployees: vi.fn(),
  fetchTaskHistory: vi.fn(),
  completeTask: vi.fn(),
  createTask: vi.fn(),
}));
const performanceApi = vi.hoisted(() => ({
  fetchPerformance: vi.fn(),
  fetchEmployeePerformance: vi.fn(),
}));
const dashboardApi = vi.hoisted(() => ({ getDashboard: vi.fn() }));
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('../../api/kitchenGardenApi', () => gardenApi);
vi.mock('../../api/tasksApi', () => tasksApi);
vi.mock('../../api/performanceApi', () => performanceApi);
vi.mock('../../api/dashboardApi', () => dashboardApi);
vi.mock('../../auth/useAuth', () => ({ useAuth: useAuthMock }));

import KitchenGardenModule from './KitchenGardenModule';

/** Datos SINTÉTICOS: no representan personas ni actividades reales. */
const PABLO: GardenParticipant = {
  id: '00000000-0000-4000-8000-00000000a001',
  displayName: 'Pablo sintético',
  colorHex: '#4a7c59',
  active: true,
  roleLabel: 'Jardinero',
  userActive: true,
};
const ADMIN_P: GardenParticipant = {
  id: '00000000-0000-4000-8000-00000000a002',
  displayName: 'Admin sintética',
  colorHex: null,
  active: true,
  roleLabel: 'Administrador',
  userActive: true,
};
const PERIOD = {
  today: '2026-10-27',
  weekStart: '2026-10-26',
  timeZone: 'America/Argentina/Buenos_Aires',
  generatedAt: '2026-10-27T15:00:00.000Z',
};

function activity(
  id: string,
  description: string,
  responsible: GardenParticipant,
  extra: Partial<GardenActivity> = {},
): GardenActivity {
  return {
    id: `00000000-0000-4000-8000-0000000b${id.padStart(4, '0')}`,
    description,
    frequency: 'DAILY',
    active: true,
    kind: 'OTHER',
    notes: null,
    version: 1,
    agenda: 'TODAY',
    agendaDate: '2026-10-27',
    responsible: {
      id: responsible.id,
      displayName: responsible.displayName,
      colorHex: responsible.colorHex,
      active: true,
    },
    periodKey: '2026-10-27',
    scheduledDate: null,
    scheduleStatus: null,
    executionOrder: null,
    suggestedWeekday: null,
    suggestedFirstHalfDay: null,
    suggestedSecondHalfDay: null,
    suggestedMonthDay: null,
    suggestedMonth: null,
    suggestedDate: null,
    currentExecution: null,
    canComplete: true,
    ...extra,
  };
}

function asAdmin() {
  useAuthMock.mockReturnValue({
    user: {
      id: 'u-admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      displayName: 'Admin sintética',
      employee: null,
    },
    logout: vi.fn(),
  });
}
function asEmployee() {
  useAuthMock.mockReturnValue({
    user: {
      id: 'u-pablo',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      displayName: 'Pablo sintético',
      employee: null,
    },
    logout: vi.fn(),
  });
}

function renderGarden(route = '/kitchen-garden', queryClient = createTestQueryClient()) {
  render(
    <Routes>
      <Route path="/kitchen-garden/*" element={<KitchenGardenModule />} />
    </Routes>,
    { route, queryClient },
  );
  return queryClient;
}

const descriptionsOf = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('.task-item__description')).map((item) => item.textContent);
const descriptionsIn = (section: string) =>
  descriptionsOf(screen.getByRole('list', { name: section }));
/** Todo lo visible, en orden de pantalla (grupos y completadas). */
const allDescriptions = () => descriptionsOf(document.body);

beforeEach(() => {
  for (const mock of [
    ...Object.values(gardenApi),
    ...Object.values(tasksApi),
    ...Object.values(performanceApi),
    ...Object.values(dashboardApi),
  ])
    mock.mockReset();
  asAdmin();
  gardenApi.fetchGardenParticipants.mockResolvedValue({ participants: [] });
  gardenApi.fetchGardenActivities.mockResolvedValue({ period: PERIOD, activities: [] });
});

afterEach(() => {
  // Independencia: ninguna pantalla de la Huerta toca Tareas, Desempeño general ni Inicio.
  for (const mock of [
    ...Object.values(tasksApi),
    ...Object.values(performanceApi),
    ...Object.values(dashboardApi),
  ])
    expect(mock).not.toHaveBeenCalled();
});

describe('🥬 Huerta — inicio vacío y configuración desde la UI', () => {
  it('ADMIN sin participantes: explica cómo empezar y agrega a una persona elegida (sin preselección)', async () => {
    const user = userEvent.setup();
    gardenApi.fetchGardenCandidates.mockResolvedValue({
      candidates: [
        {
          userId: 'u-pablo',
          displayName: 'Pablo sintético',
          colorHex: '#4a7c59',
          roleLabel: 'Jardinero',
          returning: false,
        },
        {
          userId: 'u-admin',
          displayName: 'Admin sintética',
          colorHex: null,
          roleLabel: 'Administrador',
          returning: false,
        },
      ],
    });
    gardenApi.addGardenParticipant.mockResolvedValue({ participant: PABLO });
    renderGarden();
    expect(
      await screen.findByText('Todavía no hay participantes en la Huerta.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Agregar participante' }));
    const dialog = await screen.findByRole('dialog', { name: /Agregar participante/ });
    const radios = await within(dialog).findAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Agregar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Elegí una persona.');
    expect(gardenApi.addGardenParticipant).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('radio', { name: /Pablo sintético/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(gardenApi.addGardenParticipant).toHaveBeenCalledWith('u-pablo'));
    expect(
      await screen.findByText('Pablo sintético ya participa de la Huerta.'),
    ).toBeInTheDocument();
  });

  it('EMPLOYEE en un módulo vacío: explicación sin acciones administrativas', async () => {
    asEmployee();
    renderGarden();
    expect(
      await screen.findByText('Todavía no hay participantes en la Huerta.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /Agregar participante|Nuevo registro|Crear registro/,
      }),
    ).not.toBeInTheDocument();
  });

  it('con participantes y sin registros: «Crear registro» abre «Nuevo registro», exige el tipo y envía «Una vez» por defecto', async () => {
    const user = userEvent.setup();
    gardenApi.fetchGardenParticipants.mockResolvedValue({ participants: [PABLO] });
    gardenApi.createGardenActivity.mockResolvedValue({
      activity: activity('1', 'Regar', PABLO),
      transplant: null,
    });
    renderGarden();
    expect(await screen.findByText('Todavía no hay registros.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crear registro' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo registro' });
    // Sin persona elegida por defecto; frecuencia «Una vez».
    expect((within(dialog).getByLabelText('Responsable') as HTMLSelectElement).value).toBe('');
    expect((within(dialog).getByLabelText('Frecuencia') as HTMLSelectElement).value).toBe(
      'ONE_TIME',
    );
    await user.type(within(dialog).getByLabelText('Descripción'), 'Desmalezar canteros');
    await user.selectOptions(within(dialog).getByLabelText('Responsable'), PABLO.id);
    await user.click(within(dialog).getByRole('button', { name: 'Crear registro' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Elegí el tipo');
    expect(gardenApi.createGardenActivity).not.toHaveBeenCalled();
    await user.selectOptions(within(dialog).getByLabelText('Tipo'), 'OTHER');
    await user.type(within(dialog).getByLabelText('Observaciones (opcional)'), '  Cantero norte ');
    await user.click(within(dialog).getByRole('button', { name: 'Crear registro' }));
    await waitFor(() => expect(gardenApi.createGardenActivity).toHaveBeenCalledTimes(1));
    const [body, key] = gardenApi.createGardenActivity.mock.calls[0]!;
    expect(body).toEqual({
      kind: 'OTHER',
      description: 'Desmalezar canteros',
      participantId: PABLO.id,
      frequency: 'ONE_TIME',
      notes: 'Cantero norte',
    });
    expect(key).toMatch(/^[a-f0-9]{32}$/);
    expect(await screen.findByText('Registro creado.')).toBeInTheDocument();
  });
});

describe('🥬 Huerta — 📝 Registros', () => {
  const OVERDUE = activity('1', 'Trasplantar TOMATE sintético', PABLO, {
    frequency: 'ONE_TIME',
    periodKey: 'ONE_TIME',
    kind: 'TRANSPLANT',
    scheduledDate: '2026-10-20',
    scheduleStatus: 'OVERDUE',
    agenda: 'OVERDUE',
    agendaDate: '2026-10-20',
  });
  const TODAY = activity('2', 'Regar huerta sintética', PABLO, { executionOrder: 1 });
  const WEEKLY = activity('3', 'Revisar riego sintético', ADMIN_P, {
    frequency: 'WEEKLY',
    periodKey: '2026-10-26',
    kind: null,
    suggestedWeekday: 5,
    suggestedDate: '2026-10-30',
    agenda: 'UPCOMING',
    agendaDate: '2026-10-30',
    canComplete: false,
  });
  const LEGACY = activity('4', 'Sembrar CHAUCHA sintética', PABLO, {
    frequency: 'ONE_TIME',
    periodKey: 'ONE_TIME',
    kind: null,
    agenda: 'NO_DATE',
    agendaDate: null,
    notes: null,
  });
  const DONE = activity('5', 'Ventilar invernadero sintético', ADMIN_P, {
    kind: 'OTHER',
    canComplete: false,
    currentExecution: {
      id: '00000000-0000-4000-8000-00000000e001',
      periodKey: '2026-10-27',
      completedAt: '2026-10-27T12:00:00.000Z',
      assignedTo: ADMIN_P,
      completedBy: ADMIN_P,
      canRevert: true,
    },
  });

  beforeEach(() => {
    gardenApi.fetchGardenParticipants.mockResolvedValue({ participants: [PABLO, ADMIN_P] });
    gardenApi.fetchGardenActivities.mockResolvedValue({
      period: PERIOD,
      viewer: { canWrite: true, canManage: true },
      activities: [OVERDUE, TODAY, WEEKLY, LEGACY, DONE],
    });
  });

  it('pestañas: Registros · Historial · Desempeño · Participantes (sin Cultivos ni Actividades)', async () => {
    renderGarden();
    const nav = await screen.findByRole('navigation', { name: 'Secciones de la Huerta' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['📝 Registros', '📅 Historial', '🏆 Desempeño', '👥 Participantes']);
  });

  it.each(['/kitchen-garden/crops', '/kitchen-garden/crops/abc', '/kitchen-garden/records'])(
    'la ruta anterior %s lleva a Registros',
    async (route) => {
      renderGarden(route);
      expect(await screen.findByRole('list', { name: 'Vencidas' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Registros' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    },
  );

  it('grupos en el orden del backend, completadas aparte y resumen solo de pendientes', async () => {
    renderGarden();
    await screen.findByRole('list', { name: 'Vencidas' });
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([
      '⚠️ Vencidas (1)',
      '📍 Para hoy (1)',
      '🗓️ Próximas (1)',
      '🕓 Sin fecha (1)',
      '✅ Completadas (1)',
    ]);
    expect(descriptionsIn('Para hoy')).toEqual(['Regar huerta sintética']);
    expect(descriptionsIn('Completadas')).toEqual(['Ventilar invernadero sintético']);
    const summary = screen.getByRole('list', { name: 'Resumen de pendientes' });
    expect(summary).toHaveTextContent('1 vencida');
    expect(summary).toHaveTextContent('1 para hoy');
    expect(summary).toHaveTextContent('1 en los próximos 7 días');
    // Una recurrente nunca aparece como vencida por su fecha sugerida.
    expect(descriptionsIn('Próximas')).toEqual(['Revisar riego sintético']);
  });

  it('tipo visible y «Sin clasificar» discreto; filtros por tipo y por persona', async () => {
    const user = userEvent.setup();
    renderGarden();
    await screen.findByRole('list', { name: 'Vencidas' });
    expect(
      within(screen.getByRole('list', { name: 'Sin fecha' })).getByText('Sin clasificar'),
    ).toHaveClass('garden-kind--unclassified');
    const types = screen.getByRole('group', { name: 'Filtrar por tipo' });
    await user.click(within(types).getByRole('button', { name: 'Sin clasificar' }));
    expect(allDescriptions()).toEqual(['Revisar riego sintético', 'Sembrar CHAUCHA sintética']);
    await user.click(within(types).getByRole('button', { name: '🪴 Trasplante' }));
    expect(allDescriptions()).toEqual(['Trasplantar TOMATE sintético']);
    await user.click(within(types).getByRole('button', { name: 'Todos' }));
    await user.click(screen.getByRole('button', { name: /Admin sintética/ }));
    expect(allDescriptions()).toEqual([
      'Revisar riego sintético',
      'Ventilar invernadero sintético',
    ]);
  });

  it('un participante crea y edita (también lo ajeno) pero no desactiva', async () => {
    asEmployee();
    gardenApi.fetchGardenActivities.mockResolvedValue({
      period: PERIOD,
      viewer: { canWrite: true, canManage: false },
      activities: [OVERDUE, WEEKLY],
    });
    renderGarden();
    await screen.findByRole('list', { name: 'Vencidas' });
    expect(screen.getByRole('button', { name: '+ Nuevo registro' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Editar: Revisar riego sintético' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Desactivar/ })).not.toBeInTheDocument();
  });

  it('quien no participa solo consulta (lo decide el backend en `viewer`)', async () => {
    asEmployee();
    gardenApi.fetchGardenActivities.mockResolvedValue({
      period: PERIOD,
      viewer: { canWrite: false, canManage: false },
      activities: [OVERDUE],
    });
    renderGarden();
    await screen.findByRole('list', { name: 'Vencidas' });
    expect(screen.queryByRole('button', { name: /Nuevo registro|Editar/ })).not.toBeInTheDocument();
  });

  it('clasificar un registro anterior envía solo el tipo y la versión; sin cambios no envía nada', async () => {
    const user = userEvent.setup();
    gardenApi.updateGardenActivity.mockResolvedValue({
      activity: { ...LEGACY, kind: 'SOWING', version: 2 },
    });
    renderGarden();
    await user.click(
      await screen.findByRole('button', { name: 'Editar: Sembrar CHAUCHA sintética' }),
    );
    let dialog = await screen.findByRole('dialog', { name: 'Editar registro' });
    expect((within(dialog).getByLabelText('Tipo') as HTMLSelectElement).value).toBe('');
    expect(within(dialog).getByText(/anterior a los tipos/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Editar registro' })).not.toBeInTheDocument(),
    );
    expect(gardenApi.updateGardenActivity).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Editar: Sembrar CHAUCHA sintética' }));
    dialog = await screen.findByRole('dialog', { name: 'Editar registro' });
    await user.selectOptions(within(dialog).getByLabelText('Tipo'), 'SOWING');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(gardenApi.updateGardenActivity).toHaveBeenCalledWith(LEGACY.id, {
        version: 1,
        kind: 'SOWING',
      }),
    );
    expect(await screen.findByText('Registro actualizado.')).toBeInTheDocument();
  });

  it('una recurrente muestra solo lo pertinente: sin fecha prevista, con su sugerencia en «Opciones avanzadas» abiertas', async () => {
    const user = userEvent.setup();
    renderGarden();
    await user.click(
      await screen.findByRole('button', { name: 'Editar: Revisar riego sintético' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Editar registro' });
    expect(within(dialog).queryByLabelText('Fecha prevista (opcional)')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Opciones avanzadas').closest('details')).toHaveAttribute(
      'open',
    );
    expect(within(dialog).getByLabelText('Día sugerido')).toHaveValue('5');
    expect(
      within(dialog).queryByRole('checkbox', { name: /Programar también el trasplante/ }),
    ).not.toBeInTheDocument();
  });

  it('409 al editar: muestra el aviso, no cierra y refresca el listado', async () => {
    const user = userEvent.setup();
    gardenApi.updateGardenActivity.mockRejectedValue(
      new ApiError(
        409,
        'Otra persona modificó este registro mientras lo editabas. Cerrá y volvé a abrirlo para ver los datos actuales.',
        'GARDEN_ACTIVITY_CHANGED',
      ),
    );
    renderGarden();
    await user.click(
      await screen.findByRole('button', { name: 'Editar: Trasplantar TOMATE sintético' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Editar registro' });
    const calls = gardenApi.fetchGardenActivities.mock.calls.length;
    await user.type(within(dialog).getByLabelText('Observaciones (opcional)'), 'Con cuidado');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Otra persona modificó');
    expect(gardenApi.updateGardenActivity).toHaveBeenCalledWith(OVERDUE.id, {
      version: 1,
      notes: 'Con cuidado',
    });
    await waitFor(() =>
      expect(gardenApi.fetchGardenActivities.mock.calls.length).toBeGreaterThan(calls),
    );
  });

  it('siembra «Una vez» + trasplante: valores editables, fecha validada y un solo envío ante doble clic', async () => {
    const user = userEvent.setup();
    let resolve!: (value: unknown) => void;
    gardenApi.createGardenActivity.mockImplementation(
      () => new Promise((done) => (resolve = done)),
    );
    renderGarden();
    await screen.findByRole('list', { name: 'Vencidas' });
    await user.click(screen.getByRole('button', { name: '+ Nuevo registro' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo registro' });
    const transplantBox = () =>
      within(dialog).queryByRole('checkbox', { name: /Programar también el trasplante/ });
    expect(transplantBox()).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Tipo'), 'SOWING');
    await user.type(within(dialog).getByLabelText('Descripción'), 'Sembrar LECHUGA');
    await user.selectOptions(within(dialog).getByLabelText('Responsable'), PABLO.id);
    await user.type(within(dialog).getByLabelText('Fecha prevista (opcional)'), '2026-11-05');
    await user.click(transplantBox()!);
    expect(within(dialog).getByText(/dos registros independientes/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Descripción del trasplante')).toHaveValue(
      'Trasplantar LECHUGA',
    );
    expect(within(dialog).getByLabelText('Responsable del trasplante')).toHaveValue(PABLO.id);
    await user.selectOptions(
      within(dialog).getByLabelText('Responsable del trasplante'),
      ADMIN_P.id,
    );
    await user.type(
      within(dialog).getByLabelText('Fecha prevista del trasplante (opcional)'),
      '2026-11-01',
    );
    const submitButton = within(dialog).getByRole('button', { name: 'Crear siembra y trasplante' });
    await user.click(submitButton);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'no puede ser anterior a la de la siembra',
    );
    expect(gardenApi.createGardenActivity).not.toHaveBeenCalled();
    const transplantDate = within(dialog).getByLabelText(
      'Fecha prevista del trasplante (opcional)',
    );
    await user.clear(transplantDate);
    await user.type(transplantDate, '2026-11-25');
    await user.dblClick(submitButton);
    await waitFor(() => expect(gardenApi.createGardenActivity).toHaveBeenCalledTimes(1));
    expect(gardenApi.createGardenActivity.mock.calls[0]![0]).toEqual({
      kind: 'SOWING',
      description: 'Sembrar LECHUGA',
      participantId: PABLO.id,
      frequency: 'ONE_TIME',
      scheduledDate: '2026-11-05',
      transplant: {
        description: 'Trasplantar LECHUGA',
        participantId: ADMIN_P.id,
        scheduledDate: '2026-11-25',
      },
    });
    resolve({ activity: TODAY, transplant: OVERDUE });
    expect(await screen.findByText('Siembra y trasplante creados.')).toBeInTheDocument();
    expect(gardenApi.createGardenActivity).toHaveBeenCalledTimes(1);
  });

  it('un reintento tras una falla de red reutiliza la misma clave (no duplica)', async () => {
    const user = userEvent.setup();
    gardenApi.createGardenActivity
      .mockRejectedValueOnce(new OfflineError())
      .mockResolvedValueOnce({ activity: TODAY, transplant: null });
    renderGarden();
    await screen.findByRole('list', { name: 'Vencidas' });
    await user.click(screen.getByRole('button', { name: '+ Nuevo registro' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo registro' });
    await user.selectOptions(within(dialog).getByLabelText('Tipo'), 'OTHER');
    await user.type(within(dialog).getByLabelText('Descripción'), 'Abonar canteros');
    await user.selectOptions(within(dialog).getByLabelText('Responsable'), PABLO.id);
    await user.click(within(dialog).getByRole('button', { name: 'Crear registro' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Sin conexión');
    await user.click(within(dialog).getByRole('button', { name: 'Crear registro' }));
    await waitFor(() => expect(gardenApi.createGardenActivity).toHaveBeenCalledTimes(2));
    const calls = gardenApi.createGardenActivity.mock.calls;
    expect(calls[1]![1]).toBe(calls[0]![1]);
  });

  it('un participante completa lo suyo sin diálogo; lo ajeno no se puede marcar', async () => {
    const user = userEvent.setup();
    asEmployee();
    gardenApi.completeGardenActivity.mockResolvedValue({ activity: TODAY });
    renderGarden();
    await screen.findByRole('list', { name: 'Vencidas' });
    expect(
      screen.getByRole('button', { name: 'Marcar como completada: Revisar riego sintético' }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'Marcar como completada: Regar huerta sintética' }),
    );
    await waitFor(() => expect(gardenApi.completeGardenActivity).toHaveBeenCalledWith(TODAY.id));
    expect(
      await screen.findByText('«Regar huerta sintética» quedó completada.'),
    ).toBeInTheDocument();
  });

  it('ADMIN registra quién la realizó: un participante activo, sin preselección', async () => {
    const user = userEvent.setup();
    gardenApi.completeGardenActivity.mockResolvedValue({ activity: TODAY });
    renderGarden();
    await screen.findByRole('list', { name: 'Vencidas' });
    await user.click(
      screen.getByRole('button', { name: 'Marcar como completada: Regar huerta sintética' }),
    );
    const dialog = await screen.findByRole('dialog', { name: '✅ Registrar actividad completada' });
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Elegí quién realizó la actividad.',
    );
    await user.click(within(dialog).getByRole('radio', { name: /Admin sintética/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    await waitFor(() =>
      expect(gardenApi.completeGardenActivity).toHaveBeenCalledWith(TODAY.id, ADMIN_P.id),
    );
  });

  it('las invalidaciones quedan en la Huerta: nunca Tareas, Desempeño general ni Inicio', async () => {
    const user = userEvent.setup();
    asEmployee();
    gardenApi.completeGardenActivity.mockResolvedValue({ activity: TODAY });
    const queryClient = createTestQueryClient();
    const seed = (key: readonly unknown[]) => queryClient.setQueryData(key, { seeded: true });
    const outside = [
      ['session', 'u-pablo', 'tasks', 'list', 'active'],
      ['session', 'u-pablo', 'dashboard'],
      ['session', 'u-pablo', 'performance', 'summary', '2026-10-21', '2026-10-27'],
    ];
    const inside = [
      ['session', 'u-pablo', 'kitchenGarden', 'history', 'current', 'all'],
      ['session', 'u-pablo', 'kitchenGarden', 'performance', 'summary', '2026-10-21', '2026-10-27'],
    ];
    for (const key of [...outside, ...inside]) seed(key);
    renderGarden('/kitchen-garden', queryClient);
    await screen.findByRole('list', { name: 'Vencidas' });
    await user.click(
      screen.getByRole('button', { name: 'Marcar como completada: Regar huerta sintética' }),
    );
    await waitFor(() => expect(queryClient.getQueryState(inside[0]!)?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(inside[1]!)?.isInvalidated).toBe(true);
    for (const key of outside) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
  });
});

describe('🥬 Huerta — participantes, historial y desempeño', () => {
  it('Participantes: un 409 por actividades activas se muestra en el diálogo y no se cierra', async () => {
    const user = userEvent.setup();
    gardenApi.fetchGardenParticipants.mockResolvedValue({ participants: [PABLO, ADMIN_P] });
    gardenApi.setGardenParticipantActive.mockRejectedValue(
      new ApiError(
        409,
        'No se puede desactivar: tiene 2 actividades activas asignadas. Reasignalas o desactivalas primero.',
        'GARDEN_PARTICIPANT_HAS_ACTIVITIES',
      ),
    );
    renderGarden('/kitchen-garden/participants');
    const people = await screen.findByRole('list', { name: 'Participantes de la Huerta' });
    expect(within(people).getByText('Administrador')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desactivar: Pablo sintético' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desactivar a Pablo sintético' });
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'tiene 2 actividades activas',
    );
    expect(gardenApi.setGardenParticipantActive).toHaveBeenCalledWith(PABLO.id, false);
  });

  it('Participantes (EMPLOYEE): consulta sin administrar', async () => {
    asEmployee();
    gardenApi.fetchGardenParticipants.mockResolvedValue({ participants: [PABLO] });
    renderGarden('/kitchen-garden/participants');
    await screen.findByRole('list', { name: 'Participantes de la Huerta' });
    expect(
      screen.queryByRole('button', { name: /Desactivar|Agregar participante/ }),
    ).not.toBeInTheDocument();
  });

  it('Historial: endpoint propio de la Huerta y sus textos', async () => {
    gardenApi.fetchGardenParticipants.mockResolvedValue({ participants: [PABLO] });
    gardenApi.fetchGardenHistory.mockResolvedValue({
      week: {
        start: '2026-10-26',
        end: '2026-11-01',
        days: [],
        isCurrent: true,
        timeZone: PERIOD.timeZone,
      },
      summary: { expected: 0, completed: 0 },
      recurring: [],
      others: [],
    });
    renderGarden('/kitchen-garden/history');
    expect(await screen.findByText('Sin actividades registradas esta semana.')).toBeInTheDocument();
    expect(gardenApi.fetchGardenHistory).toHaveBeenCalledWith({
      week: undefined,
      participantId: undefined,
    });
  });

  it('Desempeño: endpoints propios; sin obligaciones, «Sin actividades previstas» (nunca 0 %)', async () => {
    const empty: GardenPerformanceResponse = {
      generatedAt: PERIOD.generatedAt,
      range: {
        from: '2026-10-21',
        to: '2026-10-27',
        today: '2026-10-27',
        timeZone: PERIOD.timeZone,
        includesCurrentDay: true,
        maxDays: 30,
      },
      scope: 'team',
      team: {
        assigned: 0,
        completedPersonally: 0,
        percentage: null,
        pending: 0,
        coverageReceived: 0,
        coverageGiven: 0,
        operationalCompleted: 0,
      },
      special: { urgentCompleted: 0, oneTimeCompleted: 0, urgentPending: 0 },
      participants: [
        {
          participant: {
            id: PABLO.id,
            displayName: PABLO.displayName,
            colorHex: PABLO.colorHex,
            roleLabel: 'Jardinero',
            active: true,
          },
          assigned: 0,
          completedPersonally: 0,
          percentage: null,
          pending: 0,
          coverageReceived: 0,
          coverageGiven: 0,
          operationalCompleted: 0,
        },
      ],
    };
    gardenApi.fetchGardenPerformance.mockResolvedValue(empty);
    renderGarden('/kitchen-garden/performance');
    expect(await screen.findAllByText('Sin actividades previstas')).toHaveLength(2);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Huerta');
    expect(gardenApi.fetchGardenPerformance).toHaveBeenCalledTimes(1);
  });
});
