import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/httpClient';
import { render, screen, waitFor, within } from '../../test/render';
import {
  COLLECTOR_A,
  COLLECTOR_B,
  PENDING_COOP,
  historyResponse,
  makeCollection,
  makeDay,
  makeSummary,
} from '../../test/fixtures/chickenCoop';

const api = vi.hoisted(() => ({
  fetchChickenCoopSummary: vi.fn(),
  fetchEggCollectionHistory: vi.fn(),
  createEggCollection: vi.fn(),
  voidEggCollection: vi.fn(),
  configureChickenCoop: vi.fn(),
  adjustChickenCoopHens: vi.fn(),
}));
const { useAuthMock, logoutMock, fetchTaskEmployeesMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  logoutMock: vi.fn(),
  fetchTaskEmployeesMock: vi.fn(),
}));
vi.mock('../../api/chickenCoopApi', () => api);
vi.mock('../../api/tasksApi', () => ({ fetchTaskEmployees: fetchTaskEmployeesMock }));
vi.mock('../../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { ChickenCoopScreen } from './ChickenCoopScreen';

function asEmployee() {
  useAuthMock.mockReturnValue({
    user: {
      id: 'u-e',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      employee: { id: COLLECTOR_A.id, displayName: COLLECTOR_A.displayName, colorHex: null },
    },
    logout: logoutMock,
    hasRole: (role: string) => role === 'EMPLOYEE',
  });
}

function asAdmin() {
  useAuthMock.mockReturnValue({
    user: { id: 'u-a', role: 'ADMIN', status: 'ACTIVE', employee: null },
    logout: logoutMock,
    hasRole: (role: string) => role === 'ADMIN',
  });
}

async function renderScreen() {
  const result = render(<ChickenCoopScreen />);
  await screen.findByRole('list', { name: 'Indicadores del gallinero' });
  return result;
}

const form = () => screen.getByRole('form', { name: 'Registrar recolección' });

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  logoutMock.mockReset();
  fetchTaskEmployeesMock.mockReset();
  fetchTaskEmployeesMock.mockResolvedValue({ employees: [COLLECTOR_A, COLLECTOR_B] });
  api.fetchChickenCoopSummary.mockImplementation(async (days: 7 | 30 | 90 | 365) =>
    makeSummary({ days }),
  );
  api.fetchEggCollectionHistory.mockResolvedValue(historyResponse());
  asEmployee();
});

