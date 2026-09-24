import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/httpClient';
import {
  CATEGORY_A,
  DESTINATION,
  categoriesResponse,
  itemsList,
  makeCritItem,
  makeItem,
  makeLowItem,
  makeMovement,
  movementsList,
} from '../../test/fixtures/stock';

const api = vi.hoisted(() => ({
  fetchStockItems: vi.fn(),
  fetchStockCategories: vi.fn(),
  fetchStockDestinations: vi.fn(),
  fetchStockItem: vi.fn(),
  fetchStockItemMovements: vi.fn(),
  createStockMovement: vi.fn(),
  createStockCategory: vi.fn(),
  createStockItem: vi.fn(),
  updateStockCategory: vi.fn(),
  updateStockItem: vi.fn(),
  setStockItemActive: vi.fn(),
}));
const { useAuthMock, logoutMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  logoutMock: vi.fn(),
}));
vi.mock('../../api/stockApi', () => api);
vi.mock('../../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { StockScreen } from './StockScreen';

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
  });
}

function asAdmin() {
  useAuthMock.mockReturnValue({
    user: { id: 'u-a', role: 'ADMIN', status: 'ACTIVE', employee: null },
    logout: logoutMock,
  });
}

async function renderInventory(items = [OK_ITEM, LOW_ITEM, CRIT_ITEM]) {
  api.fetchStockItems.mockResolvedValue(itemsList(items));
  api.fetchStockCategories.mockResolvedValue(categoriesResponse());
  render(<StockScreen />);
  await screen.findByRole('heading', { level: 1, name: 'Stock' });
  await screen.findByText(OK_ITEM.name);
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  logoutMock.mockReset();
  asEmployee();
});

describe('StockScreen — carga y estados', () => {
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
    const { unmount } = render(<StockScreen />);
    expect(screen.getByRole('status')).toHaveTextContent(/cargando inventario/i);
    unmount();

    api.fetchStockItems.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    render(<StockScreen />);
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
    render(<StockScreen />);
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
  });

  it('estado vacío real cuando el backend no devuelve productos', async () => {
    api.fetchStockItems.mockResolvedValue(itemsList([]));
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    render(<StockScreen />);
    expect(await screen.findByText(/no hay productos con estos filtros/i)).toBeInTheDocument();
  });
});

describe('StockScreen — filtros server-side', () => {
  it('cambiar de área reconsulta al backend con area=GARDEN', async () => {
    await renderInventory();
    const user = userEvent.setup();
    api.fetchStockItems.mockClear();

    await user.click(
      within(screen.getByRole('group', { name: /filtrar por área/i })).getByRole('button', {
        name: /jardín/i,
      }),
    );

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
    expect(screen.queryByRole('button', { name: /catálogo/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /entrada/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /consumo/i }).length).toBeGreaterThan(0);
  });

  it('ADMIN: ve filtro de estado, ajuste y la pestaña Catálogo', async () => {
    asAdmin();
    await renderInventory();
    expect(screen.getByLabelText('Estado')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /ajuste/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /catálogo/i })).toBeInTheDocument();
  });
});

describe('StockScreen — tarjetas y reglas de estado', () => {
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
    render(<StockScreen />);
    await screen.findByText('Producto sintético sin mínimo');
    expect(document.querySelectorAll('progress.stock-item__bar')).toHaveLength(0);
    expect(screen.getByText('Normal')).toBeInTheDocument();
  });
});

