import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '../../test/render';
import { ApiError } from '../../api/httpClient';
import { NETWORK_ERROR_MESSAGE, OFFLINE_WRITE_MESSAGE } from '../../api/errorMessages';
import { OfflineError } from '../../api/transportErrors';
import type { PerformanceOccurrence, PerformanceResponse } from '../../api/performanceTypes';

const api = vi.hoisted(() => ({
  fetchPerformance: vi.fn(),
  fetchEmployeePerformance: vi.fn(),
  fetchEmployeePerformancePage: vi.fn(),
  registerLateCompletion: vi.fn(),
  revertTaskCompletion: vi.fn(),
  fetchTaskEmployees: vi.fn(),
  useAuth: vi.fn(),
}));
vi.mock('../../api/performanceApi', () => ({
  fetchPerformance: api.fetchPerformance,
  fetchEmployeePerformance: api.fetchEmployeePerformance,
  fetchEmployeePerformancePage: api.fetchEmployeePerformancePage,
}));
vi.mock('../../api/tasksApi', () => ({
  registerLateCompletion: api.registerLateCompletion,
  revertTaskCompletion: api.revertTaskCompletion,
  fetchTaskEmployees: api.fetchTaskEmployees,
}));
vi.mock('../../auth/useAuth', () => ({ useAuth: api.useAuth }));
import { PerformanceScreen, type PerformanceSource } from './PerformanceScreen';

/**
 * «Marcar como realizada» desde Desempeño → Detalle (carga olvidada). La
 * pantalla solo presenta lo que decide el backend (`lateCompletion`,
 * `completeInTasks`, `lateRegistration`) y nunca envía responsable,
 * frecuencia ni estado. Datos sintéticos.
 */
const COKE = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Coke (sintética)',
  role: 'Doméstica',
  colorHex: '#466547',
};
const JUAN = {
  id: '22222222-2222-4222-8222-222222222222',
  displayName: 'Juan (sintético)',
  role: 'Parque',
  colorHex: '#2c5364',
};
const metrics = {
  assigned: 6,
  completedPersonally: 2,
  percentage: 33.3,
  pending: 4,
  coverageReceived: 0,
  coverageGiven: 0,
  operationalCompleted: 2,
};
const occurrence = (overrides: Partial<PerformanceOccurrence>): PerformanceOccurrence => ({
  taskId: 't-daily',
  description: 'Aspirar planta baja',
  frequency: 'DAILY',
  status: 'pending',
  periodKey: '2026-10-29',
  assignedEmployeeId: COKE.id,
  completed: false,
  completedByEmployeeId: null,
  assignedEmployee: COKE,
  completedByEmployee: null,
  completedAt: null,
  ...overrides,
});
const fixed = (date: string) => ({
  periodStart: date,
  periodEnd: date,
  earliest: date,
  latest: date,
});
const OCCURRENCES: PerformanceOccurrence[] = [
  occurrence({ lateCompletion: fixed('2026-10-29') }),
  occurrence({
    taskId: 't-weekly',
    description: 'Limpiar vidrios',
    frequency: 'WEEKLY',
    periodKey: '2026-10-19',
    lateCompletion: {
      periodStart: '2026-10-19',
      periodEnd: '2026-10-25',
      earliest: '2026-10-21',
      latest: '2026-10-25',
    },
  }),
  occurrence({
    taskId: 't-done',
    description: 'Regar macetas',
    periodKey: '2026-10-28',
    status: 'personal',
    completed: true,
    completedByEmployeeId: COKE.id,
    completedByEmployee: COKE,
    completedAt: '2026-10-28T15:00:00.000Z',
  }),
  occurrence({
    taskId: 't-late',
    description: 'Barrer galería',
    periodKey: '2026-10-27',
    status: 'personal',
    completed: true,
    completedByEmployeeId: COKE.id,
    completedByEmployee: COKE,
    completedAt: '2026-10-30T13:00:00.000Z',
    lateRegistration: {
      executionId: 'x-late',
      performedOn: '2026-10-27',
      recordedAt: '2026-10-30T13:00:00.000Z',
      canRevert: true,
    },
  }),
  occurrence({
    taskId: 't-once',
    description: 'Ordenar depósito',
    frequency: 'ONE_TIME',
    periodKey: 'ONE_TIME',
    completeInTasks: true,
  }),
  occurrence({
    taskId: 't-old',
    description: 'Sin acción (fuera de la ventana)',
    periodKey: '2026-09-20',
  }),
];
const response = (occurrences = OCCURRENCES): PerformanceResponse => ({
  range: {
    from: '2026-10-24',
    to: '2026-10-30',
    today: '2026-10-30',
    timeZone: 'America/Argentina/Buenos_Aires',
    includesCurrentDay: true,
    maxDays: 30,
  },
  team: metrics,
  special: { urgentCompleted: 0, oneTimeCompleted: 0, urgentPending: 0 },
  employees: [{ employee: COKE, ...metrics }],
  trend: [],
  occurrences,
});

