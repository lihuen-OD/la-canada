import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '../../test/render';
import { emptyHistory, makeExecution, PERSON_A } from '../../test/fixtures/tasks';

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

describe('TaskHistory — carga olvidada y frecuencia histórica', () => {
  const task = (frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY') => ({
    id: '00000000-0000-4000-8000-0000000000t9',
    description: `Tarea sintética que cambió (${frequency})`,
    frequency,
    active: true,
    assignee: PERSON_A,
    scheduledDate: null,
  });

  it('muestra la fecha real y el registro (sin hora inventada), en orden de realización', async () => {
    fetchTaskHistory.mockResolvedValue(
      emptyHistory({
        recurring: [
          {
            task: task('DAILY'),
            slots: [
              {
                periodKey: '2026-09-22',
                expected: false,
                execution: makeExecution({
                  id: 'late',
                  periodKey: '2026-09-22',
                  performedOn: '2026-09-22',
                  completedAt: '2026-09-24T13:00:00.000Z',
                }),
              },
              {
                periodKey: '2026-09-23',
                expected: false,
                execution: makeExecution({
                  id: 'normal',
                  periodKey: '2026-09-23',
                  completedAt: '2026-09-23T14:00:00.000Z',
                }),
              },
            ],
          },
        ],
      }),
    );
    renderHistory('2026-09-21');
    const lines = await screen.findAllByText(/Completada por/);
    expect(lines.map((line) => line.textContent)).toEqual([
      'Completada por Persona sintética A · Realizada el 22/09 · Registrada el 24/09',
      'Completada por Persona sintética A · 23/09/2026 11:00',
    ]);
  });

  it('una tarea que cambió de frecuencia en la semana: una fila por frecuencia, con su etiqueta', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchTaskHistory.mockResolvedValue(
      emptyHistory({
        recurring: [
          {
            task: task('DAILY'),
            slots: [{ periodKey: '2026-09-24', expected: true, execution: null }],
          },
          {
            task: task('WEEKLY'),
            slots: [
              {
                periodKey: '2026-09-21',
                expected: false,
                execution: makeExecution({ periodKey: '2026-09-21' }),
              },
            ],
          },
        ],
      }),
    );
    renderHistory('2026-09-21');
    const grid = await screen.findByRole('list', { name: 'Diarias y semanales de la semana' });
    const rows = within(grid).getAllByText(/Tarea sintética que cambió/);
    expect(rows.map((row) => row.textContent)).toEqual([
      'Tarea sintética que cambió (DAILY)',
      'Tarea sintética que cambió (WEEKLY)',
    ]);
    expect(within(grid).getByText('Semanal')).toBeInTheDocument();
    expect(errors.mock.calls.some(([message]) => String(message).includes('same key'))).toBe(false);
    errors.mockRestore();
  });
});
