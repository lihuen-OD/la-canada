import { act, fireEvent, render, screen, waitFor, within } from '../../test/render';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/httpClient';
import {
  CATEGORY_A,
  CATEGORY_B,
  DESTINATION,
  INACTIVE_DESTINATION,
  categoriesResponse,
  emptyReportSummary,
  itemsList,
  makeCritItem,
  makeItem,
  makeLowItem,
  makeMovement,
  movementsList,
  reportMovementsList,
} from '../../test/fixtures/stock';

const api = vi.hoisted(() => ({
  fetchStockItems: vi.fn(),
  fetchStockCategories: vi.fn(),
  fetchStockDestinations: vi.fn(),
  fetchStockItem: vi.fn(),
  fetchStockItemMovements: vi.fn(),
  fetchStockReportSummary: vi.fn(),
  fetchStockReportMovements: vi.fn(),
  fetchStockReportCsv: vi.fn(),
  createStockMovement: vi.fn(),
  createStockCategory: vi.fn(),
  createStockItem: vi.fn(),
  createStockDestination: vi.fn(),
  updateStockCategory: vi.fn(),
  updateStockItem: vi.fn(),
  updateStockDestination: vi.fn(),
  setStockItemActive: vi.fn(),
}));
const { useAuthMock, logoutMock, fetchTaskEmployeesMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  logoutMock: vi.fn(),
  fetchTaskEmployeesMock: vi.fn(),
}));
vi.mock('../../api/stockApi', () => api);
vi.mock('../../api/tasksApi', () => ({ fetchTaskEmployees: fetchTaskEmployeesMock }));
vi.mock('../../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { StockModule } from './StockModule';

/** El módulo real bajo `/stock/*`, igual que en `AppRoutes`. */
function renderStock(route = '/stock') {
  return render(
    <Routes>
      <Route path="/stock/*" element={<StockModule />} />
    </Routes>,
    { route },
  );
}

const stockNav = () => screen.getByRole('navigation', { name: 'Secciones de Stock' });

const OK_ITEM = makeItem();
const LOW_ITEM = makeLowItem();
const CRIT_ITEM = makeCritItem();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function asEmployee() {
  useAuthMock.mockReturnValue({
    user: { id: 'u-e', role: 'EMPLOYEE', status: 'ACTIVE', employee: { id: 'e1' } },
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

async function renderInventory(items = [OK_ITEM, LOW_ITEM, CRIT_ITEM]) {
  api.fetchStockItems.mockResolvedValue(itemsList(items));
  api.fetchStockCategories.mockResolvedValue(categoriesResponse());
  renderStock();
  await screen.findByRole('heading', { level: 1, name: 'Stock' });
  await screen.findByText(OK_ITEM.name);
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  logoutMock.mockReset();
  fetchTaskEmployeesMock.mockReset();
  fetchTaskEmployeesMock.mockResolvedValue({ employees: [] });
  api.fetchStockDestinations.mockResolvedValue({ destinations: [] });
  api.fetchStockReportSummary.mockResolvedValue(emptyReportSummary());
  api.fetchStockReportMovements.mockResolvedValue(reportMovementsList());
  asEmployee();
});

/** Llamadas a `fetchStockItems` con un filtro dado (p. ej. las de Compras). */
const itemCalls = (match: Record<string, unknown>) =>
  api.fetchStockItems.mock.calls.filter(([params]) =>
    Object.entries(match).every(([key, value]) => params?.[key] === value),
  );

describe('Stock — carga y estados', () => {
  it('carga el inventario server-side con 📦 Stock como título y agrupa por categoría', async () => {
    await renderInventory();

    expect(screen.getByRole('heading', { level: 1, name: 'Stock' })).toHaveTextContent('📦');
    expect(api.fetchStockItems).toHaveBeenCalledWith(
      expect.objectContaining({ area: 'HOUSE', status: 'active', page: 1, pageSize: 50 }),
    );
    expect(api.fetchStockCategories).toHaveBeenCalledWith('active');
    expect(screen.getByRole('region', { name: `Categoría ${CATEGORY_A.name}` })).toBeVisible();
    expect(screen.getByText(LOW_ITEM.name)).toBeInTheDocument();
    expect(screen.getByText(CRIT_ITEM.name)).toBeInTheDocument();
  });

  it('muestra carga inicial y estado de error con reintento', async () => {
    api.fetchStockItems.mockReturnValue(new Promise(() => {}));
    api.fetchStockCategories.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderStock();
    expect(screen.getByText(/cargando inventario/i).closest('[role="status"]')).not.toBeNull();
    unmount();

    api.fetchStockItems.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    renderStock();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/no pudimos cargar el inventario/i);

    api.fetchStockItems.mockResolvedValue(itemsList([OK_ITEM]));
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText(OK_ITEM.name)).toBeInTheDocument();
  });

  it('sesión vencida (401) usa el cierre de sesión global', async () => {
    api.fetchStockItems.mockRejectedValue(
      new ApiError(401, 'Autenticación requerida.', 'AUTH_REQUIRED'),
    );
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    renderStock();
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
  });

  it('estado vacío real cuando el backend no devuelve productos', async () => {
    api.fetchStockItems.mockResolvedValue(itemsList([]));
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    renderStock();
    expect(await screen.findByText(/no hay productos con estos filtros/i)).toBeInTheDocument();
  });
});

describe('Stock — filtros server-side', () => {
  it('🌿 Jardín (pestaña) reconsulta al backend con area=GARDEN', async () => {
    await renderInventory();
    const user = userEvent.setup();
    api.fetchStockItems.mockClear();

    await user.click(within(stockNav()).getByRole('link', { name: /jardín/i }));

    await waitFor(() =>
      expect(api.fetchStockItems).toHaveBeenCalledWith(expect.objectContaining({ area: 'GARDEN' })),
    );
  });

  it('la búsqueda se debouncea y viaja como q=', async () => {
    await renderInventory();
    api.fetchStockItems.mockClear();

    const search = screen.getByLabelText('Buscar producto');
    await userEvent.setup().type(search, 'abono');
    // El debounce (350ms) aún no se cumplió al terminar de escribir.
    expect(api.fetchStockItems).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(api.fetchStockItems).toHaveBeenCalledWith(expect.objectContaining({ q: 'abono' }));
    });
  });

  it('categoría y estado ADMIN se envían al backend y reinician en page=1', async () => {
    asAdmin();
    await renderInventory();
    api.fetchStockItems.mockClear();

    await userEvent.setup().selectOptions(screen.getByLabelText('Categoría'), CATEGORY_A.id);
    await waitFor(() =>
      expect(api.fetchStockItems).toHaveBeenLastCalledWith(
        expect.objectContaining({ categoryId: CATEGORY_A.id, page: 1 }),
      ),
    );

    await userEvent.setup().selectOptions(screen.getByLabelText('Estado'), 'inactive');
    await waitFor(() =>
      expect(api.fetchStockItems).toHaveBeenLastCalledWith(
        expect.objectContaining({ categoryId: CATEGORY_A.id, status: 'inactive', page: 1 }),
      ),
    );
  });

  it('EMPLOYEE: sin filtro de estado ni botón de ajuste ni pestaña Catálogo', async () => {
    await renderInventory();
    asEmployee();
    expect(screen.queryByLabelText('Estado')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ajuste/i })).not.toBeInTheDocument();
    expect(within(stockNav()).queryByRole('link', { name: /catálogo/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /registrar movimiento/i }).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByRole('button', { name: 'Nuevo producto' })).not.toBeInTheDocument();
  });

  it('ADMIN: ve filtro de estado, ajuste y la pestaña Catálogo', async () => {
    asAdmin();
    await renderInventory();
    expect(screen.getByLabelText('Estado')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /ajuste/i }).length).toBeGreaterThan(0);
    expect(within(stockNav()).getByRole('link', { name: /catálogo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo producto' })).toBeInTheDocument();
  });

  it('ADMIN crea un producto desde Casa con el área preseleccionada', async () => {
    asAdmin();
    api.createStockItem.mockResolvedValue({ item: OK_ITEM });
    await renderInventory();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Nuevo producto' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo producto' });
    expect(within(dialog).getByLabelText('Área')).toHaveValue('HOUSE');
  });
});

