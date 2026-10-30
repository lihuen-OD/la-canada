import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '../../test/render';
import { ApiError } from '../../api/httpClient';
import type {
  PerformanceDetailFilters,
  PerformanceOccurrence,
  PerformanceResponse,
} from '../../api/performanceTypes';

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
import { PagedPerformanceDetail } from './PerformanceDetail';

/**
 * Tareas → Desempeño → Detalle con orden, filtros y «Ver más». Un backend
 * SIMULADO filtra y pagina (como el real: 20 por página, cursor); la pantalla
 * solo envía filtros y cursor, une páginas y presenta. Datos sintéticos.
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
  assigned: 50,
  completedPersonally: 10,
  percentage: 20,
  pending: 40,
  coverageReceived: 0,
  coverageGiven: 0,
  operationalCompleted: 10,
};
const day = (offset: number) => new Date(Date.UTC(2026, 9, 30 - offset)).toISOString().slice(0, 10);

/** 48 diarias (6 por día del 30/10 al 23/10) + 2 sin fecha: los días cruzan páginas de 20. */
function rowsOf(person: typeof COKE): PerformanceOccurrence[] {
  const dated = Array.from({ length: 48 }, (_, index) => {
    const date = day(Math.floor(index / 6));
    const done = index % 5 === 0;
    return {
      taskId: `${person.id}-t${index % 6}`,
      description: `${person === COKE ? 'Tarea' : 'Labor'} ${index % 6} (sintética)`,
      frequency: 'DAILY' as const,
      status: done ? ('personal' as const) : ('pending' as const),
      periodKey: date,
      assignedEmployeeId: person.id,
      completed: done,
      completedByEmployeeId: done ? person.id : null,
      assignedEmployee: person,
      completedByEmployee: done ? person : null,
      completedAt: done ? `${date}T15:00:00.000Z` : null,
      // Realizadas: su ejecución; el backend autoriza deshacer solo algunas.
      ...(done ? { execution: { id: `x-${person.id}-${index}`, canRevert: index % 2 === 0 } } : {}),
      groupDate: date,
      period: { start: date, end: date },
      ...(done
        ? {}
        : { lateCompletion: { periodStart: date, periodEnd: date, earliest: date, latest: date } }),
    };
  });
  const undated = (['URGENT', 'ONE_TIME'] as const).map((frequency) => ({
    taskId: `${person.id}-${frequency}`,
    description: `${frequency} sin fecha (sintética)`,
    frequency,
    status: 'pending' as const,
    periodKey: frequency,
    assignedEmployeeId: person.id,
    completed: false,
    completedByEmployeeId: null,
    assignedEmployee: person,
    completedByEmployee: null,
    completedAt: null,
    groupDate: null,
    period: null,
  }));
  return [...dated, ...undated];
}

let data: Record<string, PerformanceOccurrence[]> = {};
const base = (): PerformanceResponse => ({
  generatedAt: '2026-10-30T15:00:00.000Z',
  range: {
    from: '2026-10-24',
    to: '2026-10-30',
    today: '2026-10-30',
    timeZone: 'America/Argentina/Buenos_Aires',
    includesCurrentDay: true,
    maxDays: 30,
  },
  team: metrics,
  special: { urgentCompleted: 0, oneTimeCompleted: 0, urgentPending: 1 },
  employees: [
    { employee: COKE, ...metrics },
    { employee: JUAN, ...metrics },
  ],
  trend: [],
});

/** Backend simulado: filtra (estado, frecuencia, día) y pagina de a 20 con un cursor numérico. */
function fakePage(
  personId: string,
  _from: string,
  _to: string,
  filters: PerformanceDetailFilters,
  cursor: string | null,
): Promise<PerformanceResponse> {
  const filtered = (data[personId] ?? []).filter(
    (row) =>
      (!filters.status || row.status === filters.status) &&
      (!filters.frequency || row.frequency === filters.frequency) &&
      (!filters.date || row.groupDate === filters.date),
  );
  const start = cursor ? Number(cursor) : 0;
  const occurrences = filtered.slice(start, start + 20);
  return Promise.resolve({
    ...base(),
    occurrences,
    occurrencesPage: {
      total: filtered.length,
      limit: 20,
      nextCursor: start + 20 < filtered.length ? String(start + 20) : null,
    },
  });
}

