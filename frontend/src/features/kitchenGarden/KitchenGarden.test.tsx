import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/httpClient';
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

const list = () => screen.getByRole('list', { name: 'Actividades del período' });
const descriptions = () =>
  within(list())
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.task-item__description')?.textContent);

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
        name: /Agregar participante|Nueva actividad|Crear actividad/,
      }),
    ).not.toBeInTheDocument();
  });

  it('con participantes y sin actividades: «Crear actividad» abre «Nueva actividad» y envía el participante', async () => {
    const user = userEvent.setup();
    gardenApi.fetchGardenParticipants.mockResolvedValue({ participants: [PABLO] });
    gardenApi.createGardenActivity.mockResolvedValue({ activity: activity('1', 'Regar', PABLO) });
    renderGarden();
    expect(await screen.findByText('Todavía no hay actividades.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crear actividad' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva actividad' });
    // Sin persona elegida por defecto.
    expect((within(dialog).getByLabelText('Responsable') as HTMLSelectElement).value).toBe('');
    await user.type(within(dialog).getByLabelText('Descripción'), 'Regar almácigos');
    await user.selectOptions(within(dialog).getByLabelText('Responsable'), PABLO.id);
    await user.selectOptions(within(dialog).getByLabelText('Frecuencia'), 'DAILY');
    await user.click(within(dialog).getByRole('button', { name: 'Crear actividad' }));
    await waitFor(() => expect(gardenApi.createGardenActivity).toHaveBeenCalledTimes(1));
    const body = gardenApi.createGardenActivity.mock.calls[0]?.[0];
    expect(body).toEqual({
      description: 'Regar almácigos',
      participantId: PABLO.id,
      frequency: 'DAILY',
    });
    expect(body).not.toHaveProperty('employeeId');
  });
});

describe('🥬 Huerta — actividades', () => {
  const ONE = activity('1', 'Única sintética 15/01', PABLO, {
    frequency: 'ONE_TIME',
    periodKey: 'ONE_TIME',
    scheduledDate: '2027-01-15',
    scheduleStatus: 'SCHEDULED',
    executionOrder: 2,
  });
  const DAILY_P = activity('2', 'Regar almácigos', PABLO, { executionOrder: 1 });
  const DAILY_A = activity('3', 'Ventilar invernadero', ADMIN_P, { canComplete: false });

  beforeEach(() => {
    gardenApi.fetchGardenParticipants.mockResolvedValue({ participants: [PABLO, ADMIN_P] });
    gardenApi.fetchGardenActivities.mockResolvedValue({
      period: PERIOD,
      activities: [ONE, DAILY_P, DAILY_A],
    });
  });

  it('el orden del backend se respeta y los filtros por participante y frecuencia no reordenan', async () => {
    const user = userEvent.setup();
    renderGarden();
    await screen.findByRole('list', { name: 'Actividades del período' });
    expect(descriptions()).toEqual([
      'Única sintética 15/01',
      'Regar almácigos',
      'Ventilar invernadero',
    ]);
    await user.click(screen.getByRole('button', { name: /Pablo sintético/ }));
    expect(descriptions()).toEqual(['Única sintética 15/01', 'Regar almácigos']);
    await user.click(
      within(screen.getByRole('group', { name: 'Filtrar por frecuencia' })).getByRole('button', {
        name: 'Diarias',
      }),
    );
    expect(descriptions()).toEqual(['Regar almácigos']);
  });

  it('«Una vez»: «Hoy»/«Vencidas» hablan de actividades', async () => {
    const user = userEvent.setup();
    renderGarden();
    await screen.findByRole('list', { name: 'Actividades del período' });
    await user.click(
      within(screen.getByRole('group', { name: 'Filtrar por frecuencia' })).getByRole('button', {
        name: 'Una vez',
      }),
    );
    expect(screen.getByRole('button', { name: 'Hoy, 0 actividades' })).toBeInTheDocument();
  });

  it('un participante completa lo suyo sin diálogo; lo ajeno no se puede marcar', async () => {
    const user = userEvent.setup();
    asEmployee();
    gardenApi.completeGardenActivity.mockResolvedValue({ activity: DAILY_P });
    renderGarden();
    await screen.findByRole('list', { name: 'Actividades del período' });
    expect(
      screen.getByRole('button', { name: 'Marcar como completada: Ventilar invernadero' }),
    ).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Marcar como completada: Regar almácigos' }),
    );
    await waitFor(() => expect(gardenApi.completeGardenActivity).toHaveBeenCalledWith(DAILY_P.id));
    expect(await screen.findByText('«Regar almácigos» quedó completada.')).toBeInTheDocument();
  });

  it('ADMIN registra quién la realizó: un participante activo, sin preselección', async () => {
    const user = userEvent.setup();
    gardenApi.completeGardenActivity.mockResolvedValue({ activity: DAILY_P });
    renderGarden();
    await screen.findByRole('list', { name: 'Actividades del período' });
    await user.click(
      screen.getByRole('button', { name: 'Marcar como completada: Regar almácigos' }),
    );
    const dialog = await screen.findByRole('dialog', { name: '✅ Registrar actividad completada' });
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Elegí quién realizó la actividad.',
    );
    await user.click(within(dialog).getByRole('radio', { name: /Admin sintética/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    await waitFor(() =>
      expect(gardenApi.completeGardenActivity).toHaveBeenCalledWith(DAILY_P.id, ADMIN_P.id),
    );
  });

  it('las invalidaciones quedan en la Huerta: nunca Tareas, Desempeño general ni Inicio', async () => {
    const user = userEvent.setup();
    asEmployee();
    gardenApi.completeGardenActivity.mockResolvedValue({ activity: DAILY_P });
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
    await screen.findByRole('list', { name: 'Actividades del período' });
    await user.click(
      screen.getByRole('button', { name: 'Marcar como completada: Regar almácigos' }),
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