describe('Stock — tarjetas y reglas de estado', () => {
  it('muestra cantidad, etiqueta textual y barra (o sin barra si mínimo es 0)', async () => {
    const zeroMin = {
      ...OK_ITEM,
      id: '00000000-0000-4000-8000-00000000i099',
      name: 'Producto sintético sin mínimo',
      minimumQuantity: '0',
      currentQuantity: '7',
    };
    await renderInventory([OK_ITEM, zeroMin]);

    expect(screen.getAllByText('Normal').length).toBeGreaterThan(0);
    const bars = document.querySelectorAll('progress.stock-item__bar');
    // Solo el item con mínimo > 0 tiene barra.
    expect(bars).toHaveLength(1);
  });

  it('mínimo 0: sin barra y estado Normal (nunca 100% falso)', async () => {
    api.fetchStockItems.mockResolvedValue(
      itemsList([
        {
          ...OK_ITEM,
          name: 'Producto sintético sin mínimo',
          minimumQuantity: '0',
          currentQuantity: '3',
        },
      ]),
    );
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    renderStock();
    await screen.findByText('Producto sintético sin mínimo');
    expect(document.querySelectorAll('progress.stock-item__bar')).toHaveLength(0);
    expect(screen.getByText('Normal', { selector: '.badge' })).toBeInTheDocument();
  });
});

describe('Stock — paginación', () => {
  it('«Cargar más» pide la página siguiente y acumula', async () => {
    api.fetchStockItems.mockResolvedValueOnce({
      ...itemsList([OK_ITEM]),
      page: 1,
      totalPages: 2,
      total: 2,
    });
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    renderStock();
    await screen.findByText(OK_ITEM.name);

    api.fetchStockItems.mockResolvedValueOnce({
      ...itemsList([OK_ITEM, LOW_ITEM]),
      page: 2,
      totalPages: 2,
      total: 2,
    });

    await userEvent.setup().click(screen.getByRole('button', { name: /cargar más/i }));
    expect(await screen.findByText(LOW_ITEM.name)).toBeInTheDocument();
    expect(screen.getAllByText(OK_ITEM.name)).toHaveLength(1);
    expect(api.fetchStockItems).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
  });

  it('un Cargar más viejo no mezcla resultados después de cambiar de filtro', async () => {
    api.fetchStockItems.mockResolvedValueOnce({
      ...itemsList([OK_ITEM]),
      page: 1,
      totalPages: 2,
      total: 2,
    });
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    renderStock();
    await screen.findByText(OK_ITEM.name);

    const oldPage = deferred<ReturnType<typeof itemsList>>();
    api.fetchStockItems.mockReturnValueOnce(oldPage.promise);
    await userEvent.setup().click(screen.getByRole('button', { name: /cargar más/i }));

    const gardenItem = makeItem({
      id: '00000000-0000-4000-8000-00000000f001',
      name: 'Producto sintético Jardín',
      area: 'GARDEN',
    });
    api.fetchStockItems.mockResolvedValueOnce(itemsList([gardenItem]));
    await userEvent.setup().click(within(stockNav()).getByRole('link', { name: /jardín/i }));
    expect(await screen.findByText(gardenItem.name)).toBeInTheDocument();

    await act(async () => oldPage.resolve(itemsList([LOW_ITEM])));
    expect(screen.queryByText(LOW_ITEM.name)).not.toBeInTheDocument();
    expect(screen.getByText(gardenItem.name)).toBeInTheDocument();
  });

  it('doble click síncrono en Cargar más dispara una sola consulta', async () => {
    api.fetchStockItems.mockResolvedValueOnce({
      ...itemsList([OK_ITEM]),
      page: 1,
      totalPages: 2,
      total: 2,
    });
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    renderStock();
    await screen.findByText(OK_ITEM.name);
    const nextPage = deferred<ReturnType<typeof itemsList>>();
    api.fetchStockItems.mockReturnValueOnce(nextPage.promise);

    const button = screen.getByRole('button', { name: /cargar más/i });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.fetchStockItems).toHaveBeenCalledTimes(2); // inicial + una página adicional

    await act(async () => nextPage.resolve(itemsList([LOW_ITEM])));
  });
});