function setRole(role: 'ADMIN' | 'EMPLOYEE') {
  api.useAuth.mockReturnValue({ user: { id: `u-${role}`, role }, logout: vi.fn() });
}

async function openDetail(person = COKE, source?: PerformanceSource) {
  const user = userEvent.setup();
  const utils = render(
    <MemoryRouter>
      <PerformanceScreen {...(source ? { source } : {})} />
    </MemoryRouter>,
  );
  await user.click(
    await screen.findByRole('button', {
      name: new RegExp(person.displayName.replace(/[()]/g, '.')),
    }),
  );
  const detail = (await screen.findByRole('heading', { name: 'Detalle' })).closest(
    'section',
  ) as HTMLElement;
  return { user, detail, ...utils };
}

const headers = (detail: HTMLElement) =>
  within(detail)
    .queryAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent);
const rowCount = (detail: HTMLElement) => detail.querySelectorAll('.performance-detail li').length;
const lastCall = () => api.fetchEmployeePerformancePage.mock.calls.at(-1)!;

beforeEach(() => {
  vi.clearAllMocks();
  setRole('ADMIN');
  data = { [COKE.id]: rowsOf(COKE), [JUAN.id]: rowsOf(JUAN) };
  api.fetchPerformance.mockImplementation(() => Promise.resolve(base()));
  api.fetchEmployeePerformancePage.mockImplementation(fakePage);
  api.registerLateCompletion.mockResolvedValue({ completion: {} });
  api.fetchTaskEmployees.mockResolvedValue({ employees: [COKE, JUAN] });
});

describe('orden, grupos y «Ver más»', () => {
  it('hoy primero; un encabezado por día aunque el día cruce dos páginas; 20 + 20 + 10 y sin «Ver más» al final', async () => {
    const { user, detail } = await openDetail();
    await within(detail).findByText('Mostrando 20 de 50 registros');
    expect(api.fetchEmployeePerformancePage).toHaveBeenCalledWith(
      COKE.id,
      expect.any(String),
      expect.any(String),
      {},
      null,
    );
    expect(api.fetchEmployeePerformance).not.toHaveBeenCalled();
    expect(headers(detail)).toEqual([
      'Hoy · Viernes 30/10/2026',
      'Ayer · Jueves 29/10/2026',
      'Miércoles 28/10/2026',
      'Martes 27/10/2026',
    ]);
    expect(rowCount(detail)).toBe(20);

    await user.click(within(detail).getByRole('button', { name: 'Ver más' }));
    await within(detail).findByText('Mostrando 40 de 50 registros');
    expect(lastCall()).toEqual([COKE.id, expect.any(String), expect.any(String), {}, '20']);
    // El 27/10 estaba repartido entre las dos páginas: sigue siendo un solo grupo.
    expect(headers(detail).filter((text) => text === 'Martes 27/10/2026')).toHaveLength(1);
    expect(rowCount(detail)).toBe(40);

    await user.click(within(detail).getByRole('button', { name: 'Ver más' }));
    await within(detail).findByText('Mostrando 50 de 50 registros');
    expect(within(detail).queryByRole('button', { name: 'Ver más' })).toBeNull();
    // Sin fecha: al final, sin inventarles una.
    expect(headers(detail).at(-1)).toBe('Sin fecha');
    const keys = Array.from(detail.querySelectorAll('.performance-detail li strong')).map(
      (node) => node.textContent,
    );
    expect(keys).toHaveLength(50);
  });

  it('«Ver más» queda deshabilitado mientras carga la página siguiente', async () => {
    const { user, detail } = await openDetail();
    await within(detail).findByText('Mostrando 20 de 50 registros');
    let release: () => void = () => undefined;
    api.fetchEmployeePerformancePage.mockImplementationOnce(
      (...args: Parameters<typeof fakePage>) =>
        new Promise((done) => (release = () => done(fakePage(...args)))),
    );
    const more = within(detail).getByRole('button', { name: 'Ver más' });
    await user.click(more);
    await waitFor(() => expect(more).toBeDisabled());
    await user.click(more);
    expect(api.fetchEmployeePerformancePage).toHaveBeenCalledTimes(2);
    release();
    await within(detail).findByText('Mostrando 40 de 50 registros');
  });

  it('un error al cargar otra página conserva lo anterior y ofrece reintentar', async () => {
    const { user, detail } = await openDetail();
    await within(detail).findByText('Mostrando 20 de 50 registros');
    api.fetchEmployeePerformancePage.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await user.click(within(detail).getByRole('button', { name: 'Ver más' }));
    expect(await within(detail).findByRole('alert')).toHaveTextContent(
      'No pudimos cargar más registros.',
    );
    expect(rowCount(detail)).toBe(20);
    expect(within(detail).getByText('Mostrando 20 de 50 registros')).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Reintentar' }));
    await within(detail).findByText('Mostrando 40 de 50 registros');
    expect(within(detail).queryByRole('alert')).toBeNull();
  });
});

