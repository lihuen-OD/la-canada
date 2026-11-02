import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/httpClient';
import type {
  GardenBatchDetail,
  GardenBatchSummary,
  GardenCropRecord,
  GardenCropViewer,
  GardenParticipant,
} from '../../api/kitchenGardenTypes';
import { createTestQueryClient, render, screen, waitFor, within } from '../../test/render';

const gardenApi = vi.hoisted(() => ({
  fetchGardenParticipants: vi.fn(),
  fetchGardenActivities: vi.fn(),
  fetchGardenPerformance: vi.fn(),
  fetchGardenHistory: vi.fn(),
  fetchGardenCrops: vi.fn(),
  fetchGardenBatches: vi.fn(),
  fetchGardenBatch: vi.fn(),
  createGardenSowing: vi.fn(),
  createGardenTransplant: vi.fn(),
  updateGardenBatch: vi.fn(),
  setGardenBatchArchived: vi.fn(),
  fetchGardenCropRecords: vi.fn(),
  updateGardenCropRecord: vi.fn(),
  voidGardenCropRecord: vi.fn(),
}));
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('../../api/kitchenGardenApi', () => gardenApi);
vi.mock('../../auth/useAuth', () => ({ useAuth: useAuthMock }));

import KitchenGardenModule from './KitchenGardenModule';

/** Datos SINTÉTICOS: no representan personas ni cultivos reales. */
const ANA: GardenParticipant = {
  id: '00000000-0000-4000-8000-00000000a001',
  displayName: 'Ana sintética',
  colorHex: null,
  active: true,
  roleLabel: 'Jardinera',
  userActive: true,
};
const BETO: GardenParticipant = {
  ...ANA,
  id: '00000000-0000-4000-8000-00000000a002',
  displayName: 'Beto sintético',
};
const RETIRED: GardenParticipant = {
  ...ANA,
  id: '00000000-0000-4000-8000-00000000a003',
  displayName: 'Ciro sintético',
  active: false,
};
const TODAY = '2026-11-02';
const BATCH_ID = '00000000-0000-4000-8000-0000000b0001';
const ANA_VIEWER = { canRecord: true, participantId: ANA.id };

function record(overrides: Partial<GardenCropRecord> = {}): GardenCropRecord {
  return {
    id: '00000000-0000-4000-8000-0000000c0001',
    type: 'SOWING',
    performedOn: '2026-10-20',
    performedBy: { id: BETO.id, displayName: BETO.displayName, colorHex: null },
    recordedBy: { displayName: 'Admin sintética' },
    method: 'SEEDBED',
    location: 'Almácigo del invernadero',
    quantity: '120',
    quantityUnit: 'SEEDS',
    notes: null,
    version: 1,
    createdAt: '2026-10-20T12:00:00.000Z',
    ...overrides,
  };
}

function detail(overrides: Partial<GardenBatchDetail> = {}): GardenBatchDetail {
  return {
    id: BATCH_ID,
    crop: { id: 'crop-1', name: 'Lechuga sintética' },
    name: 'Tanda de primavera',
    variety: 'Mantecosa',
    notes: null,
    archived: false,
    archivedAt: null,
    version: 4,
    transplantPlan: {
      pending: true,
      expectedDate: '2026-11-10',
      status: 'SCHEDULED',
      closedAt: null,
      closedBy: null,
    },
    sowing: record(),
    transplants: [
      record({
        id: '00000000-0000-4000-8000-0000000c0002',
        type: 'TRANSPLANT',
        performedOn: '2026-10-30',
        performedBy: { id: ANA.id, displayName: ANA.displayName, colorHex: null },
        method: null,
        location: 'Cantero 4',
        quantity: '30',
        quantityUnit: 'SEEDLINGS',
      }),
    ],
    ...overrides,
  };
}

function summary(id: string, overrides: Partial<GardenBatchSummary> = {}): GardenBatchSummary {
  return {
    id: `00000000-0000-4000-8000-0000000b${id.padStart(4, '0')}`,
    crop: { id: 'crop-1', name: 'Lechuga sintética' },
    name: `Tanda ${id}`,
    variety: null,
    notes: null,
    archived: false,
    archivedAt: null,
    version: 1,
    transplantPlan: { pending: false, expectedDate: null, status: null, closedAt: null },
    sowing: {
      id: `sowing-${id}`,
      performedOn: '2026-10-20',
      method: 'DIRECT',
      location: 'Cantero 1',
      performedBy: { id: ANA.id, displayName: ANA.displayName, colorHex: null },
    },
    transplantCount: 0,
    ...overrides,
  };
}