function setRole(role: 'ADMIN' | 'EMPLOYEE') {
  api.useAuth.mockReturnValue({ user: { id: `u-${role}`, role }, logout: vi.fn() });
}

async function openDetail(source?: PerformanceSource) {
  const user = userEvent.setup();
  const utils = render(
    <MemoryRouter>
      <PerformanceScreen {...(source ? { source } : {})} />
    </MemoryRouter>,
  );
  await user.click(await screen.findByRole('button', { name: /Coke \(sintética\)/ }));
  const detail = (await screen.findByRole('heading', { name: 'Detalle' })).closest(
    'section',
  ) as HTMLElement;
  return { user, detail, ...utils };
}
const rowOf = (detail: HTMLElement, description: string) =>
  within(detail).getByText(description).closest('li') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  setRole('EMPLOYEE');
  api.fetchPerformance.mockResolvedValue(response());
  api.fetchEmployeePerformance.mockResolvedValue(response());
  // El detalle de Tareas pide páginas filtradas (una sola acá: sin `occurrencesPage`).
  api.fetchEmployeePerformancePage.mockResolvedValue(response());
  api.registerLateCompletion.mockResolvedValue({ completion: {} });
  api.revertTaskCompletion.mockResolvedValue({ task: {} });
  api.fetchTaskEmployees.mockResolvedValue({ employees: [COKE, JUAN] });
});

describe('Desempeño → Detalle: acciones que decide el backend', () => {
  it('«Marcar como realizada» solo en pendientes elegibles; nada en realizadas; «Una vez» → Tareas', async () => {
    const { detail } = await openDetail();
    const button = (description: string) =>
      within(rowOf(detail, description)).queryByRole('button', { name: /Marcar realizada/ });
    expect(button('Aspirar planta baja')).toBeInTheDocument();
    expect(button('Limpiar vidrios')).toBeInTheDocument();
    expect(button('Regar macetas')).toBeNull();
    expect(button('Barrer galería')).toBeNull();
    expect(button('Sin acción (fuera de la ventana)')).toBeNull();
    expect(within(rowOf(detail, 'Ordenar depósito')).queryByRole('button')).toBeNull();
    expect(
      within(rowOf(detail, 'Ordenar depósito')).getByRole('link', { name: /Completar en Tareas/ }),
    ).toHaveAttribute('href', '/tasks');
  });

  it('carga olvidada registrada: «Realizada el 27/10 · Registrada el 30/10», sin hora inventada', async () => {
    const { detail } = await openDetail();
    const row = rowOf(detail, 'Barrer galería');
    expect(row).toHaveTextContent('Realizada el 27/10 · Registrada el 30/10');
    expect(row.textContent).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe('diaria: confirmación sencilla con la fecha fijada por la fila', () => {
  it('confirma el 29/10 y solo envía tarea, período y fecha; invalida lo mismo que completar en Tareas', async () => {
    const { user, detail, queryClient } = await openDetail();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await user.click(
      within(rowOf(detail, 'Aspirar planta baja')).getByRole('button', {
        name: /Marcar realizada/,
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      '¿Confirmás que realizaste “Aspirar planta baja” el 29/10/2026?',
    );
    // La fecha no se elige ni se pide motivo.
    expect(within(dialog).queryByLabelText(/Fecha/)).toBeNull();
    expect(within(dialog).queryByLabelText(/Motivo/)).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.registerLateCompletion).toHaveBeenCalledTimes(1);
    expect(api.registerLateCompletion).toHaveBeenCalledWith('t-daily', {
      periodKey: '2026-10-29',
      performedOn: '2026-10-29',
    });
    expect(
      await screen.findByText(
        '«Aspirar planta baja» quedó registrada como realizada el 29/10/2026.',
      ),
    ).toBeInTheDocument();
    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(['session', 'u-EMPLOYEE', 'tasks']),
        JSON.stringify(['session', 'u-EMPLOYEE', 'performance']),
        JSON.stringify(['session', 'u-EMPLOYEE', 'dashboard']),
      ]),
    );
    expect(keys.some((key) => key.includes('kitchenGarden'))).toBe(false);
  });

  it('doble clic: una sola solicitud y la confirmación queda deshabilitada mientras se envía', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    api.registerLateCompletion.mockReturnValue(new Promise((done) => (resolve = done)));
    const { user, detail } = await openDetail();
    await user.click(
      within(rowOf(detail, 'Aspirar planta baja')).getByRole('button', {
        name: /Marcar realizada/,
      }),
    );
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Confirmar',
    });
    await user.dblClick(confirm);
    expect(api.registerLateCompletion).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    ).toBeDisabled();
    resolve({ completion: {} });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Cancelar no envía nada', async () => {
    const { user, detail } = await openDetail();
    await user.click(
      within(rowOf(detail, 'Aspirar planta baja')).getByRole('button', {
        name: /Marcar realizada/,
      }),
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.registerLateCompletion).not.toHaveBeenCalled();
  });
});

