import { StrictMode } from 'react';
import { onlineManager } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '../test/render';
import { PERSON_A, PERSON_B, emptyHistory, makeTask } from '../test/fixtures/tasks';
import { resetBusinessDayForTests } from '../connectivity/businessDay';
import type { TasksListResponse } from '../api/taskTypes';

const api = vi.hoisted(() => ({
  fetchTasks: vi.fn(),
  fetchTaskEmployees: vi.fn(),
  fetchTaskHistory: vi.fn(),
  fetchTaskCalendar: vi.fn(),
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
const dashboardApi = vi.hoisted(() => ({ getDashboard: vi.fn() }));
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('../api/tasksApi', () => api);
vi.mock('../api/performanceApi', () => performanceApi);
vi.mock('../api/dashboardApi', () => dashboardApi);
vi.mock('../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { BusinessDayRefresh } from './BusinessDayRefresh';
import { TasksScreen } from '../features/tasks/TasksScreen';
import { PerformanceScreen } from '../features/tasks/PerformanceScreen';
import { AuthenticatedHome } from '../features/home/AuthenticatedHome';
import { TaskCalendar } from '../features/more/TaskCalendar';

const TZ = 'America/Argentina/Buenos_Aires';
const MINUTE = 60_000;
/** Instante `HH:MM:SS` de Buenos Aires (UTC−3) del día `YYYY-MM-DD`. */
const ar = (day: string, time = '12:00:00') => new Date(`${day}T${time}.000-03:00`);

/**
 * Backend SIMULADO con su propio reloj: `serverOffsetMs` es su diferencia con
 * el dispositivo (negativo = el dispositivo está adelantado). Cada respuesta
 * informa el día del servidor y, salvo en un backend anterior
 * (`serverSendsTime = false`), su hora. La «Una vez» sintética es para el
 * 26/10: programada el 25, para hoy el 26.
 */
let serverOffsetMs = 0;
let serverSendsTime = true;
const serverNow = () => Date.now() + serverOffsetMs;
const serverDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(serverNow());
const serverTime = () => (serverSendsTime ? new Date(serverNow()).toISOString() : undefined);
const performanceCalls: { from: string; to: string; serverDay: string }[] = [];

const ONE_TIME = makeTask({
  id: '00000000-0000-4000-8000-0000000000o1',
  description: 'Única sintética con fecha',
  frequency: 'ONE_TIME',
  periodKey: 'ONE_TIME',
  scheduledDate: '2026-10-26',
});

const WEEKLY_SUGGESTED = makeTask({
  id: '00000000-0000-4000-8000-0000000000w1',
  description: 'Semanal sintética con sugerencia',
  frequency: 'WEEKLY',
  suggestedWeekday: 1,
});

function tasksResponse(): TasksListResponse {
  const today = serverDay();
  return {
    period: {
      today,
      weekStart: today === '2026-10-25' ? '2026-10-19' : '2026-10-26',
      timeZone: TZ,
      generatedAt: serverTime(),
    },
    tasks: [
      { ...ONE_TIME, scheduleStatus: today < '2026-10-26' ? 'SCHEDULED' : 'DUE_TODAY' },
      // Semanal con sugerencia «lunes»: la fecha del período vigente la calcula el backend.
      {
        ...WEEKLY_SUGGESTED,
        periodKey: today < '2026-10-26' ? '2026-10-19' : '2026-10-26',
        suggestedDate: today < '2026-10-26' ? '2026-10-19' : '2026-10-26',
      },
    ],
  };
}

/** Ubicación de la semanal en el calendario de octubre: desde su semana vigente. */
function calendarResponse(month: string) {
  const current = serverDay() < '2026-10-26';
  return {
    month,
    today: serverDay(),
    suggestions: [
      {
        taskId: WEEKLY_SUGGESTED.id,
        from: current ? '2026-10-19' : '2026-10-26',
        dates: current ? ['2026-10-19', '2026-10-26'] : ['2026-10-26'],
      },
    ],
  };
}

function dashboardResponse() {
  const today = serverDay();
  return {
    generatedAt: serverTime(),
    today,
    timeZone: TZ,
    // El KPI no cuenta la «Una vez» mientras está programada para más adelante.
    kpis: {
      tasksCompleted: 0,
      tasksTotal: today < '2026-10-26' ? 0 : 1,
      urgentPending: 0,
      stockAlerts: 0,
      goodEggsToday: 0,
    },
    urgentTasks: [],
    performance: null,
    stockAlerts: [],
    upcomingEvents: [],
    petDue: { counts: { overdue: 0, dueToday: 0, upcoming: 0 }, items: [] },
    latestNews: [],
  };
}

function performanceResponse(from: string, requestedTo: string) {
  const today = serverDay();
  performanceCalls.push({ from, to: requestedTo, serverDay: today });
  const to = requestedTo > today ? today : requestedTo;
  return {
    generatedAt: serverTime(),
    range: { from, to, today, timeZone: TZ, includesCurrentDay: to === today, maxDays: 30 },
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
  };
}

/** Mueve el reloj del dispositivo y vuelve a la pestaña (los temporizadores reales no se esperan). */
function deviceAt(instant: Date) {
  vi.setSystemTime(instant);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const homeKpi = () => screen.getByRole('link', { name: /Tareas completadas/ }).textContent;

beforeEach(() => {
  // Solo se simula la fecha: los temporizadores son reales (Testing Library y TanStack Query).
  vi.useFakeTimers({ toFake: ['Date'] });
  serverOffsetMs = 0;
  serverSendsTime = true;
  performanceCalls.length = 0;
  for (const mock of [
    ...Object.values(api),
    ...Object.values(performanceApi),
    ...Object.values(dashboardApi),
  ])
    mock.mockReset();
  api.fetchTaskEmployees.mockResolvedValue({ employees: [PERSON_A, PERSON_B] });
  api.fetchTaskHistory.mockResolvedValue(emptyHistory());
  api.fetchTasks.mockImplementation(async () => tasksResponse());
  api.fetchTaskCalendar.mockImplementation(async (month: string) => calendarResponse(month));
  dashboardApi.getDashboard.mockImplementation(async () => dashboardResponse());
  performanceApi.fetchPerformance.mockImplementation(async (from: string, to: string) =>
    performanceResponse(from, to),
  );
  useAuthMock.mockReturnValue({
    user: { id: 'u-admin', role: 'ADMIN', status: 'ACTIVE', displayName: null, employee: null },
    logout: vi.fn(),
  });
});

afterEach(() => {
  onlineManager.setOnline(true);
  resetBusinessDayForTests();
  vi.useRealTimers();
});

async function startAt(device: Date, ui: React.ReactNode) {
  vi.setSystemTime(device);
  resetBusinessDayForTests();
  render(<StrictMode>{ui}</StrictMode>, { route: '/tasks' });
}

describe('cambio de día con el dispositivo adelantado', () => {
  it('Tareas, Inicio y Desempeño: nada cambia a la medianoche del dispositivo; los tres pasan juntos a la del servidor', async () => {
    serverOffsetMs = -5 * MINUTE; // dispositivo 23:58, servidor 23:53
    await startAt(
      ar('2026-10-25', '23:58:00'),
      <>
        <BusinessDayRefresh />
        <TasksScreen />
        <AuthenticatedHome />
        <PerformanceScreen />
      </>,
    );
    expect(await screen.findByText('Programada')).toBeInTheDocument();
    await waitFor(() => expect(homeKpi()).toContain('0/0'));
    await waitFor(() =>
      expect(performanceApi.fetchPerformance).toHaveBeenLastCalledWith('2026-10-19', '2026-10-25'),
    );
    const before = {
      tasks: api.fetchTasks.mock.calls.length,
      history: api.fetchTaskHistory.mock.calls.length,
      employees: api.fetchTaskEmployees.mock.calls.length,
      dashboard: dashboardApi.getDashboard.mock.calls.length,
      performance: performanceCalls.length,
    };

    // Medianoche del DISPOSITIVO (servidor 23:55:30): el backend sigue en el 25.
    deviceAt(ar('2026-10-26', '00:00:30'));
    await settle();
    expect(screen.getByText('Programada')).toBeInTheDocument();
    expect(homeKpi()).toContain('0/0');
    expect(api.fetchTasks).toHaveBeenCalledTimes(before.tasks);
    expect(dashboardApi.getDashboard).toHaveBeenCalledTimes(before.dashboard);
    expect(performanceCalls).toHaveLength(before.performance);

    // Medianoche del SERVIDOR: los tres quedan en el 26.
    deviceAt(ar('2026-10-26', '00:05:02'));
    expect(await screen.findByText('Para hoy')).toBeInTheDocument();
    await waitFor(() => expect(homeKpi()).toContain('0/1'));
    await waitFor(() =>
      expect(performanceApi.fetchPerformance).toHaveBeenLastCalledWith('2026-10-20', '2026-10-26'),
    );
    await waitFor(() => expect(api.fetchTaskHistory).toHaveBeenCalledTimes(before.history + 1));
    expect(api.fetchTasks).toHaveBeenCalledTimes(before.tasks + 1);
    expect(dashboardApi.getDashboard).toHaveBeenCalledTimes(before.dashboard + 1);
    expect(api.fetchTaskEmployees).toHaveBeenCalledTimes(before.employees);
    // Desempeño confirma con su rango vigente y pide UNA vez el rango nuevo; nunca un día que el servidor no alcanzó.
    expect(performanceCalls.filter((call) => call.to === '2026-10-26')).toHaveLength(1);
    for (const call of performanceCalls) expect(call.to <= call.serverDay).toBe(true);
  });

  it('backend sin hora (versión anterior): si responde con el día anterior, la pantalla no cambia', async () => {
    serverOffsetMs = -5 * MINUTE;
    serverSendsTime = false;
    await startAt(
      ar('2026-10-25', '23:58:00'),
      <>
        <BusinessDayRefresh />
        <TasksScreen />
        <PerformanceScreen />
      </>,
    );
    expect(await screen.findByText('Programada')).toBeInTheDocument();
    const historyBefore = api.fetchTaskHistory.mock.calls.length;

    deviceAt(ar('2026-10-26', '00:00:30')); // el dispositivo cree que es el 26
    await waitFor(() => expect(performanceCalls.at(-1)?.serverDay).toBe('2026-10-25'));
    await settle();
    expect(screen.getByText('Programada')).toBeInTheDocument();
    expect(api.fetchTaskHistory).toHaveBeenCalledTimes(historyBefore);
    expect(performanceApi.fetchPerformance).toHaveBeenLastCalledWith('2026-10-19', '2026-10-25');

    deviceAt(ar('2026-10-26', '00:05:02')); // el servidor ya está en el 26
    expect(await screen.findByText('Para hoy')).toBeInTheDocument();
    await waitFor(() => expect(api.fetchTaskHistory).toHaveBeenCalledTimes(historyBefore + 1));
    await waitFor(() =>
      expect(performanceApi.fetchPerformance).toHaveBeenLastCalledWith('2026-10-20', '2026-10-26'),
    );
    for (const call of performanceCalls) expect(call.to <= call.serverDay).toBe(true);
  });
});

describe('cambio de día con el dispositivo atrasado', () => {
  it('el día cambia a la medianoche del servidor, antes que la del dispositivo', async () => {
    serverOffsetMs = 5 * MINUTE; // dispositivo 23:50, servidor 23:55
    await startAt(
      ar('2026-10-25', '23:50:00'),
      <>
        <BusinessDayRefresh />
        <TasksScreen />
      </>,
    );
    expect(await screen.findByText('Programada')).toBeInTheDocument();
    deviceAt(ar('2026-10-25', '23:55:02')); // servidor 00:00:02 del 26
    expect(await screen.findByText('Para hoy')).toBeInTheDocument();
  });
});

describe('pestaña oculta y reconexión', () => {
  it('oculta toda la noche y sin Internet: no pide nada; al reconectar revalida una vez, conserva el formulario y no reenvía escrituras', async () => {
    await startAt(
      ar('2026-10-25', '22:00:00'),
      <>
        <BusinessDayRefresh />
        <TasksScreen />
      </>,
    );
    expect(await screen.findByText('Programada')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Nueva tarea' }));
    await user.type(screen.getByLabelText('Descripción'), 'Borrador sintético');
    const tasksBefore = api.fetchTasks.mock.calls.length;

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    onlineManager.setOnline(false);
    deviceAt(ar('2026-10-26', '07:00:00'));
    await settle();
    expect(api.fetchTasks).toHaveBeenCalledTimes(tasksBefore);

    onlineManager.setOnline(true);
    window.dispatchEvent(new Event('online'));
    expect(await screen.findByText('Para hoy')).toBeInTheDocument();
    expect(api.fetchTasks).toHaveBeenCalledTimes(tasksBefore + 1);
    expect(screen.getByRole('dialog', { name: 'Nueva tarea' })).toBeInTheDocument();
    expect(screen.getByLabelText('Descripción')).toHaveValue('Borrador sintético');
    for (const write of [api.createTask, api.updateTask, api.completeTask, api.setTaskActive])
      expect(write).not.toHaveBeenCalled();
  });

  it('el mismo día, volver a la pestaña o reconectar no genera requests', async () => {
    await startAt(
      ar('2026-10-25', '18:00:00'),
      <>
        <BusinessDayRefresh />
        <TasksScreen />
      </>,
    );
    expect(await screen.findByText('Programada')).toBeInTheDocument();
    const calls = api.fetchTasks.mock.calls.length;
    deviceAt(ar('2026-10-25', '23:59:30'));
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(api.fetchTasks).toHaveBeenCalledTimes(calls);
  });
});

describe('programación sugerida al cambiar de semana', () => {
  it('la fecha sugerida y el calendario pasan a la semana nueva recién cuando el servidor la confirma', async () => {
    serverOffsetMs = -5 * MINUTE; // dispositivo adelantado
    await startAt(
      ar('2026-10-25', '23:58:00'),
      <>
        <BusinessDayRefresh />
        <TasksScreen />
        <TaskCalendar />
      </>,
    );
    expect(await screen.findByText('Sugerida: lunes 19/10/2026')).toBeInTheDocument();
    await waitFor(() => expect(api.fetchTaskCalendar).toHaveBeenCalledWith('2026-10'));
    const calendarCalls = api.fetchTaskCalendar.mock.calls.length;

    deviceAt(ar('2026-10-26', '00:00:30')); // medianoche del dispositivo: el servidor sigue en el 25
    await settle();
    expect(screen.getByText('Sugerida: lunes 19/10/2026')).toBeInTheDocument();
    expect(api.fetchTaskCalendar).toHaveBeenCalledTimes(calendarCalls);

    deviceAt(ar('2026-10-26', '00:05:02')); // el servidor ya está en la semana nueva
    expect(await screen.findByText('Sugerida: lunes 26/10/2026')).toBeInTheDocument();
    await waitFor(() => expect(api.fetchTaskCalendar).toHaveBeenCalledTimes(calendarCalls + 1));
    // El 19 ya no se ubica por la sugerencia: el día anterior al período vigente conserva la marca de siempre.
    const grid = screen.getByRole('group', { name: 'Octubre 2026' });
    await waitFor(() =>
      expect(
        within(grid).getByRole('button', { name: /^26, hoy, \d+ tareas/ }),
      ).toBeInTheDocument(),
    );
  });
});