const batchesPage = (
  batches: GardenBatchSummary[],
  viewer: GardenCropViewer = ANA_VIEWER,
  extra = {},
) => ({
  batches,
  page: 1,
  pageSize: 20,
  total: batches.length,
  totalPages: 1,
  today: TODAY,
  generatedAt: '2026-11-02T15:00:00.000Z',
  viewer,
  ...extra,
});

function asUser(role: 'ADMIN' | 'EMPLOYEE') {
  useAuthMock.mockReturnValue({
    user: { id: 'u-1', role, status: 'ACTIVE', displayName: 'Sintética', employee: null },
    logout: vi.fn(),
  });
}

function renderGarden(route: string, queryClient = createTestQueryClient()) {
  render(
    <Routes>
      <Route path="/kitchen-garden/*" element={<KitchenGardenModule />} />
    </Routes>,
    { route, queryClient },
  );
  return queryClient;
}

beforeEach(() => {
  for (const mock of Object.values(gardenApi)) mock.mockReset();
  asUser('EMPLOYEE');
  gardenApi.fetchGardenParticipants.mockResolvedValue({ participants: [ANA, BETO, RETIRED] });
  gardenApi.fetchGardenCrops.mockResolvedValue({
    crops: [{ id: 'crop-1', name: 'Lechuga sintética', batchCount: 1 }],
  });
  gardenApi.fetchGardenBatch.mockResolvedValue({
    batch: detail(),
    today: TODAY,
    viewer: ANA_VIEWER,
  });
});