describe('Stock — diálogos de movimiento', () => {
  async function openUnifiedMovement(type: 'INCOME' | 'CONSUMPTION' = 'CONSUMPTION') {
    await userEvent.setup().click(
      within(screen.getByText(OK_ITEM.name).closest('li') as HTMLElement).getByRole('button', {
        name: /registrar movimiento/i,
      }),
    );
    const dialog = await screen.findByRole('dialog');
    if (type === 'INCOME') {
      await userEvent
        .setup()
        .click(within(dialog).getByRole('button', { name: /ingreso \/ entrada/i }));
    }
    return dialog;
  }

  it.each([
    ['ingreso', 'INCOME'],
    ['consumo', 'CONSUMPTION'],
  ] as const)('EMPLOYEE + %s: envía la fecha visible sin employeeId', async (_label, type) => {
    api.createStockMovement.mockResolvedValue({ movement: {}, item: {} });
    api.fetchStockDestinations.mockResolvedValue({ destinations: [] });
    await renderInventory();

    const dialog = await openUnifiedMovement(type);
    const date = within(dialog).getByLabelText(/fecha/i) as HTMLInputElement;
    await userEvent.setup().type(within(dialog).getByLabelText('Cantidad'), '2');
    await userEvent
      .setup()
      .click(within(dialog).getByRole('button', { name: /registrar movimiento/i }));

    await waitFor(() => expect(api.createStockMovement).toHaveBeenCalledTimes(1));
    expect(api.createStockMovement.mock.calls[0]?.[1]).toEqual({
      type,
      quantity: '2',
      effectiveDate: date.value,
    });
  });

  it('EMPLOYEE: puede usar fecha pasada y destino, pero no elegir otra persona', async () => {
    api.createStockMovement.mockResolvedValue({ movement: {}, item: {} });
    api.fetchStockDestinations.mockResolvedValue({ destinations: [DESTINATION] });
    await renderInventory();

    const dialog = await openUnifiedMovement();
    fireEvent.change(within(dialog).getByLabelText(/fecha/i), {
      target: { value: '2020-01-02' },
    });
    await userEvent
      .setup()
      .selectOptions(await within(dialog).findByLabelText('Destino'), DESTINATION.id);
    expect(within(dialog).queryByRole('combobox', { name: /quién/i })).not.toBeInTheDocument();

    await userEvent.setup().type(within(dialog).getByLabelText('Cantidad'), '2');
    await userEvent
      .setup()
      .click(within(dialog).getByRole('button', { name: /registrar movimiento/i }));

    await waitFor(() => expect(api.createStockMovement).toHaveBeenCalledTimes(1));
    const body = api.createStockMovement.mock.calls[0]?.[1];
    expect(body).toMatchObject({ effectiveDate: '2020-01-02', destinationId: DESTINATION.id });
    expect(body).not.toHaveProperty('employeeId');
  });

  it('ADMIN: el diálogo de ajuste exige motivo y un paso extra de confirmación con saldo actual', async () => {
    asAdmin();
    await renderInventory();

    await userEvent.setup().click(
      within(screen.getByText(OK_ITEM.name).closest('li') as HTMLElement).getByRole('button', {
        name: /ajuste/i,
      }),
    );
    const dialog = await screen.findByRole('dialog');
    const user = userEvent.setup();

    await user.type(within(dialog).getByLabelText('Cantidad'), '5');
    await user.click(within(dialog).getByRole('button', { name: /revisar ajuste/i }));
    // Sin motivo todavía no avanza.
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/motivo/i);
    expect(api.createStockMovement).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/motivo/i), 'Conteo sintético');
    await user.click(within(dialog).getByRole('button', { name: /revisar ajuste/i }));

    expect(within(dialog).getByRole('group', { name: /confirmar ajuste/i })).toBeInTheDocument();
    expect(
      within(dialog).getByText(`${OK_ITEM.currentQuantity} ${OK_ITEM.unit}`),
    ).toBeInTheDocument();
    expect(api.createStockMovement).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: /confirmar ajuste/i }));
    await waitFor(() => expect(api.createStockMovement).toHaveBeenCalledTimes(1));
    const body = api.createStockMovement.mock.calls[0]?.[1];
    expect(body.type).toBe('ADJUSTMENT_INCREASE');
    expect(body.reason).toBe('Conteo sintético');
    expect(body.employeeId).toBeNull();
  });

  it.each([
    ['entrada', 'INCOME'],
    ['consumo', 'CONSUMPTION'],
  ] as const)('ADMIN + %s: permite enviar una fecha pasada explícita', async (_label, type) => {
    asAdmin();
    api.createStockMovement.mockResolvedValue({ movement: {}, item: {} });
    api.fetchStockDestinations.mockResolvedValue({ destinations: [] });
    await renderInventory();

    const dialog = await openUnifiedMovement(type);
    fireEvent.change(within(dialog).getByLabelText(/fecha/i), {
      target: { value: '2020-01-02' },
    });
    await userEvent.setup().type(within(dialog).getByLabelText('Cantidad'), '1.25');
    await userEvent
      .setup()
      .click(within(dialog).getByRole('button', { name: /registrar movimiento/i }));

    await waitFor(() => expect(api.createStockMovement).toHaveBeenCalledTimes(1));
    expect(api.createStockMovement.mock.calls[0]?.[1]).toEqual({
      type,
      quantity: '1.25',
      effectiveDate: '2020-01-02',
      employeeId: null,
    });
  });

  it('ADMIN: rechaza visualmente una fecha futura y no llama al backend', async () => {
    asAdmin();
    await renderInventory();
    const dialog = await openUnifiedMovement('INCOME');
    const dateInput = within(dialog).getByLabelText(/fecha/i);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const future = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    fireEvent.change(dateInput, { target: { value: future } });
    await userEvent.setup().type(within(dialog).getByLabelText('Cantidad'), '1');
    await userEvent
      .setup()
      .click(within(dialog).getByRole('button', { name: /registrar movimiento/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /fecha no puede ser futura/i,
    );
    expect(api.createStockMovement).not.toHaveBeenCalled();
  });

  it('muestra el error del backend (p. ej. STOCK_BALANCE_LIMIT) sin cierre silencioso', async () => {
    asAdmin();
    api.createStockMovement.mockRejectedValue(
      new ApiError(409, 'El movimiento excede el saldo máximo admitido.', 'STOCK_BALANCE_LIMIT'),
    );
    await renderInventory();

    await userEvent.setup().click(
      within(screen.getByText(OK_ITEM.name).closest('li') as HTMLElement).getByRole('button', {
        name: /ajuste/i,
      }),
    );
    const dialog = await screen.findByRole('dialog');
    const user = userEvent.setup();
    await user.type(within(dialog).getByLabelText('Cantidad'), '5');
    await user.type(within(dialog).getByLabelText(/motivo/i), 'Motivo sintético');
    await user.click(within(dialog).getByRole('button', { name: /revisar ajuste/i }));
    await user.click(within(dialog).getByRole('button', { name: /confirmar ajuste/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /incremento superaría el saldo máximo/i,
    );
  });

  it('distingue STOCK_INSUFFICIENT_QUANTITY del límite máximo de incremento', async () => {
    api.createStockMovement.mockRejectedValue(
      new ApiError(
        409,
        'La cantidad supera el stock actual (2 kg).',
        'STOCK_INSUFFICIENT_QUANTITY',
      ),
    );
    api.fetchStockDestinations.mockResolvedValue({ destinations: [] });
    await renderInventory();
    const dialog = await openUnifiedMovement();
    await userEvent.setup().type(within(dialog).getByLabelText('Cantidad'), '99');
    await userEvent
      .setup()
      .click(within(dialog).getByRole('button', { name: /registrar movimiento/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /reducción supera el stock disponible/i,
    );
    expect(within(dialog).getByRole('alert')).not.toHaveTextContent(/saldo máximo/i);
  });

  it('doble submit síncrono registra una sola mutación', async () => {
    const pending = deferred<{ movement: object; item: object }>();
    api.createStockMovement.mockReturnValue(pending.promise);
    await renderInventory();
    const dialog = await openUnifiedMovement('INCOME');
    await userEvent.setup().type(within(dialog).getByLabelText('Cantidad'), '2');
    const form = dialog.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);
    expect(api.createStockMovement).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ movement: {}, item: {} }));
  });

  it('un 401 definitivo de movimiento cierra la sesión una sola vez', async () => {
    api.createStockMovement.mockRejectedValue(
      new ApiError(401, 'Autenticación requerida.', 'AUTH_REQUIRED'),
    );
    await renderInventory();
    const dialog = await openUnifiedMovement('INCOME');
    await userEvent.setup().type(within(dialog).getByLabelText('Cantidad'), '2');
    await userEvent
      .setup()
      .click(within(dialog).getByRole('button', { name: /registrar movimiento/i }));

    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
  });

  it('tras un ingreso exitoso: aviso positivo y recarga del listado', async () => {
    api.createStockMovement.mockResolvedValue({ movement: {}, item: {} });
    api.fetchStockDestinations.mockResolvedValue({ destinations: [] });
    await renderInventory();

    const dialog = await openUnifiedMovement('INCOME');
    await userEvent.setup().type(within(dialog).getByLabelText('Cantidad'), '4');
    await userEvent
      .setup()
      .click(within(dialog).getByRole('button', { name: /registrar movimiento/i }));

    expect(await screen.findByText('Ingreso registrado.')).toBeInTheDocument();
    await waitFor(() => expect(api.fetchStockItems).toHaveBeenCalledTimes(2));
  });
});

