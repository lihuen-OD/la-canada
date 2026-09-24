import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/httpClient';
import {
  PERSON_A,
  PERSON_B,
  emptyHistory,
  listResponse,
  makeExecution,
  makeTask,
} from '../../test/fixtures/tasks';

const api = vi.hoisted(() => ({
  fetchTasks: vi.fn(),
  fetchTaskEmployees: vi.fn(),
  fetchTaskHistory: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  setTaskActive: vi.fn(),
  completeTask: vi.fn(),
  revertTaskCompletion: vi.fn(),
}));
const { useAuthMock, logoutMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  logoutMock: vi.fn(),
}));
vi.mock('../../api/tasksApi', () => api);
vi.mock('../../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { TasksScreen } from './TasksScreen';

const DAILY_A = makeTask();
const WEEKLY_B = makeTask({
  id: '00000000-0000-4000-8000-0000000000t2',
  description: 'Tarea sintética semanal',
  frequency: 'WEEKLY',
  assignee: { ...PERSON_B, active: true },
  periodKey: '2026-09-21',
});
const URGENT_A = makeTask({
  id: '00000000-0000-4000-8000-0000000000t3',
  description: 'Tarea sintética urgente',
  frequency: 'URGENT',
  periodKey: 'URGENT',
});

function asEmployee() {
  useAuthMock.mockReturnValue({
    user: { id: 'u-a', role: 'EMPLOYEE', status: 'ACTIVE', employee: { ...PERSON_A } },
    logout: logoutMock,
  });
}

function asAdmin() {
  useAuthMock.mockReturnValue({
    user: { id: 'u-admin', role: 'ADMIN', status: 'ACTIVE', employee: null },
    logout: logoutMock,
  });
}

async function renderLoaded(tasks = [DAILY_A, WEEKLY_B, URGENT_A]) {
  api.fetchTasks.mockResolvedValue(listResponse(tasks));
  render(<TasksScreen />);
  await screen.findByRole('list', { name: 'Tareas del período' });
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  logoutMock.mockReset();
  api.fetchTaskEmployees.mockResolvedValue({ employees: [PERSON_A, PERSON_B] });
  api.fetchTaskHistory.mockResolvedValue(emptyHistory());
  asEmployee();
});

describe('TasksScreen — carga y estados', () => {
  it('carga tareas y empleados reales del contrato, con ✅ Tareas como título', async () => {
    await renderLoaded();

    expect(screen.getByRole('heading', { level: 1, name: 'Tareas' })).toHaveTextContent('✅');
    expect(api.fetchTasks).toHaveBeenCalledWith('active');
    expect(api.fetchTaskEmployees).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Tarea sintética diaria')).toBeInTheDocument();
    expect(screen.getByText('Tarea sintética semanal')).toBeInTheDocument();
  });

  it('muestra carga, y un estado vacío real sin tareas', async () => {
    api.fetchTasks.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<TasksScreen />);
    expect(screen.getByRole('status')).toHaveTextContent(/cargando tareas/i);
    unmount();

    api.fetchTasks.mockResolvedValue(listResponse([]));
    render(<TasksScreen />);
    expect(await screen.findByText('Todavía no hay tareas.')).toBeInTheDocument();
  });

  it('error con reintento real', async () => {
    api.fetchTasks.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<TasksScreen />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/no pudimos cargar las tareas/i);

    api.fetchTasks.mockResolvedValue(listResponse([DAILY_A]));
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Tarea sintética diaria')).toBeInTheDocument();
  });

  it('sesión vencida (401 tras el reintento de httpClient) usa el cierre de sesión global', async () => {
    api.fetchTasks.mockRejectedValue(
      new ApiError(401, 'Autenticación requerida.', 'AUTH_REQUIRED'),
    );
    render(<TasksScreen />);
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
  });
});