describe('Gallinero — pantalla del prototipo', () => {
  it('título 🐔, KPIs del backend, gallinas activas, análisis e historial', async () => {
    await renderScreen();
    expect(screen.getByRole('heading', { level: 1, name: 'Gallinero' })).toHaveTextContent('🐔');
    expect(screen.getByText('Registro de postura y recolección')).toBeInTheDocument();

    const kpis = within(screen.getByRole('list', { name: 'Indicadores del gallinero' }));
    expect(kpis.getByText('Huevos hoy').previousSibling).toHaveTextContent('7');
    expect(kpis.getByText('Postura hoy').previousSibling).toHaveTextContent('70%');
    expect(kpis.getByText('Promedio/día').previousSibling).toHaveTextContent('6.0');
    expect(kpis.getByText('Postura período').previousSibling).toHaveTextContent('60%');

    expect(screen.getByText('gallinas en producción').previousSibling).toHaveTextContent('10');
    expect(api.fetchChickenCoopSummary).toHaveBeenCalledTimes(1);
    expect(api.fetchChickenCoopSummary).toHaveBeenCalledWith(7);

    const chart = screen.getByRole('list', { name: /Huevos buenos por día/ });
    expect(within(chart).getAllByRole('listitem')).toHaveLength(7);
    expect(within(chart).getByLabelText('25/09 (hoy): 7 huevos buenos')).toBeInTheDocument();

    // Corrige `DIAS_ES` del prototipo: el día de la semana se muestra completo.
    const history = await screen.findByRole('list', { name: 'Recolecciones por día' });
    expect(
      within(history).getByRole('heading', { name: 'Viernes 25/09/2026' }),
    ).toBeInTheDocument();
    expect(within(history).getByText('Postura 70%')).toBeInTheDocument();
    expect(
      within(history).getByText(`${COLLECTOR_A.displayName} — 7 buenos, 1 roto`),
    ).toBeInTheDocument();
    expect(within(history).getByText('Observación sintética')).toBeInTheDocument();
    expect(api.fetchEggCollectionHistory).toHaveBeenCalledWith(1, 10);
  });

  it('EMPLOYEE: sin "+ Alta"/"− Baja" ni "✕"; "¿Quién juntó?" fijado a su sesión', async () => {
    await renderScreen();
    await screen.findByRole('list', { name: 'Recolecciones por día' });
    expect(screen.queryByRole('button', { name: /alta/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /baja/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /eliminar recolección/i })).not.toBeInTheDocument();
    expect(within(form()).getByText(COLLECTOR_A.displayName)).toBeInTheDocument();
    expect(within(form()).queryByRole('combobox')).not.toBeInTheDocument();
    expect(fetchTaskEmployeesMock).not.toHaveBeenCalled();
  });

  it('EMPLOYEE registra: sin persona en el body, fecha de negocio, Idempotency-Key e invalidación', async () => {
    const user = userEvent.setup();
    api.createEggCollection.mockResolvedValue({
      collection: makeCollection({ goodEggsCount: 5, brokenEggsCount: 0 }),
    });
    await renderScreen();

    await user.click(within(form()).getByRole('button', { name: 'Registrar recolección' }));
    expect(await within(form()).findByRole('alert')).toHaveTextContent(
      'Ingresá al menos un huevo.',
    );
    expect(api.createEggCollection).not.toHaveBeenCalled();

    await user.type(within(form()).getByLabelText('Huevos buenos'), '5');
    await user.type(within(form()).getByLabelText('Observaciones (opcional)'), '  nido   3 ');
    await user.click(within(form()).getByRole('button', { name: 'Registrar recolección' }));

    await waitFor(() => expect(api.createEggCollection).toHaveBeenCalledTimes(1));
    const [body, key] = api.createEggCollection.mock.calls[0] ?? [];
    expect(body).toEqual({
      goodEggsCount: 5,
      brokenEggsCount: 0,
      collectionDate: '2026-09-25',
      notes: 'nido 3',
    });
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(await within(form()).findByText(/Recolección registrada: 5 buenos/)).toBeInTheDocument();
    expect(within(form()).getByLabelText('Huevos buenos')).toHaveValue(null);
    // Invalidación del módulo: resumen e historial se vuelven a pedir.
    await waitFor(() => expect(api.fetchChickenCoopSummary).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.fetchEggCollectionHistory).toHaveBeenCalledTimes(2));
  });

  it('una falla de red conserva la clave para "Reintentar"; cambiar un campo es otra intención', async () => {
    const user = userEvent.setup();
    api.createEggCollection
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ collection: makeCollection() });
    await renderScreen();

    await user.type(within(form()).getByLabelText('Huevos buenos'), '3');
    await user.click(within(form()).getByRole('button', { name: 'Registrar recolección' }));
    await within(form()).findByRole('button', { name: 'Reintentar' });
    await user.click(within(form()).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(api.createEggCollection).toHaveBeenCalledTimes(2));
    const firstKey = api.createEggCollection.mock.calls[0]?.[1];
    expect(api.createEggCollection.mock.calls[1]?.[1]).toBe(firstKey);

    await user.type(within(form()).getByLabelText('Huevos rotos'), '1');
    await user.click(within(form()).getByRole('button', { name: 'Registrar recolección' }));
    await waitFor(() => expect(api.createEggCollection).toHaveBeenCalledTimes(3));
    expect(api.createEggCollection.mock.calls[2]?.[1]).not.toBe(firstKey);
  });

  it('una fecha futura se rechaza en el cliente (el backend vuelve a decidir)', async () => {
    const user = userEvent.setup();
    await renderScreen();
    const date = within(form()).getByLabelText('Fecha');
    expect(date).toHaveValue('2026-09-25');
    expect(date).toHaveAttribute('max', '2026-09-25');
    await user.clear(date);
    await user.type(date, '2026-09-26');
    await user.type(within(form()).getByLabelText('Huevos buenos'), '1');
    await user.click(within(form()).getByRole('button', { name: 'Registrar recolección' }));
    expect(await within(form()).findByRole('alert')).toHaveTextContent(
      'La fecha no puede ser futura.',
    );
    expect(api.createEggCollection).not.toHaveBeenCalled();
  });

  it('cambiar de período pide ese resumen y conserva la vista anterior mientras llega', async () => {
    const user = userEvent.setup();
    let resolve30!: (value: unknown) => void;
    await renderScreen();
    api.fetchChickenCoopSummary.mockImplementationOnce(
      () => new Promise((resolve) => (resolve30 = resolve)),
    );
    await user.click(screen.getByRole('button', { name: '30 días' }));
    expect(api.fetchChickenCoopSummary).toHaveBeenLastCalledWith(30);
    // Sin loader: los KPIs anteriores siguen visibles (atenuados).
    expect(screen.getByRole('list', { name: 'Indicadores del gallinero' })).toHaveClass('is-stale');
    expect(screen.queryByText('Cargando gallinero…')).not.toBeInTheDocument();
    resolve30(makeSummary({ days: 30 }));
    await waitFor(() =>
      expect(
        screen.getByRole('list', { name: /Huevos buenos por día, últimos 14 días/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: '30 días' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('estados vacíos del prototipo: sin registros en el período ni en el historial', async () => {
    api.fetchChickenCoopSummary.mockResolvedValue(makeSummary({ empty: true }));
    api.fetchEggCollectionHistory.mockResolvedValue(historyResponse([]));
    await renderScreen();
    expect(screen.getByText('Sin registros en este período')).toBeInTheDocument();
    expect(await screen.findByText('Sin registros aún')).toBeInTheDocument();
  });

  it('una falla de carga ofrece reintentar (sin datos inventados)', async () => {
    const user = userEvent.setup();
    api.fetchChickenCoopSummary.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<ChickenCoopScreen />);
    expect(await screen.findByText('No pudimos cargar el gallinero')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('list', { name: 'Indicadores del gallinero' });
  });

  it('un 401 que sobrevive al refresh cierra la sesión', async () => {
    api.fetchChickenCoopSummary.mockRejectedValue(
      new ApiError(401, 'Sesión inválida', 'AUTH_SESSION_INVALID'),
    );
    render(<ChickenCoopScreen />);
    await waitFor(() => expect(logoutMock).toHaveBeenCalled());
  });

  it('"Cargar más días" pide la página siguiente del historial', async () => {
    const user = userEvent.setup();
    api.fetchEggCollectionHistory
      .mockResolvedValueOnce(historyResponse([makeDay()], 1, 2))
      .mockResolvedValueOnce(
        historyResponse(
          [
            makeDay({
              date: '2026-09-10',
              layingRate: 40,
              collections: [
                makeCollection({
                  id: '00000000-0000-4000-8000-0000000c0002',
                  collectionDate: '2026-09-10',
                  notes: null,
                }),
              ],
            }),
          ],
          2,
          2,
        ),
      );
    await renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Cargar más días' }));
    expect(await screen.findByRole('heading', { name: 'Jueves 10/09/2026' })).toBeInTheDocument();
    expect(api.fetchEggCollectionHistory).toHaveBeenLastCalledWith(2, 10);
    expect(screen.queryByRole('button', { name: 'Cargar más días' })).not.toBeInTheDocument();
  });
});

describe('Gallinero — sin configuración real', () => {
  it('EMPLOYEE ve "Configuración pendiente" y puede registrar igual; la postura queda "—"', async () => {
    api.fetchChickenCoopSummary.mockResolvedValue(makeSummary({ coop: PENDING_COOP }));
    await renderScreen();
    expect(screen.getByText(/Configuración pendiente: un administrador/)).toBeInTheDocument();
    const kpis = within(screen.getByRole('list', { name: 'Indicadores del gallinero' }));
    expect(kpis.getByText('Postura hoy').previousSibling).toHaveTextContent('—');
    expect(screen.queryByLabelText('Gallinas en producción')).not.toBeInTheDocument();
    expect(form()).toBeInTheDocument();
  });

  it('ADMIN carga la cantidad real inicial (nunca un valor inventado)', async () => {
    const user = userEvent.setup();
    asAdmin();
    api.fetchChickenCoopSummary.mockResolvedValue(makeSummary({ coop: PENDING_COOP }));
    api.configureChickenCoop.mockResolvedValue({
      coop: { configured: true, activeHensCount: 12, updatedAt: null },
    });
    await renderScreen();
    const input = screen.getByLabelText('Gallinas en producción');
    expect(input).toHaveValue(null);
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    expect(await screen.findByText(/Ingresá la cantidad real de gallinas/)).toBeInTheDocument();
    await user.type(input, '12');
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    await waitFor(() => expect(api.configureChickenCoop).toHaveBeenCalledWith(12));
    await waitFor(() => expect(api.fetchChickenCoopSummary).toHaveBeenCalledTimes(2));
  });
});

describe('Gallinero — ADMIN', () => {
  beforeEach(asAdmin);

  it('"+ Alta" confirma "¿Cambiar gallinas activas de 10 a 11?" y envía la cantidad confirmada', async () => {
    const user = userEvent.setup();
    api.adjustChickenCoopHens.mockResolvedValue({
      coop: { configured: true, activeHensCount: 11, updatedAt: null },
    });
    await renderScreen();
    await user.click(screen.getByRole('button', { name: 'Dar de alta una gallina' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('¿Cambiar gallinas activas de 10 a 11?');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar alta' }));
    await waitFor(() => expect(api.adjustChickenCoopHens).toHaveBeenCalledWith(1, 10));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('si la cantidad cambió mientras tanto, muestra el error y revalida', async () => {
    const user = userEvent.setup();
    api.adjustChickenCoopHens.mockRejectedValue(
      new ApiError(
        409,
        'La cantidad de gallinas cambió mientras tanto. Revisá el valor actual.',
        'CHICKEN_COOP_COUNT_CHANGED',
      ),
    );
    await renderScreen();
    await user.click(screen.getByRole('button', { name: 'Dar de baja una gallina' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('¿Cambiar gallinas activas de 10 a 9?');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar baja' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('cambió mientras tanto');
    await waitFor(() => expect(api.fetchChickenCoopSummary).toHaveBeenCalledTimes(2));
  });

  it('"− Baja" deshabilitada con 0 gallinas (nunca negativo)', async () => {
    api.fetchChickenCoopSummary.mockResolvedValue(
      makeSummary({ coop: { configured: true, activeHensCount: 0, updatedAt: null } }),
    );
    await renderScreen();
    expect(screen.getByRole('button', { name: 'Dar de baja una gallina' })).toBeDisabled();
  });

  it('"¿Quién juntó?": elige entre empleados activos y lo envía; el actor real lo pone el backend', async () => {
    const user = userEvent.setup();
    api.createEggCollection.mockResolvedValue({
      collection: makeCollection({ employee: COLLECTOR_B }),
    });
    await renderScreen();
    const select = await within(form()).findByRole('combobox', { name: '¿Quién juntó?' });
    await waitFor(() => expect(select).toHaveValue(COLLECTOR_A.id));
    await user.selectOptions(select, COLLECTOR_B.id);
    await user.type(within(form()).getByLabelText('Huevos rotos'), '2');
    await user.click(within(form()).getByRole('button', { name: 'Registrar recolección' }));
    await waitFor(() =>
      expect(api.createEggCollection.mock.calls[0]?.[0]).toEqual({
        goodEggsCount: 0,
        brokenEggsCount: 2,
        collectionDate: '2026-09-25',
        employeeId: COLLECTOR_B.id,
      }),
    );
  });

  it('"✕" confirma "¿Eliminar este registro?" y anula en el backend', async () => {
    const user = userEvent.setup();
    api.voidEggCollection.mockResolvedValue({});
    await renderScreen();
    await user.click(
      await screen.findByRole('button', {
        name: `Eliminar recolección de ${COLLECTOR_A.displayName} del Viernes 25/09/2026`,
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: '¿Eliminar este registro?' });
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(api.voidEggCollection).toHaveBeenCalledWith(makeCollection().id));
    await waitFor(() => expect(api.fetchEggCollectionHistory).toHaveBeenCalledTimes(2));
  });
});
