import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '../../test/render';
import { emptyHistory } from '../../test/fixtures/tasks';

const { fetchTaskHistory, useAuth } = vi.hoisted(() => ({
  fetchTaskHistory: vi.fn(),
  useAuth: vi.fn(),
}));
vi.mock('../../api/tasksApi', () => ({ fetchTaskHistory }));
vi.mock('../../auth/useAuth', () => ({ useAuth }));

import { TaskHistory } from './TaskHistory';

function renderHistory(currentWeekStart: string) {
  const props = {
    today: currentWeekStart,
    employeeId: null,
    employeeName: null,
    onRevert: vi.fn(),
    onSessionExpired: vi.fn(),
  };
  const view = render(<TaskHistory currentWeekStart={currentWeekStart} {...props} />);
  return {
    ...view,
    rollTo: (next: string) =>
      view.rerender(<TaskHistory currentWeekStart={next} {...props} today={next} />),
  };
}

beforeEach(() => {
  fetchTaskHistory.mockReset();
  fetchTaskHistory.mockResolvedValue(emptyHistory());
  useAuth.mockReturnValue({ user: { id: 'u-a', role: 'EMPLOYEE' } });
});

describe('TaskHistory — cambio de semana con la pantalla abierta', () => {
  it('«Esta semana» sigue a la semana vigente cuando llega el lunes', async () => {
    const { rollTo } = renderHistory('2026-10-19');
    const select = await screen.findByLabelText('Semana');
    expect(select).toHaveValue('2026-10-19');
    rollTo('2026-10-26');
    expect(select).toHaveValue('2026-10-26');
    expect(screen.getByRole('option', { name: 'Esta semana' })).toHaveValue('2026-10-26');
    expect(screen.getByRole('option', { name: 'Semana del 19/10/2026' })).toBeInTheDocument();
    // Sigue siendo la consulta de la semana vigente (sin parámetro de semana).
    expect(fetchTaskHistory.mock.calls.every(([params]) => params.week === undefined)).toBe(true);
  });

  it('una semana anterior elegida se conserva al cambiar de semana', async () => {
    const { rollTo } = renderHistory('2026-10-19');
    const select = await screen.findByLabelText('Semana');
    await userEvent.setup().selectOptions(select, '2026-10-12');
    await waitFor(() =>
      expect(fetchTaskHistory).toHaveBeenLastCalledWith({
        week: '2026-10-12',
        employeeId: undefined,
      }),
    );
    rollTo('2026-10-26');
    expect(select).toHaveValue('2026-10-12');
  });
});
