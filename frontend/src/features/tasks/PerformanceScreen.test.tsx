import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '../../test/render';
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
    assigned: 2,
    completedPersonally: 0,
    percentage: 0,
    pending: 1,
    coverageReceived: 1,
    coverageGiven: 1,
    operationalCompleted: 1,
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
      assigned: 2,
      completedPersonally: 0,
      percentage: 0,
      pending: 1,
      coverageReceived: 1,
      coverageGiven: 0,
      operationalCompleted: 0,
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
      team: { ...response.team, assigned: 0, percentage: null },
      employees: [{ ...response.employees[0], assigned: 0, percentage: null }],
    });
    render(
      <MemoryRouter>
        <PerformanceScreen />
      </MemoryRouter>,
    );
    expect((await screen.findAllByText('Sin datos')).length).toBeGreaterThan(1);
  });
  it('muestra las métricas personales del backend (8/10 = 80%) y las coberturas por separado', async () => {
    const juan = {
      ...response.employees[0]!,
      assigned: 10,
      completedPersonally: 8,
      percentage: 80,
      pending: 1,
      coverageReceived: 1,
      coverageGiven: 0,
      operationalCompleted: 8,
    };
    const occurrence = (
      status: 'personal' | 'covered' | 'pending',
      assignedEmployeeId = juan.employee.id,
    ) => ({
      taskId: `t-${status}-${assignedEmployeeId}`,
      description: `Tarea ${status} (sintética)`,
      frequency: 'URGENT' as const,
      periodKey: 'URGENT',
      assignedEmployeeId,
      completed: status !== 'pending',
      completedByEmployeeId: null,
      assignedEmployee: null,
      completedByEmployee: null,
      completedAt: null,
      status,
    });
    fetchPerformance.mockResolvedValue({ ...response, employees: [juan] });
    fetchEmployeePerformance.mockResolvedValue({
      ...response,
      employees: [juan],
      occurrences: [
        occurrence('personal'),
        occurrence('covered'),
        occurrence('pending'),
        occurrence('personal', 'otra-persona'),
        {
          ...occurrence('personal'),
          taskId: 't-daily',
          frequency: 'DAILY' as const,
          periodKey: '2026-09-22',
        },
      ],
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PerformanceScreen />
      </MemoryRouter>,
    );
    expect(await screen.findByText('80%')).toBeInTheDocument();
    expect(screen.getByText('8/10')).toBeInTheDocument();
    expect(screen.getByText(/Coberturas recibidas 1/)).toBeInTheDocument();
    expect(screen.getByText('Cumplimiento personal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Persona sintética/ }));
    expect(await screen.findAllByText('✅ Propia')).toHaveLength(2);
    expect(screen.getByText('🤝 Cubierta por otra persona')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByText('🤝 Cobertura realizada')).toBeInTheDocument();
    const detail = screen
      .getByRole('heading', { name: 'Detalle' })
      .closest('section') as HTMLElement;
    expect(detail).toHaveTextContent('22/09/2026 · Diaria');
    expect(detail.textContent).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
  });
});
