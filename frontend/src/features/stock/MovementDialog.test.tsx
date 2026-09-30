import { act, fireEvent, render, screen, waitFor } from '../../test/render';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/httpClient';
import { OfflineError } from '../../api/transportErrors';
import { DESTINATION, makeItem } from '../../test/fixtures/stock';
import { MovementDialog } from './MovementDialog';

// El diálogo lee el alcance de caché de la sesión (Etapa 5P): usuario sintético.
const session = vi.hoisted(() => ({
  user: {
    id: 'u-test',
    role: 'EMPLOYEE' as 'EMPLOYEE' | 'ADMIN',
    status: 'ACTIVE',
    displayName: null as string | null,
    employee: null as { id: string; displayName: string; colorHex: string } | null,
  },
}));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ user: session.user }) }));

const api = vi.hoisted(() => ({
  fetchStockDestinations: vi.fn(),
  createStockMovement: vi.fn(),
}));
vi.mock('../../api/stockApi', () => api);
const participantsApi = vi.hoisted(() => ({ fetchParticipants: vi.fn() }));
vi.mock('../../api/participantsApi', () => participantsApi);

const item = makeItem();
/** Formato que acepta el backend para `Idempotency-Key`. */
const BACKEND_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function renderDialog(overrides: Partial<React.ComponentProps<typeof MovementDialog>> = {}) {
  const onSuccess = vi.fn();
  const onCancel = vi.fn();
  const result = render(
    <MovementDialog
      item={item}
      mode="movement"
      initialType="INCOME"
      role="EMPLOYEE"
      onCancel={onCancel}
      onSuccess={onSuccess}
      onSessionExpired={vi.fn()}
      {...overrides}
    />,
  );
  return { onSuccess, onCancel, ...result };
}

const submitButton = () =>
  screen.getByRole('button', { name: /registrar movimiento|reintentar|consultar estado/i });
const keysSent = () => api.createStockMovement.mock.calls.map((call) => call[2] as string);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  api.fetchStockDestinations.mockReset();
  api.createStockMovement.mockReset();
  api.fetchStockDestinations.mockResolvedValue({ destinations: [] });
  api.createStockMovement.mockResolvedValue({ movement: {}, item });
  participantsApi.fetchParticipants.mockReset();
  participantsApi.fetchParticipants.mockResolvedValue({ participants: [] });
  session.user = {
    ...session.user,
    id: 'u-test',
    role: 'EMPLOYEE',
    displayName: null,
    employee: null,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MovementDialog — decimal estricto y contrato del body', () => {
  it.each(['0', '0.00', '00', '01', '00.50', '-1', '1.234', '123456789', '1e2', 'NaN', 'Infinity'])(
    'rechaza %s sin llamar al POST',
    async (value) => {
      renderDialog();
      fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value } });
      await userEvent.setup().click(submitButton());
      expect(screen.getByRole('alert')).toHaveTextContent(/cantidad/i);
      expect(api.createStockMovement).not.toHaveBeenCalled();
    },
  );

  it('EMPLOYEE usa su identidad de sesión, puede elegir fecha/destino y no inyecta persona ni producto', async () => {
    const { onSuccess } = renderDialog();
    const date = screen.getByLabelText(/fecha/i);
    // El input nativo conserva el valor técnico ISO; solo la presentación es dd/mm/aaaa.
    expect((date as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByLabelText(/destino/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /quién/i })).not.toBeInTheDocument();
    await userEvent.setup().type(screen.getByLabelText('Cantidad'), '2.50');
    await userEvent.setup().click(submitButton());
    expect(api.createStockMovement).toHaveBeenCalledWith(
      item.id,
      { type: 'INCOME', quantity: '2.50', effectiveDate: (date as HTMLInputElement).value },
      expect.stringMatching(BACKEND_KEY_PATTERN),
    );
    expect(JSON.stringify(api.createStockMovement.mock.calls[0]?.[1])).not.toMatch(
      /employeeId|stockItemId|currentQuantity|area|active|OPENING_BALANCE|idempotency/i,
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it('la fecha aparece para ambos roles y ADMIN arranca eligiéndose a sí mismo', async () => {
    session.user = { ...session.user, role: 'ADMIN', displayName: 'Benja sintético' };
    const { unmount } = renderDialog({ role: 'ADMIN', mode: 'movement', initialType: 'INCOME' });
    expect(screen.getByLabelText(/fecha/i)).toBeInTheDocument();
    expect(await screen.findByRole('combobox', { name: /quién/i })).toHaveValue('ADMIN:u-test');
    expect(screen.getByRole('option', { name: '🔐 Benja sintético' })).toBeInTheDocument();
    unmount();
    session.user = { ...session.user, role: 'EMPLOYEE', displayName: null };
    renderDialog({ role: 'EMPLOYEE', mode: 'movement' });
    expect(screen.getByLabelText(/fecha/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /quién/i })).not.toBeInTheDocument();
  });
});