describe('períodos más largos: se muestra el período y se pide el día real', () => {
  it('sin preselección, dentro de las fechas que admite el backend', async () => {
    const { user, detail } = await openDetail();
    await user.click(
      within(rowOf(detail, 'Limpiar vidrios')).getByRole('button', {
        name: /Marcar realizada/,
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Período19/10/2026 al 25/10/2026');
    const input = within(dialog).getByLabelText('Fecha en que la realizaste');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('min', '2026-10-21');
    expect(input).toHaveAttribute('max', '2026-10-25');

    const confirm = within(dialog).getByRole('button', { name: 'Confirmar' });
    await user.click(confirm);
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Elegí la fecha en que la realizaste.',
    );
    await user.type(input, '2026-10-20');
    await user.click(confirm);
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Elegí un día entre el 21/10/2026 y el 25/10/2026.',
    );
    expect(api.registerLateCompletion).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '2026-10-23');
    expect(dialog).toHaveTextContent('Viernes 23/10/2026');
    await user.click(confirm);
    await waitFor(() =>
      expect(api.registerLateCompletion).toHaveBeenCalledWith('t-weekly', {
        periodKey: '2026-10-19',
        performedOn: '2026-10-23',
      }),
    );
  });
});

describe('errores: los datos visibles se conservan y nunca se reintenta solo', () => {
  async function confirmDaily() {
    const opened = await openDetail();
    await opened.user.click(
      within(rowOf(opened.detail, 'Aspirar planta baja')).getByRole('button', {
        name: /Marcar realizada/,
      }),
    );
    const dialog = await screen.findByRole('dialog');
    await opened.user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    return { ...opened, dialog };
  }

  it('409 (otra persona la completó mientras tanto): mensaje claro y datos actualizados', async () => {
    api.registerLateCompletion.mockRejectedValue(
      new ApiError(
        409,
        'Esta tarea ya figura como realizada en ese período. Actualizamos los datos.',
        'TASK_OBLIGATION_ALREADY_COMPLETED',
      ),
    );
    const opened = await openDetail();
    const invalidate = vi.spyOn(opened.queryClient, 'invalidateQueries');
    await opened.user.click(
      within(rowOf(opened.detail, 'Aspirar planta baja')).getByRole('button', {
        name: /Marcar realizada/,
      }),
    );
    const dialog = await screen.findByRole('dialog');
    await opened.user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Esta tarea ya figura como realizada en ese período.',
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['session', 'u-EMPLOYEE', 'performance'],
    });
    expect(opened.detail).toHaveTextContent('Aspirar planta baja');
    expect(api.registerLateCompletion).toHaveBeenCalledTimes(1);
  });

  it('sin conexión: no se guardó nada y lo dice; sin invalidar ni reintentar', async () => {
    api.registerLateCompletion.mockRejectedValue(new OfflineError());
    const { dialog, detail } = await confirmDaily();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(OFFLINE_WRITE_MESSAGE);
    expect(api.registerLateCompletion).toHaveBeenCalledTimes(1);
    expect(detail).toHaveTextContent('Aspirar planta baja');
  });

  it('respuesta ambigua (falló la red después de enviar): pide revisar, no repite la escritura', async () => {
    api.registerLateCompletion.mockRejectedValue(new TypeError('Failed to fetch'));
    const { dialog } = await confirmDaily();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(NETWORK_ERROR_MESSAGE);
    await new Promise((done) => setTimeout(done, 50));
    expect(api.registerLateCompletion).toHaveBeenCalledTimes(1);
  });
});

