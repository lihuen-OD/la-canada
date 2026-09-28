import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DashboardResponse } from '../../api/dashboardTypes';
import { createTestQueryClient, render, screen, waitFor, within } from '../../test/render';

const mocks = vi.hoisted(() => ({ getDashboard: vi.fn(), logout: vi.fn() }));
vi.mock('../../api/dashboardApi', () => ({ getDashboard: mocks.getDashboard }));
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', role: 'EMPLOYEE', employee: { id: 'employee-1' } },
    logout: mocks.logout,
  }),
}));

import { AuthenticatedHome } from './AuthenticatedHome';

const dashboard: DashboardResponse = {
  generatedAt: '2026-09-25T12:00:00.000Z',
  today: '2026-09-25',
  timeZone: 'America/Argentina/Cordoba',
  kpis: { tasksCompleted: 3, tasksTotal: 5, urgentPending: 1, stockAlerts: 1, goodEggsToday: 7 },
  urgentTasks: [
    {
      id: 't1',
      description: 'Revisar bomba',
      assignee: { id: 'e1', displayName: 'Coke', colorHex: '#4a7c59' },
    },
  ],
  performance: {
    scope: 'team',
    range: { from: '2026-09-19', to: '2026-09-25', timeZone: 'America/Argentina/Buenos_Aires' },
    employees: [
      {
        employee: { id: 'e2', displayName: 'Juan (sintético)', colorHex: '#2c5364' },
        assigned: 10,
        completedPersonally: 8,
        percentage: 80,
        pending: 1,
        coverageReceived: 1,
        coverageGiven: 0,
      },
      {
        employee: { id: 'e1', displayName: 'Coke', colorHex: '#4a7c59' },
        assigned: 3,
        completedPersonally: 2,
        percentage: 66.7,
        pending: 1,
        coverageReceived: 0,
        coverageGiven: 1,
      },
    ],
  },
  stockAlerts: [
    {
      id: 's1',
      name: 'Alimento',
      area: 'GARDEN',
      unit: 'kg',
      minimumQuantity: '10',
      currentQuantity: '4',
      stockLevel: 'low',
    },
  ],
  upcomingEvents: [
    {
      kind: 'event',
      id: 'ev1',
      title: 'Visita técnica',
      date: '2026-09-26',
      type: 'VISIT',
      note: null,
      daysUntil: 1,
    },
  ],
  latestNews: [
    {
      id: 'n1',
      text: 'Portón revisado',
      createdAt: new Date().toISOString(),
      employee: { id: 'e1', displayName: 'Coke', colorHex: '#4a7c59' },
    },
  ],
};

function renderHome(queryClient = createTestQueryClient(), strict = false) {
  const content = (
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<AuthenticatedHome />} />
        <Route path="/tasks" element={<p>Tareas destino</p>} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{content}</StrictMode> : content, { queryClient });
}