describe('MovementDialog — persona: empleados y administradores (ADMIN)', () => {
  // Sintéticos: Benja (ADMIN de la sesión, sin ficha), Viki (otra ADMIN sin ficha) y un empleado.
  const participants = [
    { kind: 'ADMIN', id: 'u-test', displayName: 'Benja sintético', colorHex: null },
    { kind: 'ADMIN', id: 'u-viki', displayName: 'Viki sintética', colorHex: null },
    { kind: 'EMPLOYEE', id: 'e-1', displayName: 'Persona sintética', colorHex: '#4a7c59' },
  ];

  beforeEach(() => {
    session.user = { ...session.user, role: 'ADMIN', displayName: 'Benja sintético' };
    participantsApi.fetchParticipants.mockResolvedValue({ participants });
  });

  it.each([
    ['otra administradora', 'ADMIN:u-viki', { participantUserId: 'u-viki' }],
    ['sí mismo', 'ADMIN:u-test', { participantUserId: 'u-test' }],
    ['un empleado', 'EMPLOYEE:e-1', { employeeId: 'e-1' }],
  ])('ADMIN elige %s: se envía solo esa identidad, nunca el autor', async (_label, value, sent) => {
    renderDialog({ role: 'ADMIN', mode: 'movement', initialType: 'CONSUMPTION' });
    const user = userEvent.setup();
    const select = await screen.findByRole('combobox', { name: /quién consumió/i });
    await screen.findByRole('option', { name: '🔐 Viki sintética' });
    // Cada persona una sola vez, administradores con 🔐.
    expect(
      Array.from((select as HTMLSelectElement).options).map((option) => option.textContent),
    ).toEqual(['🔐 Benja sintético', '🔐 Viki sintética', 'Persona sintética']);
    await user.selectOptions(select, value);
    await user.type(screen.getByLabelText('Cantidad'), '1');
    await user.click(submitButton());
    const body = api.createStockMovement.mock.calls[0]?.[1];
    expect(body).toMatchObject(sent);
    for (const field of ['employeeId', 'participantUserId'].filter((key) => !(key in sent))) {
      expect(body).not.toHaveProperty(field);
    }
    expect(JSON.stringify(body)).not.toMatch(/recordedBy|actor/i);
  });

  it('EMPLOYEE no ve el selector ni envía persona', async () => {
    session.user = {
      ...session.user,
      role: 'EMPLOYEE',
      employee: { id: 'e-1', displayName: 'Persona sintética', colorHex: '#4a7c59' },
    };
    renderDialog({ role: 'EMPLOYEE', mode: 'movement', initialType: 'CONSUMPTION' });
    expect(screen.queryByRole('combobox', { name: /quién/i })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Cantidad'), '1');
    await user.click(submitButton());
    const body = api.createStockMovement.mock.calls[0]?.[1];
    expect(body).not.toHaveProperty('employeeId');
    expect(body).not.toHaveProperty('participantUserId');
    expect(participantsApi.fetchParticipants).not.toHaveBeenCalled();
  });
});

describe('MovementDialog — destino opcional del consumo', () => {
  it('solo pide destinos ACTIVOS, ofrece «Sin destino» y envía destinationId solo si se elige', async () => {
    api.fetchStockDestinations.mockResolvedValue({ destinations: [DESTINATION] });
    renderDialog({ mode: 'movement', initialType: 'CONSUMPTION' });
    const select = await screen.findByLabelText('Destino');
    expect(api.fetchStockDestinations).toHaveBeenCalledWith('active');
    expect(select).toHaveValue('');
    expect(screen.getByRole('option', { name: /Sin destino específico/ })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: DESTINATION.name })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Cantidad'), '1');
    await user.click(submitButton());
    expect(api.createStockMovement.mock.calls[0]?.[1]).toMatchObject({
      type: 'CONSUMPTION',
      quantity: '1',
    });
  });

  it('con destino elegido lo envía en el consumo', async () => {
    api.fetchStockDestinations.mockResolvedValue({ destinations: [DESTINATION] });
    renderDialog({ mode: 'movement', initialType: 'CONSUMPTION' });
    const user = userEvent.setup();
    await screen.findByRole('option', { name: DESTINATION.name });
    await user.selectOptions(screen.getByLabelText('Destino'), DESTINATION.id);
    await user.type(screen.getByLabelText('Cantidad'), '1');
    await user.click(submitButton());
    expect(api.createStockMovement.mock.calls[0]?.[1]).toMatchObject({
      type: 'CONSUMPTION',
      quantity: '1',
      destinationId: DESTINATION.id,
    });
  });

  it('sin destinos (o si falla su carga) el consumo no se bloquea', async () => {
    renderDialog({ mode: 'movement', initialType: 'CONSUMPTION' });
    expect(await screen.findByText(/Todavía no hay destinos cargados/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Cantidad'), '1');
    await user.click(submitButton());
    expect(api.createStockMovement).toHaveBeenCalledTimes(1);
  });

  it('un ingreso también admite destino opcional', async () => {
    renderDialog({ mode: 'movement', initialType: 'INCOME' });
    expect(await screen.findByLabelText('Destino')).toBeInTheDocument();
    expect(api.fetchStockDestinations).toHaveBeenCalledWith('active');
  });
});

describe('MovementDialog — Idempotency-Key', () => {
  async function fillAndSubmit(quantity = '2') {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Cantidad'), quantity);
    await user.click(submitButton());
    return user;
  }

  it('clave criptográfica con el formato del backend, distinta en cada intención nueva', async () => {
    const randomSpy = vi.spyOn(Math, 'random');
    const first = renderDialog();
    await fillAndSubmit();
    first.unmount();
    const firstKey = keysSent()[0]!;
    expect(firstKey).toMatch(BACKEND_KEY_PATTERN);
    expect(firstKey).toMatch(/^[0-9a-f]{32}$/);
    expect(randomSpy).not.toHaveBeenCalled();

    // Otro diálogo (mismo producto, mismo cuerpo) = otra intención: otra clave.
    renderDialog();
    await fillAndSubmit();
    expect(keysSent()[1]).toMatch(BACKEND_KEY_PATTERN);
    expect(keysSent()[1]).not.toBe(firstKey);
  });

  it('doble clic síncrono: un solo POST', async () => {
    const pending = deferred<unknown>();
    api.createStockMovement.mockReturnValue(pending.promise);
    renderDialog();
    fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value: '2' } });
    act(() => {
      fireEvent.click(submitButton());
      fireEvent.click(submitButton());
    });
    expect(api.createStockMovement).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ movement: {}, item }));
  });

  it('falla de red → «Reintentar» reenvía la MISMA clave (no crea otra operación)', async () => {
    api.createStockMovement
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ movement: {}, item });
    const { onSuccess } = renderDialog();
    const user = await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se registrará dos veces/);
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(keysSent()).toHaveLength(2);
    expect(keysSent()[1]).toBe(keysSent()[0]);
  });

  it('sin Internet (Etapa 5R): avisa que no se envió, conserva la clave y el reintento manual no duplica', async () => {
    api.createStockMovement
      .mockRejectedValueOnce(new OfflineError())
      .mockResolvedValueOnce({ movement: {}, item });
    const { onSuccess } = renderDialog();
    const user = await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Sin conexión a Internet: no se guardó/,
    );
    expect(onSuccess).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(keysSent()).toHaveLength(2);
    expect(keysSent()[1]).toBe(keysSent()[0]);
  });

  it('un 5xx del servidor también conserva la clave', async () => {
    api.createStockMovement
      .mockRejectedValueOnce(new ApiError(503, 'No disponible.', 'SERVICE_UNAVAILABLE'))
      .mockResolvedValueOnce({ movement: {}, item });
    renderDialog();
    const user = await fillAndSubmit();
    await user.click(await screen.findByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(keysSent()).toHaveLength(2));
    expect(keysSent()[1]).toBe(keysSent()[0]);
  });

  it('cambiar un campo después de un fallo es una intención nueva: otra clave', async () => {
    api.createStockMovement.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderDialog();
    const user = await fillAndSubmit('2');
    await screen.findByRole('alert');
    await user.type(screen.getByLabelText('Cantidad'), '5');
    await user.click(submitButton());
    await waitFor(() => expect(keysSent()).toHaveLength(2));
    expect(api.createStockMovement.mock.calls[1]?.[1]).toMatchObject({
      type: 'INCOME',
      quantity: '25',
    });
    expect(keysSent()[1]).not.toBe(keysSent()[0]);
  });

  it('replay 201 (mismo cuerpo almacenado) es un éxito idéntico a la creación', async () => {
    const stored = { movement: { id: 'm-replay' }, item };
    api.createStockMovement.mockResolvedValue(stored);
    const { onSuccess } = renderDialog();
    await fillAndSubmit();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(stored, 'income'));
  });

  it('IDEMPOTENCY_RECORD_PENDING: bloquea el formulario y «Consultar estado» usa la misma clave', async () => {
    api.createStockMovement
      .mockRejectedValueOnce(new ApiError(409, 'Pendiente.', 'IDEMPOTENCY_RECORD_PENDING'))
      .mockResolvedValueOnce({ movement: {}, item });
    const { onSuccess } = renderDialog();
    const user = await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent(/todavía se está resolviendo/);
    expect(screen.queryByText(/IDEMPOTENCY_/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Cantidad')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Actualizar inventario' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Consultar estado' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(keysSent()[1]).toBe(keysSent()[0]);
  });

  it('IDEMPOTENCY_KEY_CONFLICT: explica el cambio y el próximo envío es otra intención', async () => {
    api.createStockMovement
      .mockRejectedValueOnce(new ApiError(409, 'Conflicto.', 'IDEMPOTENCY_KEY_CONFLICT'))
      .mockResolvedValueOnce({ movement: {}, item });
    renderDialog();
    const user = await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent(/El formulario cambió/);
    await user.click(screen.getByRole('button', { name: /registrar movimiento/i }));
    await waitFor(() => expect(keysSent()).toHaveLength(2));
    expect(keysSent()[1]).not.toBe(keysSent()[0]);
  });

  it('un rechazo de negocio (409 de saldo) libera la clave: el reintento es otra intención', async () => {
    api.createStockMovement
      .mockRejectedValueOnce(new ApiError(409, 'Supera el stock.', 'STOCK_INSUFFICIENT_QUANTITY'))
      .mockResolvedValueOnce({ movement: {}, item });
    renderDialog({ mode: 'movement', initialType: 'CONSUMPTION' });
    const user = await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent(/supera el stock/i);
    await user.click(submitButton());
    await waitFor(() => expect(keysSent()).toHaveLength(2));
    expect(keysSent()[1]).not.toBe(keysSent()[0]);
  });

  it('la clave nunca se persiste ni se muestra', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    api.createStockMovement.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderDialog();
    await fillAndSubmit();
    await screen.findByRole('alert');
    expect(setItem).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(keysSent()[0]);
  });
});