describe('Stock — detalle e historial', () => {
  it('abre el diálogo de historial con el snapshot del producto', async () => {
    api.fetchStockItem.mockResolvedValue({ item: OK_ITEM });
    api.fetchStockItemMovements.mockResolvedValue(
      movementsList([
        {
          id: 'm1',
          type: 'INCOME',
          quantity: '5',
          effectiveDate: '2026-09-20',
          reason: null,
          employee: null,
          destination: null,
          createdAt: '2026-09-20T12:00:00.000Z',
        },
      ]),
    );
    await renderInventory();

    await userEvent.setup().click(
      within(screen.getByText(OK_ITEM.name).closest('li') as HTMLElement).getByRole('button', {
        name: /historial/i,
      }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(OK_ITEM.name)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('region', { name: /historial de movimientos/i }),
    ).toBeInTheDocument();
    expect(api.fetchStockItemMovements).toHaveBeenCalledWith(
      OK_ITEM.id,
      expect.objectContaining({ page: 1 }),
    );
    // El snapshot del listado recién cargado alcanza: abrir el detalle cuesta un request.
    expect(api.fetchStockItem).not.toHaveBeenCalled();
  });

  it('una respuesta anterior no sobrescribe un filtro de historial más nuevo', async () => {
    api.fetchStockItem.mockResolvedValue({ item: OK_ITEM });
    const oldResponse = deferred<ReturnType<typeof movementsList>>();
    api.fetchStockItemMovements
      .mockReturnValueOnce(oldResponse.promise)
      .mockResolvedValueOnce(
        movementsList([makeMovement({ id: 'm-new', type: 'INCOME', reason: 'Resultado nuevo' })]),
      );
    await renderInventory();
    await userEvent.setup().click(
      within(screen.getByText(OK_ITEM.name).closest('li') as HTMLElement).getByRole('button', {
        name: /historial/i,
      }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent
      .setup()
      .selectOptions(within(dialog).getByLabelText(/filtrar por tipo/i), 'INCOME');
    expect(await within(dialog).findByText(/resultado nuevo/i)).toBeInTheDocument();

    await act(async () =>
      oldResponse.resolve(
        movementsList([
          makeMovement({ id: 'm-old', type: 'CONSUMPTION', reason: 'Resultado viejo' }),
        ]),
      ),
    );
    expect(within(dialog).queryByText(/resultado viejo/i)).not.toBeInTheDocument();
  });

  it('pagina el historial sin duplicados y bloquea el doble click síncrono', async () => {
    api.fetchStockItem.mockResolvedValue({ item: OK_ITEM });
    const first = makeMovement({ id: 'm-first', reason: 'Primer movimiento' });
    api.fetchStockItemMovements.mockResolvedValueOnce({
      ...movementsList([first]),
      page: 1,
      totalPages: 2,
      total: 2,
    });
    await renderInventory();
    await userEvent.setup().click(
      within(screen.getByText(OK_ITEM.name).closest('li') as HTMLElement).getByRole('button', {
        name: /historial/i,
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/primer movimiento/i)).toBeInTheDocument();

    const next = deferred<ReturnType<typeof movementsList>>();
    api.fetchStockItemMovements.mockReturnValueOnce(next.promise);
    const loadMore = within(dialog).getByRole('button', { name: /cargar más/i });
    fireEvent.click(loadMore);
    fireEvent.click(loadMore);
    expect(api.fetchStockItemMovements).toHaveBeenCalledTimes(2); // inicial + una página

    await act(async () =>
      next.resolve({
        ...movementsList([first, makeMovement({ id: 'm-second', reason: 'Segundo movimiento' })]),
        page: 2,
        totalPages: 2,
        total: 2,
      }),
    );
    expect(await within(dialog).findByText(/segundo movimiento/i)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/primer movimiento/i)).toHaveLength(1);
  });
});

describe('Stock — catálogo ADMIN', () => {
  it('pestaña Catálogo carga categorías con status=all y productos', async () => {
    asAdmin();
    api.fetchStockItems.mockResolvedValue(itemsList([OK_ITEM]));
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    renderStock();
    await screen.findByText(OK_ITEM.name);

    await userEvent.setup().click(within(stockNav()).getByRole('link', { name: /catálogo/i }));

    await waitFor(() =>
      expect(api.fetchStockItems).toHaveBeenCalledWith(expect.objectContaining({ status: 'all' })),
    );
    expect(api.fetchStockDestinations).toHaveBeenCalledWith('all');
    expect(screen.getByRole('button', { name: /nueva categoría/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /nuevo producto/i })).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Categorías de stock' })).toHaveTextContent(
      CATEGORY_A.name,
    );
  });

  it('desactivar categoría con productos activos muestra el 409 STOCK_CATEGORY_IN_USE del backend', async () => {
    asAdmin();
    api.fetchStockItems.mockResolvedValue(itemsList([OK_ITEM]));
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    api.updateStockCategory.mockRejectedValue(
      new ApiError(
        409,
        'La categoría tiene productos activos y no se puede desactivar.',
        'STOCK_CATEGORY_IN_USE',
      ),
    );
    renderStock();
    await screen.findByText(OK_ITEM.name);
    await userEvent.setup().click(within(stockNav()).getByRole('link', { name: /catálogo/i }));

    const deactivate = await screen.findByRole('button', {
      name: new RegExp(`desactivar.*${CATEGORY_A.name}`, 'i'),
    });
    await userEvent.setup().click(deactivate);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/productos activos/i)).toBeInTheDocument();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Desactivar' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /productos activos y no se puede desactivar/i,
    );
    expect(api.updateStockCategory).toHaveBeenCalledWith(
      CATEGORY_A.id,
      expect.objectContaining({ active: false }),
    );
  });
});