describe('filtros (los valida y aplica el backend)', () => {
  it('cada filtro pide la primera página con él; se combinan; sin filas del filtro anterior mientras carga; limpiar', async () => {
    const { user, detail } = await openDetail();
    await within(detail).findByText('Mostrando 20 de 50 registros');
    await user.click(within(detail).getByRole('button', { name: 'Ver más' }));
    await within(detail).findByText('Mostrando 40 de 50 registros');

    let release: () => void = () => undefined;
    api.fetchEmployeePerformancePage.mockImplementationOnce(
      (...args: Parameters<typeof fakePage>) =>
        new Promise((done) => (release = () => done(fakePage(...args)))),
    );
    const status = within(detail).getByRole('group', { name: 'Filtrar por estado' });
    await user.click(within(status).getByRole('button', { name: 'Realizadas' }));
    // Página reiniciada y sin filas de otro filtro mientras llega la respuesta.
    expect(lastCall()).toEqual([
      COKE.id,
      expect.any(String),
      expect.any(String),
      { status: 'personal' },
      null,
    ]);
    expect(within(detail).getByText('Cargando detalle…')).toBeInTheDocument();
    expect(rowCount(detail)).toBe(0);
    release();
    await within(detail).findByText('Mostrando 10 de 10 registros');

    const frequency = within(detail).getByRole('group', { name: 'Filtrar por frecuencia' });
    await user.click(within(frequency).getByRole('button', { name: 'Semanales' }));
    expect(lastCall()[3]).toEqual({ status: 'personal', frequency: 'WEEKLY' });
    expect(
      await within(detail).findByText('No hay obligaciones con estos filtros.'),
    ).toBeInTheDocument();

    await user.click(within(detail).getByRole('button', { name: 'Limpiar filtros' }));
    expect(lastCall()[3]).toEqual({});
    await within(detail).findByText('Mostrando 20 de 50 registros');
    expect(within(detail).queryByRole('button', { name: 'Limpiar filtros' })).toBeNull();
  });

  it('día con calendario: solo días del rango (sin futuros), se combina con el estado y «Todas las fechas» lo quita', async () => {
    const fetchPage = vi.fn(fakePage);
    const pages = { key: (...args: unknown[]) => ['detalle', ...args], fetchPage };
    render(
      <MemoryRouter>
        <PagedPerformanceDetail
          pages={pages}
          personId={COKE.id}
          range={{ from: '2026-10-24', to: '2026-10-30' }}
          today="2026-10-30"
          actions={null}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );
    await screen.findByText('Mostrando 20 de 50 registros');
    const input = screen.getByLabelText('Fecha');
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveAttribute('min', '2026-10-24');
    expect(input).toHaveAttribute('max', '2026-10-30');
    expect(input).toHaveValue('');
    expect(screen.getByText('Todas las fechas del período.')).toBeInTheDocument();
    const last = () => fetchPage.mock.calls.at(-1)!;

    fireEvent.change(input, { target: { value: '2026-10-28' } });
    expect(last()[3]).toEqual({ date: '2026-10-28' });
    expect(last()[4]).toBeNull();
    // La fecha en el formato de la app.
    expect(screen.getByText('Miércoles 28/10/2026')).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Filtrar por estado' })).getByRole('button', {
        name: 'Sin completar',
      }),
    );
    expect(last()[3]).toEqual({ date: '2026-10-28', status: 'pending' });

    // Fuera del rango (futura o anterior), escrita a mano: no se aplica y se explica.
    const calls = fetchPage.mock.calls.length;
    for (const value of ['2026-10-31', '2026-10-20']) {
      fireEvent.change(input, { target: { value } });
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Elegí un día entre el 24/10/2026 y el 30/10/2026.',
      );
    }
    expect(fetchPage.mock.calls.length).toBe(calls);
    expect(input).toHaveValue('2026-10-28');

    fireEvent.click(screen.getByRole('button', { name: 'Todas las fechas' }));
    expect(last()[3]).toEqual({ status: 'pending' });
    expect(input).toHaveValue('');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Todas las fechas' })).toBeNull();
  });

  it('las métricas son las del rango completo: no se vuelven a pedir ni cambian con filtros o páginas', async () => {
    const { user, detail } = await openDetail();
    await within(detail).findByText('Mostrando 20 de 50 registros');
    const summaryCalls = api.fetchPerformance.mock.calls.length;
    const kpis = screen.getByRole('region', { name: 'Resumen' }).textContent;
    await user.click(within(detail).getByRole('button', { name: 'Ver más' }));
    await within(detail).findByText('Mostrando 40 de 50 registros');
    await user.click(
      within(within(detail).getByRole('group', { name: 'Filtrar por estado' })).getByRole(
        'button',
        { name: 'Sin completar' },
      ),
    );
    await within(detail).findByText('Mostrando 20 de 40 registros');
    expect(api.fetchPerformance.mock.calls.length).toBe(summaryCalls);
    expect(screen.getByRole('region', { name: 'Resumen' }).textContent).toBe(kpis);
  });
});

