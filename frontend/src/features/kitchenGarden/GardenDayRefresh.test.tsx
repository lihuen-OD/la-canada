import { StrictMode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '../../test/render';
import { resetBusinessDayForTests } from '../../connectivity/businessDay';
import type { GardenActivitiesResponse } from '../../api/kitchenGardenTypes';

const gardenApi = vi.hoisted(() => ({
  fetchGardenParticipants: vi.fn(),
  fetchGardenActivities: vi.fn(),
}));
const tasksApi = vi.hoisted(() => ({ fetchTasks: vi.fn(), fetchTaskHistory: vi.fn() }));
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('../../api/kitchenGardenApi', () => gardenApi);
vi.mock('../../api/tasksApi', () => tasksApi);
vi.mock('../../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { BusinessDayRefresh } from '../../app/BusinessDayRefresh';
import KitchenGardenModule from './KitchenGardenModule';

/**
 * 🥬 Huerta con el reloj del día COMPARTIDO (el mismo de Tareas, Inicio y
 * Desempeño): sus actividades informan el día y la hora del servidor, y al
 * confirmarse el día nuevo se revalidan una vez — sin temporizadores propios,
 * sondeo ni pedidos a ✅ Tareas. Datos sintéticos.
 */
const TZ = 'America/Argentina/Buenos_Aires';
const ar = (day: string, time = '12:00:00') => new Date(`${day}T${time}.000-03:00`);
const serverDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(Date.now());

function activitiesResponse(): GardenActivitiesResponse {
  const today = serverDay();
  return {
    period: { today, weekStart: '2026-10-26', timeZone: TZ, generatedAt: new Date().toISOString() },
    activities: [
      {
        id: '00000000-0000-4000-8000-0000000b0001',
        description: 'Sembrar lechuga (sintética)',
        frequency: 'ONE_TIME',
        active: true,
        responsible: { id: 'p1', displayName: 'Pablo sintético', colorHex: null, active: true },
        periodKey: 'ONE_TIME',
        scheduledDate: '2026-10-27',
        scheduleStatus: today < '2026-10-27' ? 'SCHEDULED' : 'DUE_TODAY',
        executionOrder: null,
        suggestedWeekday: null,
        suggestedFirstHalfDay: null,
        suggestedSecondHalfDay: null,
        suggestedMonthDay: null,
        suggestedMonth: null,
        suggestedDate: null,
        currentExecution: null,
        canComplete: true,
      },
    ],
  };
}

function deviceAt(instant: Date) {
  vi.setSystemTime(instant);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  for (const mock of [...Object.values(gardenApi), ...Object.values(tasksApi)]) mock.mockReset();
  gardenApi.fetchGardenParticipants.mockResolvedValue({
    participants: [
      {
        id: 'p1',
        displayName: 'Pablo sintético',
        colorHex: null,
        active: true,
        roleLabel: 'Jardinero',
        userActive: true,
      },
    ],
  });
  gardenApi.fetchGardenActivities.mockImplementation(async () => activitiesResponse());
  useAuthMock.mockReturnValue({
    user: { id: 'u-admin', role: 'ADMIN', status: 'ACTIVE', displayName: null, employee: null },
    logout: vi.fn(),
  });
});

afterEach(() => {
  resetBusinessDayForTests();
  vi.useRealTimers();
});

describe('🥬 Huerta y el cambio de día', () => {
  it('al confirmarse el día nuevo, las actividades se revalidan una vez (Programada → Para hoy)', async () => {
    vi.setSystemTime(ar('2026-10-26', '23:59:00'));
    resetBusinessDayForTests();
    render(
      <StrictMode>
        <BusinessDayRefresh />
        <Routes>
          <Route path="/kitchen-garden/*" element={<KitchenGardenModule />} />
        </Routes>
      </StrictMode>,
      { route: '/kitchen-garden' },
    );
    expect(await screen.findByText('Programada')).toBeInTheDocument();
    const before = gardenApi.fetchGardenActivities.mock.calls.length;
    deviceAt(ar('2026-10-27', '00:00:05'));
    expect(await screen.findByText('Para hoy')).toBeInTheDocument();
    await waitFor(() => expect(gardenApi.fetchGardenActivities).toHaveBeenCalledTimes(before + 1));
    expect(tasksApi.fetchTasks).not.toHaveBeenCalled();
    expect(tasksApi.fetchTaskHistory).not.toHaveBeenCalled();
  });
});
