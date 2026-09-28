import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '../../test/render';
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
  it('muestra 0% como porcentaje real, sin racha ni «Sin datos», con controles accesibles', async () => {
    render(
      <MemoryRouter>
        <PerformanceScreen />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Desempeño' })).toBeInTheDocument();
    expect(await screen.findAllByText('0%')).not.toHaveLength(0);
    expect(screen.queryByText(/Sin datos/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/🔥|racha/i);
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
  it('A. 0 asignadas: «Sin tareas en el período», sin porcentaje numérico y barra neutra', async () => {
    const empty = {
      assigned: 0,
      completedPersonally: 0,
      percentage: null,
      pending: 0,
      coverageReceived: 0,
      coverageGiven: 0,
      operationalCompleted: 0,
    };
    fetchPerformance.mockResolvedValue({
      ...response,
      team: empty,
      employees: [{ ...response.employees[0]!, ...empty }],
    });
    render(
      <MemoryRouter>
        <PerformanceScreen />
      </MemoryRouter>,
    );
    expect((await screen.findAllByText('Sin tareas en el período')).length).toBe(2);
    const bar = screen.getByRole('progressbar', {
      name: 'Cumplimiento de Persona sintética: Sin tareas en el período',
    });
    expect(bar).toHaveClass('performance-person__bar--neutral');
    expect(document.body.textContent).not.toMatch(/\d%|Sin datos/);
    expect(
      screen.getByText(/Sin completar 0 · Le cubrieron 0 · Cubrió a otros 0/),
    ).toBeInTheDocument();
  });

  it('B. 5 asignadas y 0 realizadas: 0% y Sin completar 5 (no es «sin tareas»)', async () => {
    const none = {
      assigned: 5,
      completedPersonally: 0,
      percentage: 0,
      pending: 5,
      coverageReceived: 0,
      coverageGiven: 0,
      operationalCompleted: 0,
    };
    fetchPerformance.mockResolvedValue({
      ...response,
      team: none,
      employees: [{ ...response.employees[0]!, ...none }],
    });
    render(
      <MemoryRouter>
        <PerformanceScreen />
      </MemoryRouter>,
    );
    expect((await screen.findAllByText('0%')).length).toBe(2);
    expect(screen.getByText(/Sin completar 5/)).toBeInTheDocument();
    expect(screen.queryByText('Sin tareas en el período')).not.toBeInTheDocument();
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
    expect(
      screen.getByText(/Sin completar 1 · Le cubrieron 1 · Cubrió a otros 0/),
    ).toBeInTheDocument();
    expect(screen.getByText('Cumplimiento personal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Persona sintética/ }));
    expect(await screen.findAllByText('✅ Propia')).toHaveLength(2);
    expect(screen.getByText('🤝 Le cubrieron')).toBeInTheDocument();
    expect(screen.getByText('Sin completar')).toBeInTheDocument();
    expect(screen.getByText('🤝 Cubrió a otros')).toBeInTheDocument();
    const detail = screen
      .getByRole('heading', { name: 'Detalle' })
      .closest('section') as HTMLElement;
    expect(detail).toHaveTextContent('22/09/2026 · Diaria');
    expect(detail.textContent).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
  });

  it('rangos públicos exactamente 7, 14 y 30 días; abre en 7 y cada uno es una consulta distinta', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PerformanceScreen />
      </MemoryRouter>,
    );
    const group = await screen.findByRole('group', { name: 'Período' });
    const chips = within(group).getAllByRole('button');
    expect(chips.map((chip) => chip.textContent)).toEqual(['7 días', '14 días', '30 días']);
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/90|3 meses/)).not.toBeInTheDocument();
    await waitFor(() => expect(fetchPerformance).toHaveBeenCalledTimes(1));
    const span = (from: string, to: string) =>
      Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    const [from7, to7] = fetchPerformance.mock.calls[0]!;
    expect(span(from7, to7)).toBe(7);
    await user.click(chips[1]!);
    await user.click(chips[2]!);
    await waitFor(() => expect(fetchPerformance).toHaveBeenCalledTimes(3));
    expect(fetchPerformance.mock.calls.map(([from, to]) => span(from, to))).toEqual([7, 14, 30]);
  });

  it('caso Cami: 1 de 2 hechas por ella y 1 cubierta → 50%, Sin completar 0, Le cubrieron 1', async () => {
    fetchPerformance.mockResolvedValue({
      ...response,
      employees: [
        {
          ...response.employees[0]!,
          employee: { ...response.employees[0]!.employee, displayName: 'Cami (sintética)' },
          assigned: 2,
          completedPersonally: 1,
          percentage: 50,
          pending: 0,
          coverageReceived: 1,
          coverageGiven: 0,
          operationalCompleted: 1,
        },
      ],
    });
    render(
      <MemoryRouter>
        <PerformanceScreen />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('progressbar', { name: 'Cumplimiento de Cami (sintética): 50%' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(
      screen.getByText(/Sin completar 0 · Le cubrieron 1 · Cubrió a otros 0/),
    ).toBeInTheDocument();
  });
});