describe('TasksScreen — filtros', () => {
  it('filtros semánticos: grupos con nombre, chips con aria-pressed y pendientes por persona', async () => {
    await renderLoaded();
    const people = screen.getByRole('group', { name: 'Filtrar por persona' });
    expect(within(people).getByRole('button', { name: 'Todos' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Persona A tiene 2 pendientes (diaria + urgente); el número se anuncia con su etiqueta.
    expect(
      within(people).getByRole('button', { name: 'Persona sintética A, 2 pendientes' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filtrar por frecuencia' })).toBeInTheDocument();
  });

  it('filtra por persona', async () => {
    await renderLoaded();
    await userEvent.setup().click(screen.getByRole('button', { name: /persona sintética b/i }));

    const list = screen.getByRole('list', { name: 'Tareas del período' });
    expect(within(list).getByText('Tarea sintética semanal')).toBeInTheDocument();
    expect(within(list).queryByText('Tarea sintética diaria')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /persona sintética b/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('filtra por frecuencia (🚨 Urgentes lleva texto, no solo emoji) y avisa si no hay resultados', async () => {
    await renderLoaded();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /urgentes/i }));
    const list = screen.getByRole('list', { name: 'Tareas del período' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText(/🚨 urgente/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mensuales' }));
    expect(screen.getByText('No hay tareas con estos filtros.')).toBeInTheDocument();
  });

  it('los chips se operan con teclado', async () => {
    await renderLoaded();
    const chip = screen.getByRole('button', { name: 'Semanales' });
    chip.focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('TasksScreen — permisos visibles', () => {
  it('EMPLOYEE no ve crear, editar, desactivar ni la vista administrativa', async () => {
    await renderLoaded();
    expect(screen.queryByRole('button', { name: /nueva tarea/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^editar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^desactivar/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/incluir desactivadas/i)).not.toBeInTheDocument();
  });

  it('ADMIN ve crear, editar, desactivar y la vista administrativa', async () => {
    asAdmin();
    await renderLoaded();
    expect(screen.getByRole('button', { name: /nueva tarea/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Editar: Tarea sintética diaria' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Desactivar: Tarea sintética diaria' }),
    ).toBeInTheDocument();

    await userEvent.setup().click(screen.getByLabelText(/incluir desactivadas/i));
    await waitFor(() => expect(api.fetchTasks).toHaveBeenLastCalledWith('all'));
  });

  it('desactivar pide confirmación explícita antes de llamar al backend', async () => {
    asAdmin();
    api.setTaskActive.mockResolvedValue({ task: { ...DAILY_A, active: false } });
    await renderLoaded();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Desactivar: Tarea sintética diaria' }));
    expect(api.setTaskActive).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/no se borra/i);
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    await waitFor(() => expect(api.setTaskActive).toHaveBeenCalledWith(DAILY_A.id, false));
  });
});

describe('TasksScreen — completar', () => {
  it('EMPLOYEE completa sin elegir ejecutor: nunca envía otro empleado', async () => {
    api.completeTask.mockResolvedValue({ task: DAILY_A });
    await renderLoaded();
    await userEvent
      .setup()
      .click(
        screen.getByRole('button', { name: 'Marcar como completada: Tarea sintética diaria' }),
      );

    await waitFor(() => expect(api.completeTask).toHaveBeenCalledTimes(1));
    expect(api.completeTask.mock.calls[0]).toEqual([DAILY_A.id]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(api.fetchTasks).toHaveBeenCalledTimes(2)); // refresco real
    expect(await screen.findByText(/quedó completada/i)).toBeInTheDocument();
  });

  it('bloquea el doble envío al completar', async () => {
    api.completeTask.mockReturnValue(new Promise(() => {}));
    await renderLoaded();
    const user = userEvent.setup();
    const button = screen.getByRole('button', {
      name: 'Marcar como completada: Tarea sintética diaria',
    });
    await user.click(button);
    await user.click(button);
    expect(api.completeTask).toHaveBeenCalledTimes(1);
  });

  it('conflicto concurrente (409): mensaje claro y refresco de la lista', async () => {
    api.completeTask.mockRejectedValue(
      new ApiError(
        409,
        'Esta tarea ya fue completada para el período actual.',
        'TASK_ALREADY_COMPLETED',
      ),
    );
    await renderLoaded();
    await userEvent
      .setup()
      .click(
        screen.getByRole('button', { name: 'Marcar como completada: Tarea sintética diaria' }),
      );

    expect(await screen.findByRole('alert')).toHaveTextContent('ya fue completada');
    await waitFor(() => expect(api.fetchTasks).toHaveBeenCalledTimes(2));
  });

  it('ADMIN debe elegir un empleado real antes de registrar', async () => {
    asAdmin();
    api.completeTask.mockResolvedValue({ task: DAILY_A });
    await renderLoaded();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'Marcar como completada: Tarea sintética diaria' }),
    );

    const dialog = screen.getByRole('dialog', { name: /registrar tarea completada/i });
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/elegí quién/i);
    expect(api.completeTask).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('radio', { name: /persona sintética b/i }));
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(api.completeTask).toHaveBeenCalledWith(DAILY_A.id, PERSON_B.id));
  });

  it('una completada muestra quién la hizo, y asignada vs. completada cuando difieren', async () => {
    const done = makeTask({
      currentExecution: makeExecution({
        assignedEmployee: PERSON_A,
        completedByEmployee: PERSON_B,
      }),
    });
    await renderLoaded([done]);
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent(
      'Asignada a Persona sintética A · Completada por Persona sintética B',
    );
    expect(item).toHaveTextContent(/hoy, 12:30/); // 15:30 UTC en la zona de negocio
  });
});

describe('TasksScreen — reversión', () => {
  it('deshacer nunca es un toggle silencioso: pide confirmación y luego revierte esa ejecución', async () => {
    const execution = makeExecution();
    const done = makeTask({ currentExecution: execution });
    api.revertTaskCompletion.mockResolvedValue({ task: DAILY_A });
    await renderLoaded([done]);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: 'Deshacer finalización: Tarea sintética diaria' }),
    );
    expect(api.revertTaskCompletion).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Deshacer finalización' });
    expect(dialog).toHaveAccessibleDescription(/queda registrado en la auditoría/i);

    await user.click(within(dialog).getByRole('button', { name: 'Deshacer' }));
    await waitFor(() =>
      expect(api.revertTaskCompletion).toHaveBeenCalledWith(done.id, execution.id, undefined),
    );
  });

  it('no ofrece revertir una finalización ajena (canRevert = false)', async () => {
    const done = makeTask({
      currentExecution: makeExecution({ completedByEmployee: PERSON_B, canRevert: false }),
    });
    await renderLoaded([done]);
    expect(
      screen.queryByRole('button', { name: /deshacer finalización/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('Completada');
  });

  it('ADMIN debe indicar motivo para corregir', async () => {
    asAdmin();
    const done = makeTask({ currentExecution: makeExecution() });
    api.revertTaskCompletion.mockResolvedValue({ task: DAILY_A });
    await renderLoaded([done]);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'Deshacer finalización: Tarea sintética diaria' }),
    );

    const dialog = screen.getByRole('dialog', { name: 'Corregir finalización' });
    await user.click(within(dialog).getByRole('button', { name: 'Corregir' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/motivo/i);
    await user.type(within(dialog).getByLabelText('Motivo'), 'Se registró por error');
    await user.click(within(dialog).getByRole('button', { name: 'Corregir' }));
    await waitFor(() =>
      expect(api.revertTaskCompletion).toHaveBeenCalledWith(
        done.id,
        done.currentExecution?.id,
        'Se registró por error',
      ),
    );
  });
});

describe('TasksScreen — historial semanal', () => {
  it('usa el endpoint específico, con título 📅 y el filtro por persona', async () => {
    await renderLoaded();
    expect(await screen.findByRole('heading', { name: /historial semanal/i })).toHaveTextContent(
      '📅',
    );
    expect(api.fetchTaskHistory).toHaveBeenCalledWith({ week: undefined, employeeId: undefined });

    await userEvent.setup().click(screen.getByRole('button', { name: /persona sintética b/i }));
    await waitFor(() =>
      expect(api.fetchTaskHistory).toHaveBeenLastCalledWith({
        week: undefined,
        employeeId: PERSON_B.id,
      }),
    );
  });

  it('selector de semana pide la semana elegida', async () => {
    await renderLoaded();
    await screen.findByRole('heading', { name: /historial semanal/i });
    await userEvent.setup().selectOptions(screen.getByLabelText('Semana'), '2026-09-14');
    await waitFor(() =>
      expect(api.fetchTaskHistory).toHaveBeenLastCalledWith({
        week: '2026-09-14',
        employeeId: undefined,
      }),
    );
  });

  it('muestra tareas hoy desactivadas y una única completada que ya no está en el operativo', async () => {
    const execution = makeExecution({ periodKey: 'ONE_TIME', canRevert: false });
    api.fetchTaskHistory.mockResolvedValue(
      emptyHistory({
        summary: { expected: 7, completed: 3 },
        recurring: [
          {
            task: {
              id: 'hist-1',
              description: 'Diaria sintética desactivada',
              frequency: 'DAILY',
              active: false,
              assignee: PERSON_A,
            },
            slots: [
              { periodKey: '2026-09-22', expected: false, execution: makeExecution({ id: 'x2' }) },
            ],
          },
        ],
        others: [
          {
            task: {
              id: 'hist-2',
              description: 'Única sintética completada',
              frequency: 'ONE_TIME',
              active: true,
              assignee: PERSON_A,
            },
            execution,
          },
        ],
      }),
    );
    await renderLoaded([DAILY_A]);

    const history = (await screen.findByRole('heading', { name: /historial semanal/i })).closest(
      'section',
    ) as HTMLElement;
    expect(await within(history).findByText('Única sintética completada')).toBeInTheDocument();
    expect(within(history).getAllByText('Diaria sintética desactivada').length).toBeGreaterThan(0);
    expect(within(history).getAllByText('Desactivada').length).toBeGreaterThan(0);
    expect(within(history).getByRole('status')).toHaveTextContent('3 de 7');
    // La única completada no está en el listado operativo.
    expect(
      within(screen.getByRole('list', { name: 'Tareas del período' })).queryByText(
        'Única sintética completada',
      ),
    ).not.toBeInTheDocument();
  });
});