describe('🥕 Cultivos', () => {
  it('tandas con cultivo, lugar, siembra y lo previsto, en el orden del backend', async () => {
    gardenApi.fetchGardenBatches.mockResolvedValue(
      batchesPage([
        summary('1', {
          transplantPlan: {
            pending: true,
            expectedDate: '2026-10-30',
            status: 'PAST',
            closedAt: null,
          },
        }),
        summary('2', {
          transplantPlan: {
            pending: true,
            expectedDate: TODAY,
            status: 'DUE_TODAY',
            closedAt: null,
          },
        }),
        summary('3', {
          transplantPlan: {
            pending: true,
            expectedDate: '2026-11-15',
            status: 'SCHEDULED',
            closedAt: null,
          },
          transplantCount: 2,
        }),
        summary('4'),
      ]),
    );
    renderGarden('/kitchen-garden/crops');
    const list = await screen.findByRole('list', { name: 'Tandas activas' });
    const cards = within(list).getAllByRole('link');
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('Fecha prevista pasada (30/10/2026)'),
      expect.stringContaining('Para hoy'),
      expect.stringContaining('Previsto para el 15/11/2026'),
      expect.not.stringContaining('Previsto'),
    ]);
    expect(cards[0]).toHaveTextContent('Sembrada el 20/10/2026 · Siembra directa · Cantero 1');
    expect(cards[2]).toHaveTextContent('2 trasplantes');
    expect(cards[0]).toHaveAttribute('href', `/kitchen-garden/crops/${summary('1').id}`);
    expect(gardenApi.fetchGardenBatches).toHaveBeenCalledWith({
      status: 'active',
      page: 1,
      pageSize: 20,
    });
    // Nunca se pide nada de las actividades ni del Desempeño de la Huerta.
    expect(gardenApi.fetchGardenActivities).not.toHaveBeenCalled();
    expect(gardenApi.fetchGardenPerformance).not.toHaveBeenCalled();
  });

  it('acceso a las archivadas y «Ver más» paginado por el backend', async () => {
    const user = userEvent.setup();
    gardenApi.fetchGardenBatches.mockImplementation(async ({ status, page }) =>
      status === 'archived'
        ? batchesPage([summary('9', { archived: true })])
        : batchesPage([summary(String(page))], ANA_VIEWER, {
            page,
            total: 2,
            totalPages: 2,
            pageSize: 1,
          }),
    );
    renderGarden('/kitchen-garden/crops');
    await screen.findByRole('list', { name: 'Tandas activas' });
    await user.click(screen.getByRole('button', { name: /Ver más \(1 de 2\)/ }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Tandas activas' })).getAllByRole('link'),
      ).toHaveLength(2),
    );
    await user.click(screen.getByRole('button', { name: 'Archivadas' }));
    const archived = await screen.findByRole('list', { name: 'Tandas archivadas' });
    expect(within(archived).getByText('Archivada')).toBeInTheDocument();
  });

  it('quien no participa consulta sin «Registrar siembra»; vacío claro', async () => {
    gardenApi.fetchGardenBatches.mockResolvedValue(
      batchesPage([], { canRecord: false, participantId: null }),
    );
    renderGarden('/kitchen-garden/crops');
    expect(await screen.findByText('Todavía no hay cultivos registrados.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar/ })).not.toBeInTheDocument();
  });

  it('«Registrar siembra»: preselecciona la propia participación; almácigo con fecha prevista; una sola solicitud', async () => {
    const user = userEvent.setup();
    gardenApi.fetchGardenBatches.mockResolvedValue(batchesPage([]));
    gardenApi.createGardenSowing.mockResolvedValue({ batch: detail() });
    renderGarden('/kitchen-garden/crops');
    await user.click(await screen.findByRole('button', { name: /Registrar siembra/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Registrar siembra' });
    const person = within(dialog).getByLabelText('¿Quién sembró?');
    expect(person).toHaveValue(ANA.id);
    // Quien ya no participa no se ofrece para un hecho nuevo.
    expect(within(person).queryByText(/Ciro/)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Fecha prevista/)).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Cultivo'), 'Lechuga sintética');
    await user.type(within(dialog).getByLabelText('Nombre de la tanda'), 'Tanda de primavera');
    await user.click(within(dialog).getByRole('radio', { name: /Almácigo/ }));
    await user.type(within(dialog).getByLabelText('Lugar'), 'Almácigo del invernadero');
    await user.type(within(dialog).getByLabelText('Cantidad (opcional)'), '120');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar siembra' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/unidad/);
    await user.selectOptions(within(dialog).getByLabelText('Unidad'), 'SEEDS');
    await user.selectOptions(person, BETO.id);
    await user.type(
      within(dialog).getByLabelText('Fecha prevista de trasplante (opcional)'),
      '2026-11-10',
    );
    await user.dblClick(within(dialog).getByRole('button', { name: 'Registrar siembra' }));
    await waitFor(() => expect(gardenApi.createGardenSowing).toHaveBeenCalledTimes(1));
    const [body, key] = gardenApi.createGardenSowing.mock.calls[0] ?? [];
    expect(body).toEqual({
      cropName: 'Lechuga sintética',
      batchName: 'Tanda de primavera',
      performedOn: TODAY,
      performedByParticipantId: BETO.id,
      method: 'SEEDBED',
      location: 'Almácigo del invernadero',
      quantity: '120',
      quantityUnit: 'SEEDS',
      expectedTransplantDate: '2026-11-10',
    });
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    // Lleva a la ficha de la tanda recién creada.
    expect(
      await screen.findByRole('list', { name: 'Seguimiento de la tanda' }),
    ).toBeInTheDocument();
  });

  it('un ADMIN sin participación elige explícitamente quién sembró; una falla conserva el borrador', async () => {
    const user = userEvent.setup();
    asUser('ADMIN');
    gardenApi.fetchGardenBatches.mockResolvedValue(
      batchesPage([], { canRecord: true, participantId: null }),
    );
    gardenApi.createGardenSowing.mockRejectedValue(
      new ApiError(503, 'Servicio no disponible.', undefined),
    );
    renderGarden('/kitchen-garden/crops');
    await user.click(await screen.findByRole('button', { name: /Registrar siembra/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Registrar siembra' });
    expect(within(dialog).getByLabelText('¿Quién sembró?')).toHaveValue('');
    await user.type(within(dialog).getByLabelText('Cultivo'), 'Acelga sintética');
    await user.type(within(dialog).getByLabelText('Nombre de la tanda'), 'Tanda 1');
    await user.click(within(dialog).getByRole('radio', { name: /Siembra directa/ }));
    await user.type(within(dialog).getByLabelText('Lugar'), 'Cantero 2');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar siembra' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Elegí quién sembró.');
    await user.selectOptions(within(dialog).getByLabelText('¿Quién sembró?'), ANA.id);
    await user.click(within(dialog).getByRole('button', { name: 'Registrar siembra' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Servicio no disponible.');
    expect(within(dialog).getByLabelText('Cultivo')).toHaveValue('Acelga sintética');
    // El reintento usa la MISMA clave: no crea dos tandas.
    await user.click(within(dialog).getByRole('button', { name: 'Registrar siembra' }));
    await waitFor(() => expect(gardenApi.createGardenSowing).toHaveBeenCalledTimes(2));
    const keys = gardenApi.createGardenSowing.mock.calls.map((call) => call[1] as string);
    expect(keys[1]).toBe(keys[0]);
  });
});

describe('ficha de la tanda', () => {
  it('seguimiento cronológico con quién lo hizo y quién lo registró; lo previsto con su etiqueta', async () => {
    renderGarden(`/kitchen-garden/crops/${BATCH_ID}`);
    const timeline = await screen.findByRole('list', { name: 'Seguimiento de la tanda' });
    const items = within(timeline).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Siembra');
    expect(items[0]).toHaveTextContent('20/10/2026');
    expect(items[0]).toHaveTextContent('Almácigo');
    expect(items[0]).toHaveTextContent('Lugar: Almácigo del invernadero · 120 semillas');
    expect(items[0]).toHaveTextContent('Lo hizo Beto sintético · registró Admin sintética');
    expect(items[1]).toHaveTextContent('Destino: Cantero 4 · 30 plantines');
    expect(screen.getByText('Previsto para el 10/11/2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Cultivos/ })).toHaveAttribute(
      'href',
      '/kitchen-garden/crops',
    );
  });

  it('quien no participa solo consulta; archivada se consulta y solo ofrece «Reabrir»', async () => {
    gardenApi.fetchGardenBatch.mockResolvedValue({
      batch: detail(),
      today: TODAY,
      viewer: { canRecord: false, participantId: null },
    });
    const { unmount } = render(
      <Routes>
        <Route path="/kitchen-garden/*" element={<KitchenGardenModule />} />
      </Routes>,
      { route: `/kitchen-garden/crops/${BATCH_ID}`, queryClient: createTestQueryClient() },
    );
    await screen.findByRole('list', { name: 'Seguimiento de la tanda' });
    expect(
      screen.queryByRole('button', { name: /Registrar trasplante|Corregir|Anular|Archivar/ }),
    ).toBeNull();
    unmount();
    gardenApi.fetchGardenBatch.mockResolvedValue({
      batch: detail({ archived: true, archivedAt: '2026-11-01T12:00:00.000Z' }),
      today: TODAY,
      viewer: ANA_VIEWER,
    });
    renderGarden(`/kitchen-garden/crops/${BATCH_ID}`);
    expect(
      await screen.findByText(/Tanda archivada: se puede consultar. Reabrila/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reabrir' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Registrar trasplante|Corregir|Anular/ }),
    ).toBeNull();
  });

  it('trasplante parcial: por defecto quedan pendientes y se conserva la fecha; «No quedan» es explícito', async () => {
    const user = userEvent.setup();
    gardenApi.createGardenTransplant.mockResolvedValue({ batch: detail() });
    const queryClient = renderGarden(`/kitchen-garden/crops/${BATCH_ID}`);
    const activities = ['session', 'u-1', 'kitchenGarden', 'activities', 'active'];
    queryClient.setQueryData(activities, { activities: [] });
    await user.click(await screen.findByRole('button', { name: /Registrar trasplante/ }));
    let dialog = await screen.findByRole('dialog', { name: 'Registrar trasplante' });
    expect(within(dialog).getByRole('radio', { name: /Sí, quedan pendientes/ })).toBeChecked();
    expect(within(dialog).getByLabelText(/Fecha prevista del próximo trasplante/)).toHaveValue(
      '2026-11-10',
    );
    await user.type(within(dialog).getByLabelText('Lugar de destino'), 'Cantero 5');
    await user.type(within(dialog).getByLabelText('Plantines (opcional)'), '20');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar trasplante' }));
    await waitFor(() => expect(gardenApi.createGardenTransplant).toHaveBeenCalledTimes(1));
    const [batchId, body] = gardenApi.createGardenTransplant.mock.calls[0] ?? [];
    expect(batchId).toBe(BATCH_ID);
    expect(body).toEqual({
      batchVersion: 4,
      performedOn: TODAY,
      performedByParticipantId: ANA.id,
      location: 'Cantero 5',
      quantity: '20',
      remainingPending: true,
    });
    // Solo se invalida lo de cultivos: nunca las actividades de la Huerta.
    expect(queryClient.getQueryState(activities)?.isInvalidated).toBe(false);

    await user.click(await screen.findByRole('button', { name: /Registrar trasplante/ }));
    dialog = await screen.findByRole('dialog', { name: 'Registrar trasplante' });
    await user.type(within(dialog).getByLabelText('Lugar de destino'), 'Cantero 6');
    await user.click(
      within(dialog).getByRole('radio', { name: 'No quedan trasplantes pendientes' }),
    );
    expect(within(dialog).queryByLabelText(/Fecha prevista/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Registrar trasplante' }));
    await waitFor(() => expect(gardenApi.createGardenTransplant).toHaveBeenCalledTimes(2));
    expect(gardenApi.createGardenTransplant.mock.calls[1]?.[1]).toMatchObject({
      remainingPending: false,
    });
  });

  it('el trasplante no puede ser anterior a la siembra; un conflicto se explica y conserva el borrador', async () => {
    const user = userEvent.setup();
    gardenApi.createGardenTransplant.mockRejectedValue(
      new ApiError(409, 'Otra persona cambió esta tanda.', 'GARDEN_BATCH_CHANGED'),
    );
    renderGarden(`/kitchen-garden/crops/${BATCH_ID}`);
    await user.click(await screen.findByRole('button', { name: /Registrar trasplante/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Registrar trasplante' });
    const date = within(dialog).getByLabelText('Fecha del trasplante');
    expect(date).toHaveAttribute('min', '2026-10-20');
    expect(date).toHaveAttribute('max', TODAY);
    await user.clear(date);
    await user.type(date, '2026-10-19');
    await user.type(within(dialog).getByLabelText('Lugar de destino'), 'Cantero 5');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar trasplante' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'El trasplante no puede ser anterior a la siembra (20/10/2026).',
    );
    expect(gardenApi.createGardenTransplant).not.toHaveBeenCalled();
    await user.clear(date);
    await user.type(date, '2026-11-01');
    await user.click(
      within(dialog).getByRole('radio', { name: 'No quedan trasplantes pendientes' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Registrar trasplante' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Otra persona cambió esta tanda mientras la tenías abierta. Tocá «Cancelar» para ver los datos actuales y volvé a intentar.',
    );
    expect(within(dialog).getByLabelText('Lugar de destino')).toHaveValue('Cantero 5');
    await waitFor(() => expect(gardenApi.fetchGardenBatch.mock.calls.length).toBeGreaterThan(1));
  });

  it('corregir: solo lo que cambió con la versión que se abrió; sin cambios no envía nada', async () => {
    const user = userEvent.setup();
    gardenApi.updateGardenCropRecord.mockResolvedValue({ batch: detail(), changed: true });
    renderGarden(`/kitchen-garden/crops/${BATCH_ID}`);
    await user.click(
      await screen.findByRole('button', { name: 'Corregir siembra del 20/10/2026' }),
    );
    let dialog = await screen.findByRole('dialog', { name: 'Corregir siembra' });
    expect(dialog).toHaveTextContent('Registrado por Admin sintética: no cambia.');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Corregir siembra' })).toBeNull(),
    );
    expect(gardenApi.updateGardenCropRecord).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Corregir siembra del 20/10/2026' }));
    dialog = await screen.findByRole('dialog', { name: 'Corregir siembra' });
    const location = within(dialog).getByLabelText('Lugar');
    await user.clear(location);
    await user.type(location, 'Almácigo norte');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(gardenApi.updateGardenCropRecord).toHaveBeenCalledWith(record().id, {
        version: 1,
        location: 'Almácigo norte',
      }),
    );
  });

  it('anular pide confirmación con motivo y explica qué pasa con la siembra', async () => {
    const user = userEvent.setup();
    gardenApi.voidGardenCropRecord.mockResolvedValue({ record: { id: record().id } });
    renderGarden(`/kitchen-garden/crops/${BATCH_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Anular siembra del 20/10/2026' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Anular la siembra?' });
    expect(dialog).toHaveTextContent('sale de Cultivos y no admite registros nuevos');
    expect(dialog).toHaveTextContent('queda en la auditoría con el motivo');
    await user.click(within(dialog).getByRole('button', { name: 'Anular' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/motivo/);
    expect(gardenApi.voidGardenCropRecord).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Motivo'), 'Cargado dos veces');
    await user.dblClick(within(dialog).getByRole('button', { name: 'Anular' }));
    await waitFor(() => expect(gardenApi.voidGardenCropRecord).toHaveBeenCalledTimes(1));
    expect(gardenApi.voidGardenCropRecord).toHaveBeenCalledWith(record().id, 'Cargado dos veces');
  });

  it('archivar pide confirmación y no borra nada', async () => {
    const user = userEvent.setup();
    gardenApi.setGardenBatchArchived.mockResolvedValue({ batch: detail({ archived: true }) });
    renderGarden(`/kitchen-garden/crops/${BATCH_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Archivar' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Archivar «Tanda de primavera»?' });
    expect(dialog).toHaveTextContent('No se borra nada.');
    await user.click(within(dialog).getByRole('button', { name: 'Archivar' }));
    await waitFor(() =>
      expect(gardenApi.setGardenBatchArchived).toHaveBeenCalledWith(BATCH_ID, true),
    );
  });
});

describe('📝 Registros', () => {
  it('más recientes primero; filtros de fecha, cultivo, tanda, tipo y persona en el backend', async () => {
    const user = userEvent.setup();
    gardenApi.fetchGardenBatches.mockResolvedValue(batchesPage([summary('1')]));
    gardenApi.fetchGardenCropRecords.mockResolvedValue({
      records: [
        {
          ...detail().transplants[0]!,
          batch: { id: BATCH_ID, name: 'Tanda de primavera', crop: detail().crop, archived: false },
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      today: TODAY,
      viewer: ANA_VIEWER,
    });
    renderGarden('/kitchen-garden/records');
    const list = await screen.findByRole('list', { name: 'Registros de cultivos' });
    expect(
      within(list).getByRole('link', { name: 'Lechuga sintética · Tanda de primavera' }),
    ).toHaveAttribute('href', `/kitchen-garden/crops/${BATCH_ID}`);
    expect(gardenApi.fetchGardenCropRecords).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
    await user.click(screen.getByRole('button', { name: /Trasplantes/ }));
    await user.type(screen.getByLabelText('Desde'), '2026-10-01');
    await user.selectOptions(screen.getByLabelText('Cultivo'), 'crop-1');
    await waitFor(() => expect(screen.getByLabelText('Tanda')).not.toBeDisabled());
    await waitFor(() =>
      expect(within(screen.getByLabelText('Tanda')).getByText('Tanda 1')).toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByLabelText('Tanda'), summary('1').id);
    await user.selectOptions(screen.getByLabelText('Persona'), RETIRED.id);
    await waitFor(() =>
      expect(gardenApi.fetchGardenCropRecords).toHaveBeenLastCalledWith({
        from: '2026-10-01',
        cropId: 'crop-1',
        batchId: summary('1').id,
        type: 'TRANSPLANT',
        participantId: RETIRED.id,
        page: 1,
        pageSize: 20,
      }),
    );
    // Quien ya no participa se puede filtrar: su historia se conserva.
    expect(
      screen.getByRole('option', { name: 'Ciro sintético (ya no participa)' }),
    ).toBeInTheDocument();
  });

  it('rango invertido: avisa sin pedir nada', async () => {
    const user = userEvent.setup();
    gardenApi.fetchGardenCropRecords.mockResolvedValue({
      records: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1,
      today: TODAY,
      viewer: ANA_VIEWER,
    });
    renderGarden('/kitchen-garden/records');
    expect(await screen.findByText('Todavía no hay registros.')).toBeInTheDocument();
    const calls = gardenApi.fetchGardenCropRecords.mock.calls.length;
    await user.type(screen.getByLabelText('Hasta'), '2026-10-01');
    await user.type(screen.getByLabelText('Desde'), '2026-10-05');
    expect(
      await screen.findByText('La fecha «Desde» no puede ser posterior a «Hasta».'),
    ).toBeInTheDocument();
    expect(
      gardenApi.fetchGardenCropRecords.mock.calls.filter(
        ([filters]) => filters.from === '2026-10-05' && filters.to === '2026-10-01',
      ),
    ).toHaveLength(0);
    expect(gardenApi.fetchGardenCropRecords.mock.calls.length).toBeGreaterThanOrEqual(calls);
  });
});