describe('StockScreen — paginación', () => {
  it('«Cargar más» pide la página siguiente y acumula', async () => {
    api.fetchStockItems.mockResolvedValueOnce({
      ...itemsList([OK_ITEM]),
      page: 1,
      totalPages: 2,
      total: 2,
    });
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    render(<StockScreen />);
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
    render(<StockScreen />);
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
    await userEvent.setup().click(
      within(screen.getByRole('group', { name: /filtrar por área/i })).getByRole('button', {
        name: /jardín/i,
      }),
    );
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
    render(<StockScreen />);
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

describe('StockScreen — diálogos de movimiento', () => {
  it.each([
    ['entrada', 'INCOME'],
    ['consumo', 'CONSUMPTION'],
  ] as const)('EMPLOYEE + %s: omite effectiveDate', async (buttonName, type) => {
    api.createStockMovement.mockResolvedValue({ movement: {}, item: {} });
    api.fetchStockDestinations.mockResolvedValue({ destinations: [] });
    await renderInventory();

    await userEvent.setup().click(
      within(screen.getByText(OK_ITEM.name).closest('li') as HTMLElement).getByRole('button', {
        name: new RegExp(buttonName, 'i'),
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/fecha/i)).not.toBeInTheDocument();
    await userEvent.setup().type(within(dialog).getByLabelText('Cantidad'), '2');
    await userEvent
      .setup()
      .click(within(dialog).getByRole('button', { name: /registrar movimiento/i }));

    await waitFor(() => expect(api.createStockMovement).toHaveBeenCalledTimes(1));
    expect(api.createStockMovement.mock.calls[0]?.[1]).toEqual({ type, quantity: '2' });
  });

  it('EMPLEADO: el diálogo de consumo no ofrece fecha y no envía effectiveDate', async () => {
    api.createStockMovement.mockResolvedValue({ movement: {}, item: {} });
    api.fetchStockDestinations.mockResolvedValue({ destinations: [DESTINATION] });
    await renderInventory();

    await userEvent.setup().click(
      within(screen.getByText(OK_ITEM.name).closest('li') as HTMLElement).getByRole('button', {
        name: /consumo/i,
      }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/fecha/i)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/zona horaria del establecimiento/i)).toBeInTheDocument();

    await userEvent.setup().type(within(dialog).getByLabelText('Cantidad'), '2');
    await userEvent
      .setup()
      .click(within(dialog).getByRole('button', { name: /registrar movimiento/i }));

    await waitFor(() => expect(api.createStockMovement).toHaveBeenCalledTimes(1));
    const body = api.createStockMovement.mock.calls[0]?.[1];
    expect(body).not.toHaveProperty('effectiveDate');
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
    expect(body).not.toHaveProperty('employeeId');
  });

  it.each([
    ['entrada', 'INCOME'],
    ['consumo', 'CONSUMPTION'],
  ] as const)('ADMIN + %s: permite enviar una fecha pasada explícita', async (buttonName, type) => {
    asAdmin();
    api.createStockMovement.mockResolvedValue({ movement: {}, item: {} });
    api.fetchStockDestinations.mockResolvedValue({ destinations: [] });
    await renderInventory();

    await userEvent.setup().click(
      within(screen.getByText(OK_ITEM.name).closest('li') as HTMLElement).getByRole('button', {
        name: new RegExp(buttonName, 'i'),
      }),
    );
    const dialog = await screen.findByRole('dialog');
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
    });
  });

  it('ADMIN: rechaza visualmente una fecha futura y no llama al backend', async () => {
    asAdmin();
    await renderInventory();
    await userEvent.setup().click(
      within(screen.getByText(OK_ITEM.name).closest('li') as HTMLElement).getByRole('button', {
        name: /entrada/i,
      }),
    );
    const dialog = await screen.findByRole('dialog');
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
    await userEvent.setup().click(
      within(screen.getByText(OK_ITEM.name).closest('li') as HTMLElement).getByRole('button', {
        name: /consumo/i,
      }),
    );
    const dialog = await screen.findByRole('dialog');
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
    await userEvent.setup().click(
      within(screen.getByText(OK_ITEM.name).closest('li') as HTMLElement).getByRole('button', {
        name: /entrada/i,
      }),
    );
    const dialog = await screen.findByRole('dialog');
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
    await userEvent.setup().click(
      within(screen.getByText(OK_ITEM.name).closest('li') as HTMLElement).getByRole('button', {
        name: /entrada/i,
      }),
    );
    const dialog = await screen.findByRole('dialog');
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

    await userEvent.setup().click(
      within(screen.getByText(OK_ITEM.name).closest('li') as HTMLElement).getByRole('button', {
        name: /entrada/i,
      }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.setup().type(within(dialog).getByLabelText('Cantidad'), '4');
    await userEvent
      .setup()
      .click(within(dialog).getByRole('button', { name: /registrar movimiento/i }));

    expect(await screen.findByText('Ingreso registrado.')).toBeInTheDocument();
    await waitFor(() => expect(api.fetchStockItems).toHaveBeenCalledTimes(2));
  });
});

describe('StockScreen — detalle e historial', () => {
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
    expect(within(dialog).getAllByText(/primer movimiento/i)).toHaveLength(1);
    expect(within(dialog).getByText(/segundo movimiento/i)).toBeInTheDocument();
  });
});

describe('StockScreen — catálogo ADMIN', () => {
  it('pestaña Catálogo carga categorías con status=all y productos', async () => {
    asAdmin();
    api.fetchStockItems.mockResolvedValue(itemsList([OK_ITEM]));
    api.fetchStockCategories.mockResolvedValue(categoriesResponse());
    render(<StockScreen />);
    await screen.findByText(OK_ITEM.name);

    await userEvent.setup().click(screen.getByRole('button', { name: /catálogo/i }));

    await waitFor(() =>
      expect(api.fetchStockItems).toHaveBeenCalledWith(expect.objectContaining({ status: 'all' })),
    );
    expect(screen.getByRole('button', { name: /nueva categoría/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /nuevo producto/i })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Categorías de stock' })).toHaveTextContent(
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
    render(<StockScreen />);
    await screen.findByText(OK_ITEM.name);
    await userEvent.setup().click(screen.getByRole('button', { name: /catálogo/i }));

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