describe('Stock — navegación SPA entre subvistas', () => {
  it('EMPLOYEE ve 🏠 Casa, 🌿 Jardín, 🛒 Compras y 📊 Reportes (sin Catálogo), con activo accesible', async () => {
    await renderInventory();
    const links = within(stockNav()).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      '🏠 Casa',
      '🌿 Jardín',
      '🛒 Compras',
      '📊 Reportes',
    ]);
    expect(within(stockNav()).getByRole('link', { name: 'Casa' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Emojis decorativos: el nombre accesible es solo el texto.
    expect(within(stockNav()).getByRole('link', { name: 'Compras' })).toBeInTheDocument();
  });

  it('cambiar de vista conserva los filtros de cada una y reutiliza la caché al volver', async () => {
    await renderInventory();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Buscar producto'), 'sint');
    await waitFor(() =>
      expect(api.fetchStockItems).toHaveBeenCalledWith(expect.objectContaining({ q: 'sint' })),
    );
    api.fetchStockItems.mockImplementation(async (params: { stockLevel?: string }) =>
      itemsList(params.stockLevel === 'low' ? [LOW_ITEM] : []),
    );

    await user.click(within(stockNav()).getByRole('link', { name: /compras/i }));
    expect(await screen.findByText('1 producto por reponer')).toBeInTheDocument();
    expect(within(stockNav()).getByRole('link', { name: 'Compras' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const before = api.fetchStockItems.mock.calls.length;

    await user.click(within(stockNav()).getByRole('link', { name: /casa/i }));
    // Sincrónico, desde caché: la búsqueda sigue y no hay loader ni request nuevo.
    expect(screen.getByLabelText('Buscar producto')).toHaveValue('sint');
    expect(screen.queryByText(/cargando inventario/i)).not.toBeInTheDocument();
    expect(api.fetchStockItems.mock.calls.length).toBe(before);
  });

  it('EMPLOYEE en /stock/catalog: acceso denegado, sin pedir el catálogo administrativo', async () => {
    api.fetchStockItems.mockResolvedValue(itemsList([]));
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    renderStock('/stock/catalog');
    expect(await screen.findByRole('heading', { name: /acceso/i })).toBeInTheDocument();
    expect(api.fetchStockDestinations).not.toHaveBeenCalledWith('all');
    expect(api.fetchStockItems).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'all' }),
    );
  });
});

describe('Stock — stockLevel y filtro de nivel server-side', () => {
  it('muestra el nivel que manda el backend aunque los números sugieran otro', async () => {
    const trusted = makeItem({
      id: '00000000-0000-4000-8000-00000000i777',
      name: 'Producto sintético nivel del backend',
      currentQuantity: '25',
      minimumQuantity: '10',
      stockLevel: 'low',
    });
    await renderInventory([OK_ITEM, trusted]);
    const row = screen.getByText(trusted.name).closest('li') as HTMLElement;
    expect(within(row).getByText('Stock bajo')).toBeInTheDocument();
    expect(row.querySelector('progress')).toHaveClass('stock-item__bar--low');
  });

  it('el filtro «Nivel de stock» viaja al backend (nunca filtra la página en memoria)', async () => {
    await renderInventory();
    api.fetchStockItems.mockClear();
    await userEvent.setup().selectOptions(screen.getByLabelText('Nivel de stock'), 'critical');
    await waitFor(() =>
      expect(api.fetchStockItems).toHaveBeenLastCalledWith(
        expect.objectContaining({ stockLevel: 'critical', area: 'HOUSE', page: 1 }),
      ),
    );
  });
});

describe('Stock — 🛒 Compras (vista derivada)', () => {
  function mockPurchases(critical = [CRIT_ITEM], low = [LOW_ITEM]) {
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    api.fetchStockItems.mockImplementation(async (params: { stockLevel?: string }) =>
      itemsList(
        params.stockLevel === 'critical' ? critical : params.stockLevel === 'low' ? low : [],
      ),
    );
  }

  it('pide críticos y bajos activos al backend, ordenados por nombre, críticos primero', async () => {
    mockPurchases();
    renderStock('/stock/purchases');
    expect(await screen.findByText('2 productos por reponer')).toBeInTheDocument();
    expect(itemCalls({ stockLevel: 'critical', status: 'active', sort: 'name' })).toHaveLength(1);
    expect(itemCalls({ stockLevel: 'low', status: 'active', sort: 'name' })).toHaveLength(1);
    const sections = screen.getAllByRole('region');
    expect(sections[0]).toHaveTextContent('Críticos (1)');
    expect(sections[1]).toHaveTextContent('Stock bajo (1)');
    expect(screen.getByText(/no es una orden de compra/i)).toBeInTheDocument();
  });

  it('cada fila muestra actual, mínimo, unidad, nivel, prioridad y la diferencia de referencia', async () => {
    mockPurchases();
    renderStock('/stock/purchases');
    const row = (await screen.findByText(LOW_ITEM.name)).closest('li') as HTMLElement;
    expect(within(row).getByText('Stock bajo')).toBeInTheDocument();
    expect(within(row).getByText('Prioridad media')).toBeInTheDocument();
    expect(within(row).getByText('3 kg')).toBeInTheDocument();
    expect(within(row).getByText('10 kg')).toBeInTheDocument();
    // máximo(10 − 3, 0) = 7
    expect(within(row).getByText('Para llegar al mínimo').nextSibling).toHaveTextContent('7 kg');
    expect(row).toHaveTextContent('🏠 Casa');
    const critical = screen.getByText(CRIT_ITEM.name).closest('li') as HTMLElement;
    expect(within(critical).getByText('Prioridad alta')).toBeInTheDocument();
  });

  it('agrupa por categoría y comparte la lista visible con Web Share', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    mockPurchases();
    renderStock('/stock/purchases');
    await screen.findByText('2 productos por reponer');
    const user = userEvent.setup();
    await user.click(
      within(screen.getByRole('group', { name: 'Agrupar compras' })).getByRole('button', {
        name: 'Por categoría',
      }),
    );
    expect(screen.getByRole('region', { name: /Casa —/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /compartir/i }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0]?.[0].text).toContain(LOW_ITEM.name);
    expect(share.mock.calls[0]?.[0].text).toContain('actual: 3 kg; mínimo: 10 kg; falta: 7 kg');
    expect(await screen.findByText('Lista compartida.')).toBeInTheDocument();
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });

  it('usa el portapapeles cuando Web Share no está disponible', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    mockPurchases();
    renderStock('/stock/purchases');
    await screen.findByText('2 productos por reponer');
    await user.click(screen.getByRole('button', { name: /compartir/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Lista copiada al portapapeles.')).toBeInTheDocument();
  });

  it('filtros: «Críticos» consulta solo ese nivel; área y búsqueda viajan al backend', async () => {
    mockPurchases();
    renderStock('/stock/purchases');
    await screen.findByText('2 productos por reponer');
    const user = userEvent.setup();
    api.fetchStockItems.mockClear();

    await user.click(
      within(screen.getByRole('group', { name: 'Filtrar por nivel' })).getByRole('button', {
        name: /críticos/i,
      }),
    );
    expect(await screen.findByText('1 producto por reponer')).toBeInTheDocument();
    expect(screen.queryByText(LOW_ITEM.name)).not.toBeInTheDocument();

    await user.click(
      within(screen.getByRole('group', { name: 'Filtrar por área' })).getByRole('button', {
        name: /jardín/i,
      }),
    );
    await waitFor(() =>
      expect(itemCalls({ stockLevel: 'critical', area: 'GARDEN' }).length).toBeGreaterThan(0),
    );
    expect(itemCalls({ stockLevel: 'low', area: 'GARDEN' })).toHaveLength(0);
  });

  it('vacío positivo: «No hay compras pendientes»', async () => {
    mockPurchases([], []);
    renderStock('/stock/purchases');
    expect(await screen.findByText('No hay compras pendientes.')).toBeInTheDocument();
  });

  it('registrar una entrada desde Compras invalida la lista y el producto que llegó al mínimo desaparece', async () => {
    mockPurchases();
    api.createStockMovement.mockResolvedValue({ movement: {}, item: {} });
    renderStock('/stock/purchases');
    const row = (await screen.findByText(LOW_ITEM.name)).closest('li') as HTMLElement;
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: /registrar entrada/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Cantidad'), '7');

    // A partir de ahora el backend ya no lo devuelve como bajo.
    mockPurchases([CRIT_ITEM], []);
    await user.click(within(dialog).getByRole('button', { name: /registrar movimiento/i }));

    expect(await screen.findByText('Ingreso registrado.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(LOW_ITEM.name)).not.toBeInTheDocument());
    expect(screen.getByText(CRIT_ITEM.name)).toBeInTheDocument();
    expect(api.createStockMovement).toHaveBeenCalledWith(
      LOW_ITEM.id,
      expect.objectContaining({ type: 'INCOME', quantity: '7' }),
      expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/),
    );
  });

  it('ADMIN puede abrir la edición del producto desde Compras', async () => {
    asAdmin();
    mockPurchases();
    renderStock('/stock/purchases');
    const row = (await screen.findByText(LOW_ITEM.name)).closest('li') as HTMLElement;
    await userEvent.setup().click(within(row).getByRole('button', { name: /editar producto/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('error con reintento y sin datos inventados', async () => {
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    api.fetchStockItems.mockRejectedValue(new TypeError('Failed to fetch'));
    renderStock('/stock/purchases');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/no pudimos cargar la lista de compras/i);
  });
});

describe('Stock — 📊 Reportes', () => {
  beforeEach(() => {
    api.fetchStockItems.mockResolvedValue(itemsList([]));
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
  });

  it('pide resumen y movimientos al backend (30 días por defecto) y muestra estados vacíos reales', async () => {
    renderStock('/stock/reports');
    expect(await screen.findByRole('region', { name: 'Resumen del período' })).toBeInTheDocument();
    expect(api.fetchStockReportSummary).toHaveBeenCalledTimes(1);
    const filters = api.fetchStockReportSummary.mock.calls[0]?.[0];
    expect(filters.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(filters.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(api.fetchStockReportMovements).toHaveBeenCalledWith(
      expect.objectContaining({ from: filters.from, to: filters.to, page: 1, pageSize: 20 }),
    );
    expect(await screen.findByText('Sin movimientos en el período.')).toBeInTheDocument();
    expect(screen.getAllByText('No hubo consumos en el período.')).toHaveLength(2);
    // Los catálogos de los filtros avanzados no se piden hasta abrirlos.
    expect(api.fetchStockDestinations).not.toHaveBeenCalled();
    expect(fetchTaskEmployeesMock).not.toHaveBeenCalled();
  });

  it('cantidades por unidad (nunca un total mezclado) y conteos por tipo', async () => {
    const summary = emptyReportSummary();
    summary.totals.consumption = {
      count: 3,
      byUnit: [
        { unit: 'kg', quantity: '3.5' },
        { unit: 'litros', quantity: '2' },
      ],
    };
    summary.totals.movements = 3;
    api.fetchStockReportSummary.mockResolvedValue(summary);
    renderStock('/stock/reports');
    const kpis = await screen.findByRole('region', { name: 'Resumen del período' });
    expect(within(kpis).getByText('3.5 kg')).toBeInTheDocument();
    expect(within(kpis).getByText('2 litros')).toBeInTheDocument();
    expect(kpis).not.toHaveTextContent('5.5');
  });

  it('cambiar de período o área es una consulta nueva al backend (60 s de caché por filtros)', async () => {
    renderStock('/stock/reports');
    await screen.findByRole('region', { name: 'Resumen del período' });
    const user = userEvent.setup();
    await user.click(
      within(screen.getByRole('group', { name: 'Período' })).getByRole('button', {
        name: '7 días',
      }),
    );
    await user.click(
      within(screen.getByRole('group', { name: 'Filtrar por área' })).getByRole('button', {
        name: /jardín/i,
      }),
    );
    await waitFor(() =>
      expect(api.fetchStockReportSummary).toHaveBeenLastCalledWith(
        expect.objectContaining({ area: 'GARDEN' }),
      ),
    );
    // Volver a un filtro ya consultado sale de la caché.
    const before = api.fetchStockReportSummary.mock.calls.length;
    await user.click(
      within(screen.getByRole('group', { name: 'Filtrar por área' })).getByRole('button', {
        name: 'Todas',
      }),
    );
    expect(api.fetchStockReportSummary.mock.calls.length).toBe(before);
  });

  it('«Más filtros» carga sus catálogos y envía persona/destino/tipo al backend', async () => {
    fetchTaskEmployeesMock.mockResolvedValue({
      employees: [{ id: 'e-sint', displayName: 'Persona sintética', colorHex: '#4a7c59' }],
    });
    api.fetchStockDestinations.mockResolvedValue({ destinations: [DESTINATION] });
    renderStock('/stock/reports');
    await screen.findByRole('region', { name: 'Resumen del período' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Más filtros' }));
    expect(api.fetchStockDestinations).toHaveBeenCalledWith('active');
    await user.selectOptions(await screen.findByLabelText('Persona'), 'e-sint');
    await user.selectOptions(screen.getByLabelText('Tipo de movimiento'), 'CONSUMPTION');
    await waitFor(() =>
      expect(api.fetchStockReportSummary).toHaveBeenLastCalledWith(
        expect.objectContaining({ employeeId: 'e-sint', type: 'CONSUMPTION' }),
      ),
    );
    // El destino es opcional en cualquier tipo de movimiento.
    await user.selectOptions(screen.getByLabelText('Tipo de movimiento'), 'INCOME');
    expect(screen.getByLabelText('Destino')).toBeInTheDocument();
  });

  it('una validación del backend (rango abusivo) se muestra en lenguaje humano', async () => {
    api.fetchStockReportSummary.mockRejectedValue(
      new ApiError(400, 'El período no puede superar 366 días.', 'VALIDATION_ERROR'),
    );
    renderStock('/stock/reports');
    expect(await screen.findByText('El período no puede superar 366 días.')).toBeInTheDocument();
    expect(screen.queryByText('VALIDATION_ERROR')).not.toBeInTheDocument();
  });
});

describe('Stock — destinos en el Catálogo (ADMIN)', () => {
  beforeEach(() => {
    asAdmin();
    api.fetchStockItems.mockResolvedValue(itemsList([OK_ITEM]));
    api.fetchStockCategories.mockResolvedValue(categoriesResponse([CATEGORY_A, CATEGORY_B]));
    api.fetchStockDestinations.mockResolvedValue({
      destinations: [DESTINATION, INACTIVE_DESTINATION],
    });
  });

  it('lista activos e inactivos con su tipo y sin botón de borrar', async () => {
    renderStock('/stock/catalog');
    const list = await screen.findByRole('list', { name: 'Destinos de consumo' });
    expect(within(list).getByText(DESTINATION.name)).toBeInTheDocument();
    expect(within(list).getByText('Vehículo')).toBeInTheDocument();
    expect(within(list).getByText('Sector')).toBeInTheDocument();
    expect(within(list).getByText('Inactivo')).toBeInTheDocument();
    expect(
      within(list).queryByRole('button', { name: /borrar|eliminar/i }),
    ).not.toBeInTheDocument();
  });

  it('crear destino con tipo; el duplicado muestra un mensaje claro', async () => {
    api.createStockDestination
      .mockRejectedValueOnce(
        new ApiError(409, 'Ya existe un destino con ese nombre.', 'STOCK_DESTINATION_DUPLICATE'),
      )
      .mockResolvedValueOnce({ destination: { ...DESTINATION, id: 'd-nuevo', name: 'Nuevo' } });
    renderStock('/stock/catalog');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '+ Nuevo destino' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Destino sintético nuevo');
    await user.selectOptions(within(dialog).getByLabelText('Tipo'), 'SECTOR');
    await user.click(within(dialog).getByRole('button', { name: 'Crear destino' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Ya existe un destino con ese nombre.',
    );
    expect(api.createStockDestination).toHaveBeenCalledWith({
      name: 'Destino sintético nuevo',
      type: 'SECTOR',
    });

    const before = api.fetchStockDestinations.mock.calls.length;
    await user.click(within(dialog).getByRole('button', { name: 'Crear destino' }));
    expect(await screen.findByText('Destino creado.')).toBeInTheDocument();
    // Invalidación selectiva: se vuelve a pedir el listado de destinos.
    await waitFor(() =>
      expect(api.fetchStockDestinations.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it('renombrar nunca envía el tipo (inmutable)', async () => {
    api.updateStockDestination.mockResolvedValue({
      destination: { ...DESTINATION, name: 'Renombrado' },
    });
    renderStock('/stock/catalog');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Renombrar: ${DESTINATION.name}` }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Tipo')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/no se puede cambiar/)).toBeInTheDocument();
    const name = within(dialog).getByLabelText('Nombre');
    await user.clear(name);
    await user.type(name, 'Destino sintético renombrado');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar nombre' }));
    await waitFor(() =>
      expect(api.updateStockDestination).toHaveBeenCalledWith(DESTINATION.id, {
        name: 'Destino sintético renombrado',
      }),
    );
  });

  it('desactivar pide confirmación explicando que el historial se conserva', async () => {
    api.updateStockDestination.mockResolvedValue({
      destination: { ...DESTINATION, active: false },
    });
    renderStock('/stock/catalog');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: `Desactivar: ${DESTINATION.name}` }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/consumos históricos/)).toBeInTheDocument();
    expect(api.updateStockDestination).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    await waitFor(() =>
      expect(api.updateStockDestination).toHaveBeenCalledWith(DESTINATION.id, { active: false }),
    );
  });

  it('destino inexistente o inactivo: mensaje humano del backend', async () => {
    api.updateStockDestination.mockRejectedValue(
      new ApiError(404, 'Destino no encontrado.', 'STOCK_DESTINATION_NOT_FOUND'),
    );
    renderStock('/stock/catalog');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: `Reactivar: ${INACTIVE_DESTINATION.name}` }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reactivar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Destino no encontrado.');
  });
});