describe('deshacer la carga olvidada', () => {
  it('EMPLOYEE: «Deshacer» con motivo opcional, sobre esa ejecución', async () => {
    const { user, detail } = await openDetail();
    await user.click(
      within(rowOf(detail, 'Barrer galería')).getByRole('button', { name: /Deshacer/ }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Motivo (opcional)')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Deshacer' }));
    await waitFor(() =>
      expect(api.revertTaskCompletion).toHaveBeenCalledWith('t-late', 'x-late', undefined),
    );
    expect(
      await screen.findByText('«Barrer galería» volvió a quedar pendiente.'),
    ).toBeInTheDocument();
  });

  it('sin permiso del backend (`canRevert: false`) no hay botón', async () => {
    api.fetchEmployeePerformancePage.mockResolvedValue(
      response(
        OCCURRENCES.map((item) =>
          item.lateRegistration
            ? { ...item, lateRegistration: { ...item.lateRegistration, canRevert: false } }
            : item,
        ),
      ),
    );
    const { detail } = await openDetail();
    expect(within(rowOf(detail, 'Barrer galería')).queryByRole('button')).toBeNull();
  });
});

describe('ADMIN registra quién la realizó', () => {
  beforeEach(() => setRole('ADMIN'));

  it('elección explícita (sin preselección) entre las personas habilitadas', async () => {
    const { user, detail } = await openDetail();
    await user.click(
      within(rowOf(detail, 'Aspirar planta baja')).getByRole('button', {
        name: /Marcar realizada/,
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      '¿Confirmás que “Aspirar planta baja” se realizó el 29/10/2026?',
    );
    const group = await within(dialog).findByRole('group', { name: '¿Quién la realizó?' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    for (const radio of radios) expect(radio).not.toBeChecked();
    expect(within(group).getByText('(responsable)').closest('label')).toHaveTextContent('Coke');

    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Elegí quién la realizó.');
    expect(api.registerLateCompletion).not.toHaveBeenCalled();

    await user.click(within(group).getByRole('radio', { name: /Juan/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() =>
      expect(api.registerLateCompletion).toHaveBeenCalledWith('t-daily', {
        periodKey: '2026-10-29',
        performedOn: '2026-10-29',
        employeeId: JUAN.id,
      }),
    );
  });

  it('período largo: «Fecha en que se realizó»; corregir exige motivo', async () => {
    const { user, detail } = await openDetail();
    await user.click(
      within(rowOf(detail, 'Limpiar vidrios')).getByRole('button', {
        name: /Marcar realizada/,
      }),
    );
    expect(
      within(await screen.findByRole('dialog')).getByLabelText('Fecha en que se realizó'),
    ).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));

    await user.click(
      within(rowOf(detail, 'Barrer galería')).getByRole('button', { name: /Deshacer/ }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Corregir' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Indicá el motivo de la corrección',
    );
    expect(api.revertTaskCompletion).not.toHaveBeenCalled();
  });
});

describe('aislamiento: una fuente sin acciones (🥬 Huerta) no muestra ninguna', () => {
  it('aunque los datos trajeran acciones, no hay botones ni enlaces ni llamadas a Tareas', async () => {
    const source: PerformanceSource = {
      summaryKey: (userId, from, to) => [
        'session',
        userId,
        'kitchenGarden',
        'performance',
        'summary',
        from,
        to,
      ],
      fetchSummary: () => Promise.resolve(response()),
      detailKey: (userId, personId, from, to) => [
        'session',
        userId,
        'kitchenGarden',
        'performance',
        'participant',
        personId,
        from,
        to,
      ],
      fetchDetail: () => Promise.resolve(response()),
    };
    const { detail } = await openDetail(source);
    expect(
      within(detail).queryByRole('button', { name: /Marcar realizada|Deshacer|Corregir/ }),
    ).toBeNull();
    expect(within(detail).queryByRole('link')).toBeNull();
    expect(detail).not.toHaveTextContent('Registrada el');
    expect(api.fetchEmployeePerformance).not.toHaveBeenCalled();
    expect(api.fetchEmployeePerformancePage).not.toHaveBeenCalled();
    expect(api.fetchTaskEmployees).not.toHaveBeenCalled();
  });
});
