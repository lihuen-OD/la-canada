import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DashboardResponse } from '../../api/dashboardTypes';
import { createTestQueryClient, render, screen, waitFor } from '../../test/render';

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
  teamProgress: [
    {
      employee: { id: 'e1', displayName: 'Coke', colorHex: '#4a7c59' },
      completed: 3,
      total: 5,
      percentage: 60,
    },
  ],
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

  it('muestra los estados vacíos reales', async () => {
    mocks.getDashboard.mockResolvedValueOnce({
      ...dashboard,
      urgentTasks: [],
      teamProgress: [],
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
