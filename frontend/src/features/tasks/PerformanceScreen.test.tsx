import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchPerformance, fetchEmployeePerformance, useAuth } = vi.hoisted(() => ({
  fetchPerformance: vi.fn(),
  fetchEmployeePerformance: vi.fn(),
  useAuth: vi.fn(),
}));
vi.mock('../../api/performanceApi', () => ({ fetchPerformance, fetchEmployeePerformance }));
vi.mock('../../auth/useAuth', () => ({ useAuth }));
import { PerformanceScreen } from './PerformanceScreen';

const response = {
  range: {
    from: '2026-09-18',
    to: '2026-09-24',
    timeZone: 'America/Argentina/Buenos_Aires',
    includesCurrentDay: true,
    maxDays: 90,
  },
  team: {
    expected: 2,
    completed: 0,
    percentage: 0,
    performed: 1,
    coveredOthers: 1,
    receivedHelp: 1,
  },
  special: { urgentCompleted: 0, oneTimeCompleted: 0, urgentPending: 1 },
  employees: [
    {
      employee: {
        id: '11111111-1111-4111-8111-111111111111',
        displayName: 'Persona sintética',
        role: 'Rol',
        colorHex: '#466547',
      },
      expected: 2,
      completed: 0,
      percentage: 0,
      performed: 1,
      coveredOthers: 1,
      receivedHelp: 1,
      dailyStreak: null,
    },
  ],
  trend: [],
  occurrences: [],
};

describe('PerformanceScreen', () => {
  beforeEach(() => {
    fetchPerformance.mockResolvedValue(response);
    fetchEmployeePerformance.mockResolvedValue(response);
    useAuth.mockReturnValue({ user: { role: 'ADMIN' }, logout: vi.fn() });
  });
  it('muestra 0% distinto de Sin datos, resumen, racha y controles accesibles', async () => {
    render(
      <MemoryRouter>
        <PerformanceScreen />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Desempeño' })).toBeInTheDocument();
    expect(await screen.findAllByText('0%')).not.toHaveLength(0);
    expect(screen.getByText(/Sin datos/)).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: /Cumplimiento de Persona sintética: 0%/ }),
    ).toBeInTheDocument();
  });
  it('abre el detalle bajo demanda', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PerformanceScreen />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: /Persona sintética/ }));
    await waitFor(() => expect(fetchEmployeePerformance).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Detalle' })).toBeInTheDocument();
  });
  it('representa porcentaje null como Sin datos', async () => {
    fetchPerformance.mockResolvedValue({
      ...response,
      team: { ...response.team, expected: 0, percentage: null },
      employees: [{ ...response.employees[0], expected: 0, percentage: null }],
    });
    render(
      <MemoryRouter>
        <PerformanceScreen />
      </MemoryRouter>,
    );
    expect((await screen.findAllByText('Sin datos')).length).toBeGreaterThan(1);
  });
});
