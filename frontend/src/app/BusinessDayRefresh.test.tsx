import { StrictMode } from 'react';
import { onlineManager } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '../test/render';
import { PERSON_A, PERSON_B, emptyHistory, listResponse, makeTask } from '../test/fixtures/tasks';
import { resetBusinessDayForTests } from '../connectivity/businessDay';

const api = vi.hoisted(() => ({
  fetchTasks: vi.fn(),
  fetchTaskEmployees: vi.fn(),
  fetchTaskHistory: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  setTaskActive: vi.fn(),
  completeTask: vi.fn(),
  revertTaskCompletion: vi.fn(),
  deleteTask: vi.fn(),
}));
const performanceApi = vi.hoisted(() => ({
  fetchPerformance: vi.fn(),
  fetchEmployeePerformance: vi.fn(),
}));
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('../api/tasksApi', () => api);
vi.mock('../api/performanceApi', () => performanceApi);
vi.mock('../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { BusinessDayRefresh } from './BusinessDayRefresh';
import { TasksScreen } from '../features/tasks/TasksScreen';
import { PerformanceScreen } from '../features/tasks/PerformanceScreen';

/** Instante `HH:MM:SS` de Buenos Aires (UTC−3) del día `YYYY-MM-DD`. */
const ar = (day: string, time = '12:00:00') => new Date(`${day}T${time}.000-03:00`);

const ONE_TIME = makeTask({
  id: '00000000-0000-4000-8000-0000000000o1',
  description: 'Única sintética con fecha',
  frequency: 'ONE_TIME',
  periodKey: 'ONE_TIME',
  scheduledDate: '2026-10-26',
});
/** Domingo 25/10 (todavía programada) y lunes 26/10 (ya es para hoy, semana nueva). */
const sunday = {
  ...listResponse([{ ...ONE_TIME, scheduleStatus: 'SCHEDULED' as const }]),
  period: {
    today: '2026-10-25',
    weekStart: '2026-10-19',
    timeZone: 'America/Argentina/Buenos_Aires',
  },
};
const monday = {
  ...listResponse([{ ...ONE_TIME, scheduleStatus: 'DUE_TODAY' as const }]),
  period: {
    today: '2026-10-26',
    weekStart: '2026-10-26',
    timeZone: 'America/Argentina/Buenos_Aires',
  },
};

function goTo(instant: Date) {
  vi.setSystemTime(instant);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  // Solo se simula la fecha: los temporizadores son reales (Testing Library y TanStack Query).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ar('2026-10-25', '23:59:00'));
  resetBusinessDayForTests();
  for (const mock of [...Object.values(api), ...Object.values(performanceApi)]) mock.mockReset();
  api.fetchTaskEmployees.mockResolvedValue({ employees: [PERSON_A, PERSON_B] });
  api.fetchTaskHistory.mockResolvedValue(emptyHistory());
  api.fetchTasks.mockResolvedValueOnce(sunday).mockResolvedValue(monday);
  useAuthMock.mockReturnValue({
    user: { id: 'u-admin', role: 'ADMIN', status: 'ACTIVE', employee: null },
    logout: vi.fn(),
  });
});

afterEach(() => {
  onlineManager.setOnline(true);
  resetBusinessDayForTests();
  vi.useRealTimers();
});

describe('cambio de día de negocio con Tareas abierta', () => {
  it('revalida lista e historial una vez, no el catálogo, y conserva el formulario abierto', async () => {
    render(
      <StrictMode>
        <BusinessDayRefresh />
        <TasksScreen />
      </StrictMode>,
      { route: '/tasks' },
    );
    expect(await screen.findByText('Programada')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Nueva tarea' }));
    await user.type(screen.getByLabelText('Descripción'), 'Borrador sintético');
    const tasksBefore = api.fetchTasks.mock.calls.length;
    const historyBefore = api.fetchTaskHistory.mock.calls.length;
    const employeesBefore = api.fetchTaskEmployees.mock.calls.length;

    goTo(ar('2026-10-26', '00:00:02'));

    expect(await screen.findByText('Para hoy')).toBeInTheDocument();
    expect(api.fetchTasks).toHaveBeenCalledTimes(tasksBefore + 1);
    await waitFor(() => expect(api.fetchTaskHistory).toHaveBeenCalledTimes(historyBefore + 1));
    expect(api.fetchTaskEmployees).toHaveBeenCalledTimes(employeesBefore);
    // El formulario sigue abierto con lo que se escribió.
    expect(screen.getByRole('dialog', { name: 'Nueva tarea' })).toBeInTheDocument();
    expect(screen.getByLabelText('Descripción')).toHaveValue('Borrador sintético');
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('sin conexión no pide nada; al reconectar revalida una sola vez y no reenvía escrituras', async () => {
    render(
      <>
        <BusinessDayRefresh />
        <TasksScreen />
      </>,
      { route: '/tasks' },
    );
    expect(await screen.findByText('Programada')).toBeInTheDocument();
    const tasksBefore = api.fetchTasks.mock.calls.length;

    onlineManager.setOnline(false);
    goTo(ar('2026-10-26', '07:00:00'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.fetchTasks).toHaveBeenCalledTimes(tasksBefore);

    onlineManager.setOnline(true);
    window.dispatchEvent(new Event('online'));
    expect(await screen.findByText('Para hoy')).toBeInTheDocument();
    expect(api.fetchTasks).toHaveBeenCalledTimes(tasksBefore + 1);
    for (const write of [api.createTask, api.updateTask, api.completeTask, api.setTaskActive])
      expect(write).not.toHaveBeenCalled();
  });

  it('el mismo día, volver a la pestaña no genera requests', async () => {
    render(
      <>
        <BusinessDayRefresh />
        <TasksScreen />
      </>,
      { route: '/tasks' },
    );
    expect(await screen.findByText('Programada')).toBeInTheDocument();
    const calls = api.fetchTasks.mock.calls.length;
    goTo(ar('2026-10-25', '23:59:30'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.fetchTasks).toHaveBeenCalledTimes(calls);
  });
});

describe('cambio de día de negocio con Desempeño abierto', () => {
  it('pide el rango nuevo (que termina el día nuevo) una sola vez', async () => {
    const response = (from: string, to: string) => ({
      range: {
        from,
        to,
        timeZone: 'America/Argentina/Buenos_Aires',
        includesCurrentDay: true,
        maxDays: 30,
      },
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
      employees: [],
      trend: [],
    });
    performanceApi.fetchPerformance.mockImplementation(async (from: string, to: string) =>
      response(from, to),
    );
    render(
      <>
        <BusinessDayRefresh />
        <PerformanceScreen />
      </>,
      { route: '/tasks/performance' },
    );
    await waitFor(() =>
      expect(performanceApi.fetchPerformance).toHaveBeenCalledWith('2026-10-19', '2026-10-25'),
    );
    goTo(ar('2026-10-26', '00:00:02'));
    await waitFor(() =>
      expect(performanceApi.fetchPerformance).toHaveBeenLastCalledWith('2026-10-20', '2026-10-26'),
    );
    expect(performanceApi.fetchPerformance).toHaveBeenCalledTimes(2);
  });
});