describe('Dashboard de Inicio', () => {
  it('renderiza los bloques y KPIs originales con datos reales del DTO', async () => {
    mocks.getDashboard.mockResolvedValueOnce(dashboard);
    renderHome();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Buenos días 👋' }),
    ).toBeInTheDocument();
    expect(screen.getByText('3/5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '🚨 Urgentes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '👥 Avance del equipo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '⚠️ Stock bajo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '📅 Próximos eventos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '📝 Últimas novedades' })).toBeInTheDocument();
    expect(screen.queryByText(/clima|mascotas/i)).not.toBeInTheDocument();
  });

  it('ADMIN: avance del equipo con las métricas canónicas del backend, período y enlace a Desempeño', async () => {
    mocks.getDashboard.mockResolvedValueOnce(dashboard);
    renderHome();
    const card = (await screen.findByRole('heading', { name: '👥 Avance del equipo' })).closest(
      'section',
    ) as HTMLElement;
    expect(within(card).getByText('Últimos 7 días · 19/09/2026 al 25/09/2026')).toBeInTheDocument();
    expect(within(card).getByLabelText('Cumplimiento personal: 80%')).toBeInTheDocument();
    expect(within(card).getByLabelText('Cumplimiento personal: 66,7%')).toBeInTheDocument();
    expect(card).toHaveTextContent(
      '8/10 realizadas personalmente · Pendientes 1 · Coberturas recibidas 1',
    );
    expect(document.body.textContent).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    expect(within(card).getByRole('link', { name: 'Ver desempeño' })).toHaveAttribute(
      'href',
      '/tasks/performance',
    );
  });

  it('EMPLOYEE: «Mi desempeño» solo con sus propias cifras', async () => {
    mocks.getDashboard.mockResolvedValueOnce({
      ...dashboard,
      performance: {
        ...dashboard.performance!,
        scope: 'self',
        employees: [dashboard.performance!.employees[0]!],
      },
    });
    renderHome();
    const card = (await screen.findByRole('heading', { name: '🏆 Mi desempeño' })).closest(
      'section',
    ) as HTMLElement;
    expect(within(card).getByText('80%')).toBeInTheDocument();
    expect(within(card).getByText('Cumplimiento personal')).toBeInTheDocument();
    const facts: [string, string][] = [
      ['Asignadas', '10'],
      ['Realizadas personalmente', '8'],
      ['Pendientes', '1'],
      ['Coberturas recibidas', '1'],
      ['Coberturas realizadas', '0'],
    ];
    for (const [label, value] of facts) {
      expect(within(card).getByText(label).nextSibling).toHaveTextContent(value);
    }
    expect(card).not.toHaveTextContent('Coke');
    expect(screen.queryByRole('heading', { name: '👥 Avance del equipo' })).not.toBeInTheDocument();
  });

  it('muestra los estados vacíos reales', async () => {
    mocks.getDashboard.mockResolvedValueOnce({
      ...dashboard,
      urgentTasks: [],
      performance: { ...dashboard.performance!, employees: [] },
      stockAlerts: [],
      upcomingEvents: [],
      latestNews: [],
    });
    renderHome();
    expect(await screen.findByText('Sin urgentes 🎉')).toBeInTheDocument();
    expect(screen.getByText('Todo el stock en orden ✅')).toBeInTheDocument();
    expect(screen.getByText('Sin eventos próximos')).toBeInTheDocument();
    expect(screen.getByText('Sin novedades')).toBeInTheDocument();
  });

  it('navega con Link, sin recargar el documento', async () => {
    mocks.getDashboard.mockResolvedValueOnce(dashboard);
    renderHome();
    await screen.findByText('Revisar bomba');
    await userEvent.setup().click(screen.getByRole('link', { name: /ver tareas/i }));
    expect(screen.getByText('Tareas destino')).toBeInTheDocument();
  });

  it('StrictMode deduplica la carga y una revisita fresca hace cero requests', async () => {
    mocks.getDashboard.mockResolvedValue(dashboard);
    const queryClient = createTestQueryClient();
    const first = renderHome(queryClient, true);
    await screen.findByText('Revisar bomba');
    expect(mocks.getDashboard).toHaveBeenCalledTimes(1);
    first.unmount();
    renderHome(queryClient, true);
    await screen.findByText('Revisar bomba');
    await waitFor(() => expect(mocks.getDashboard).toHaveBeenCalledTimes(1));
  });

  it('conserva el contenido mientras revalida', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['session', 'user-1', 'dashboard'], dashboard);
    await queryClient.invalidateQueries({ queryKey: ['session', 'user-1', 'dashboard'] });
    mocks.getDashboard.mockReturnValueOnce(new Promise(() => {}));
    renderHome(queryClient);
    expect(screen.getByText('Revisar bomba')).toBeInTheDocument();
    expect(screen.getByText('Actualizando…')).toBeInTheDocument();
  });
});