describe('persona y escrituras', () => {
  it('cambiar de persona reinicia las páginas y no muestra filas de la anterior', async () => {
    const { user, detail } = await openDetail();
    await within(detail).findByText('Mostrando 20 de 50 registros');
    await user.click(within(detail).getByRole('button', { name: 'Ver más' }));
    await within(detail).findByText('Mostrando 40 de 50 registros');
    await user.click(screen.getByRole('button', { name: /Juan \(sintético\)/ }));
    expect(lastCall()).toEqual([JUAN.id, expect.any(String), expect.any(String), {}, null]);
    await within(detail).findByText('Mostrando 20 de 50 registros');
    expect(within(detail).queryByText(/^Tarea \d/)).toBeNull();
    expect(within(detail).getAllByText(/^Labor \d/)).toHaveLength(20);
  });

  it('«Marcar como realizada» con «Sin completar»: la fila desaparece y se actualizan resumen y páginas', async () => {
    setRole('EMPLOYEE');
    const { user, detail } = await openDetail();
    await user.click(
      within(within(detail).getByRole('group', { name: 'Filtrar por estado' })).getByRole(
        'button',
        { name: 'Sin completar' },
      ),
    );
    await within(detail).findByText('Mostrando 20 de 40 registros');
    const summaryCalls = api.fetchPerformance.mock.calls.length;
    const target = data[COKE.id]!.find((row) => row.lateCompletion)!;
    api.registerLateCompletion.mockImplementation(async () => {
      // El backend simulado registra la obligación elegida (y solo esa).
      data[COKE.id] = data[COKE.id]!.map((row) =>
        row === target
          ? { ...row, status: 'personal' as const, completed: true, lateCompletion: undefined }
          : row,
      );
      return { completion: {} };
    });
    const row = within(detail).getAllByText(target.description)[0]!.closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Marcar realizada/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }),
    );
    await within(detail).findByText('Mostrando 20 de 39 registros');
    expect(api.registerLateCompletion).toHaveBeenCalledWith(target.taskId, {
      periodKey: target.periodKey,
      performedOn: target.periodKey,
    });
    // Las páginas se vuelven a pedir desde la primera, con el mismo filtro.
    expect(lastCall()[3]).toEqual({ status: 'pending' });
    expect(api.fetchPerformance.mock.calls.length).toBeGreaterThan(summaryCalls);
    // El filtro y la persona se conservan.
    expect(
      within(within(detail).getByRole('group', { name: 'Filtrar por estado' })).getByRole(
        'button',
        { name: 'Sin completar' },
      ),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('cambio de día y aislamiento', () => {
  it('si el día elegido queda fuera del rango (el día de negocio avanzó), se vuelve a «Todas» y se avisa', async () => {
    const fetchPageSpy = vi.fn(fakePage);
    const pages = { key: (...args: unknown[]) => ['detalle', ...args], fetchPage: fetchPageSpy };
    const props = {
      pages,
      personId: COKE.id,
      today: '2026-10-30',
      actions: null,
      onClose: vi.fn(),
    };
    const view = render(
      <MemoryRouter>
        <PagedPerformanceDetail {...props} range={{ from: '2026-10-24', to: '2026-10-30' }} />
      </MemoryRouter>,
    );
    await screen.findByText('Mostrando 20 de 50 registros');
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-10-24' } });
    await screen.findByText(/Mostrando \d+ de \d+ registros/);
    view.rerender(
      <MemoryRouter>
        <PagedPerformanceDetail
          {...props}
          today="2026-10-31"
          range={{ from: '2026-10-25', to: '2026-10-31' }}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByText('El día 24/10/2026 quedó fuera del período: se muestran todas las fechas.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha')).toHaveValue('');
    // Nunca se pidió el día fuera del rango nuevo.
    const calls = (fetchPageSpy.mock.calls as unknown[][]).filter(
      ([, from]) => from === '2026-10-25',
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => !(call[3] as PerformanceDetailFilters).date)).toBe(true);
  });

  it('🥬 Huerta (sin `detailPages`): el detalle completo de siempre, sin filtros ni «Ver más»', async () => {
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
      fetchSummary: () => Promise.resolve(base()),
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
      fetchDetail: () =>
        Promise.resolve({
          ...base(),
          occurrences: data[COKE.id]!.map(
            ({ groupDate: _g, period: _p, lateCompletion: _l, ...row }) => row,
          ),
        }),
    };
    const { detail } = await openDetail(COKE, source);
    await waitFor(() => expect(rowCount(detail)).toBe(50));
    expect(within(detail).queryByLabelText('Fecha')).toBeNull();
    expect(within(detail).queryByRole('group', { name: 'Filtrar por estado' })).toBeNull();
    expect(within(detail).queryByRole('button', { name: 'Ver más' })).toBeNull();
    expect(within(detail).queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    expect(api.fetchEmployeePerformancePage).not.toHaveBeenCalled();
  });
});

describe('acciones compactas y «Deshacer» desde el detalle', () => {
  const statusGroup = (detail: HTMLElement) =>
    within(detail).getByRole('group', { name: 'Filtrar por estado' });

  beforeEach(() => {
    api.revertTaskCompletion.mockImplementation(async (taskId: string, executionId: string) => {
      // Backend simulado: la obligación exacta vuelve a «Sin completar».
      data[COKE.id] = data[COKE.id]!.map((row) =>
        row.taskId === taskId && row.execution?.id === executionId
          ? {
              ...row,
              status: 'pending' as const,
              completed: false,
              completedByEmployeeId: null,
              completedByEmployee: null,
              completedAt: null,
              execution: undefined,
            }
          : row,
      );
      return { task: {} };
    });
  });

  it('textos visibles cortos, nombre accesible completo y estilo compacto; «Deshacer» solo con permiso del backend', async () => {
    setRole('EMPLOYEE');
    const { detail } = await openDetail();
    await within(detail).findByText('Mostrando 20 de 50 registros');
    const mark = within(detail).getAllByRole('button', { name: /^Marcar realizada: / })[0]!;
    expect(mark).toHaveTextContent(/^Marcar realizada/);
    expect(mark).toHaveAccessibleName(
      /^Marcar realizada: Tarea \d \(sintética\), \d{2}\/10\/2026 · Diaria$/,
    );
    expect(mark).toHaveClass('performance-detail__action', 'button--sm');
    expect(mark).not.toHaveClass('button--full');
    expect(within(detail).queryByRole('button', { name: /Marcar como realizada/ })).toBeNull();

    const undo = within(detail).getAllByRole('button', { name: /^Deshacer: / });
    const allowed = data[COKE.id]!.slice(0, 20).filter((row) => row.execution?.canRevert);
    expect(undo).toHaveLength(allowed.length);
    // Una realizada sin permiso (p. ej. de un día anterior del flujo normal): sin botón.
    const forbidden = data[COKE.id]!.slice(0, 20).find(
      (row) => row.execution && !row.execution.canRevert,
    )!;
    const forbiddenRow = within(detail)
      .getAllByText(forbidden.description)
      .map((node) => node.closest('li') as HTMLElement)
      .find((li) => li.textContent?.includes(`${forbidden.periodKey.slice(8, 10)}/10/2026`))!;
    expect(within(forbiddenRow).queryByRole('button')).toBeNull();
  });

  it('EMPLOYEE deshace una ejecución normal: con «Realizadas» la fila deja de coincidir; persona y filtro se conservan', async () => {
    setRole('EMPLOYEE');
    const { user, detail, queryClient } = await openDetail();
    await user.click(within(statusGroup(detail)).getByRole('button', { name: 'Realizadas' }));
    await within(detail).findByText('Mostrando 10 de 10 registros');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const target = data[COKE.id]!.find((row) => row.execution?.canRevert)!;
    await user.click(within(detail).getAllByRole('button', { name: /^Deshacer: / })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Deshacer finalización');
    expect(within(dialog).getByLabelText('Motivo (opcional)')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Deshacer' }));
    await within(detail).findByText('Mostrando 9 de 9 registros');
    expect(api.revertTaskCompletion).toHaveBeenCalledWith(
      target.taskId,
      target.execution!.id,
      undefined,
    );
    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    for (const prefix of ['tasks', 'performance', 'dashboard']) {
      expect(keys).toContain(JSON.stringify(['session', 'u-EMPLOYEE', prefix]));
    }
    expect(lastCall()[3]).toEqual({ status: 'personal' });
    expect(within(statusGroup(detail)).getByRole('button', { name: 'Realizadas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      await screen.findByText(`«${target.description}» volvió a quedar pendiente.`),
    ).toBeInTheDocument();
  });

  it('con «Todas», la obligación deshecha vuelve a aparecer «Sin completar» en su lugar', async () => {
    setRole('EMPLOYEE');
    const { user, detail } = await openDetail();
    await within(detail).findByText('Mostrando 20 de 50 registros');
    const target = data[COKE.id]!.find((row) => row.execution?.canRevert)!;
    await user.click(within(detail).getAllByRole('button', { name: /^Deshacer: / })[0]!);
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deshacer' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await within(detail).findByText('Mostrando 20 de 50 registros');
    const row = within(detail)
      .getAllByText(target.description)
      .map((node) => node.closest('li') as HTMLElement)
      .find((li) => li.textContent?.includes(`${target.periodKey.slice(8, 10)}/10/2026`))!;
    await waitFor(() => expect(row).toHaveTextContent('Sin completar'));
  });

  it('ADMIN: mismo «Deshacer» compacto, pero la reversión administrativa exige motivo', async () => {
    const { user, detail } = await openDetail();
    await within(detail).findByText('Mostrando 20 de 50 registros');
    await user.click(within(detail).getAllByRole('button', { name: /^Deshacer: / })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Corregir finalización');
    await user.click(within(dialog).getByRole('button', { name: 'Corregir' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Indicá el motivo');
    expect(api.revertTaskCompletion).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Motivo'), 'Cargada por error');
    await user.click(within(dialog).getByRole('button', { name: 'Corregir' }));
    await waitFor(() =>
      expect(api.revertTaskCompletion).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'Cargada por error',
      ),
    );
  });

  it('pantalla vieja (el backend ya no lo permite o ya se deshizo): mensaje claro y datos actualizados', async () => {
    setRole('EMPLOYEE');
    const { user, detail, queryClient } = await openDetail();
    await within(detail).findByText('Mostrando 20 de 50 registros');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    api.revertTaskCompletion.mockRejectedValueOnce(
      new ApiError(
        403,
        'Solo podés deshacer una tarea que completaste vos, dentro del período vigente o el mismo día en que la registraste desde Desempeño.',
        'AUTH_FORBIDDEN',
      ),
    );
    await user.click(within(detail).getAllByRole('button', { name: /^Deshacer: / })[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Deshacer' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Solo podés deshacer');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['session', 'u-EMPLOYEE', 'performance'] });
  });
});
