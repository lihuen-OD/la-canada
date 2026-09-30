import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/httpClient';
import { render, screen, waitFor, within } from '../../test/render';
import {
  TYPE_CAT,
  TYPE_CUSTOM,
  TYPE_DOG,
  detailResponse,
  dueResponse,
  listResponse,
  makeDueItem,
  makePet,
  makeRecord,
  recordsResponse,
  typesResponse,
} from '../../test/fixtures/pets';

const api = vi.hoisted(() => ({
  fetchPetTypes: vi.fn(),
  fetchPets: vi.fn(),
  fetchPet: vi.fn(),
  fetchPetRecords: vi.fn(),
  fetchPetDue: vi.fn(),
  updatePetRecordNextDue: vi.fn(),
  fetchPetPhoto: vi.fn(),
  createPetRecord: vi.fn(),
  createPet: vi.fn(),
  updatePet: vi.fn(),
  voidPetRecord: vi.fn(),
  uploadPetPhoto: vi.fn(),
  removePetPhoto: vi.fn(),
  createPetType: vi.fn(),
  setPetTypeActive: vi.fn(),
  deletePetType: vi.fn(),
  setPetActive: vi.fn(),
  deletePet: vi.fn(),
}));
const { useAuthMock, logoutMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  logoutMock: vi.fn(),
}));
vi.mock('../../api/petsApi', () => api);
vi.mock('../../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { PetsModule } from './PetsModule';

function asEmployee() {
  useAuthMock.mockReturnValue({
    user: {
      id: 'u-e',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      employee: { id: 'e1', displayName: 'Persona sintética', colorHex: null },
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

function renderPets(route = '/pets') {
  return render(
    <Routes>
      <Route path="/pets/*" element={<PetsModule />} />
    </Routes>,
    { route },
  );
}

const PET = makePet();

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  logoutMock.mockReset();
  api.fetchPetTypes.mockResolvedValue(typesResponse());
  api.fetchPets.mockResolvedValue(listResponse());
  api.fetchPet.mockResolvedValue(detailResponse());
  api.fetchPetRecords.mockResolvedValue(recordsResponse());
  api.fetchPetDue.mockResolvedValue(dueResponse());
  asEmployee();
});

describe('🐾 Mascotas — listado', () => {
  it('título, chips "Todas" + tipos con mascotas, tarjeta con tipo · raza · edad, peso y cumpleaños', async () => {
    renderPets();
    expect(await screen.findByRole('heading', { level: 1, name: 'Mascotas' })).toHaveTextContent(
      '🐾',
    );
    const chips = within(screen.getByRole('group', { name: 'Filtrar por tipo' }));
    await chips.findByRole('button', { name: /Perro/ });
    expect(chips.getAllByRole('button').map((chip) => chip.textContent)).toEqual([
      'Todas',
      '🐕Perro',
    ]);
    const card = await screen.findByRole('link', { name: /Mascota sintética/ });
    expect(card).toHaveAttribute('href', `/pets/${PET.id}`);
    expect(card).toHaveTextContent('🐕 Perro · Raza sintética · 2 años');
    expect(card).toHaveTextContent('⚖️ 12,5 kg');
    expect(card).toHaveTextContent('🎂 Cumple en 15 días');
    expect(api.fetchPets).toHaveBeenCalledWith({
      typeId: undefined,
      status: 'active',
      page: 1,
      pageSize: 24,
    });
  });

  it('EMPLOYEE no ve "+ Tipo" ni "+ Mascota"; filtrar por tipo pide ese listado', async () => {
    const user = userEvent.setup();
    renderPets();
    await screen.findByRole('link', { name: /Mascota sintética/ });
    expect(screen.queryByRole('button', { name: '+ Tipo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Mascota' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Perro/ }));
    await waitFor(() =>
      expect(api.fetchPets).toHaveBeenLastCalledWith({
        typeId: TYPE_DOG.id,
        status: 'active',
        page: 1,
        pageSize: 24,
      }),
    );
  });

  it('estado vacío real del prototipo', async () => {
    api.fetchPets.mockResolvedValue(listResponse([]));
    renderPets();
    expect(await screen.findByText('Sin mascotas registradas')).toBeInTheDocument();
  });

  it('ADMIN: "+ Mascota" crea la ficha y abre su detalle; la foto avisa si falta el almacenamiento', async () => {
    const user = userEvent.setup();
    asAdmin();
    api.createPet.mockResolvedValue(detailResponse(makePet({ name: 'Nueva sintética' })));
    renderPets();
    await user.click(await screen.findByRole('button', { name: '+ Mascota' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/falta configurar el almacenamiento/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Elegir foto')).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ingresá un nombre.');
    await user.type(within(dialog).getByLabelText('Nombre'), '  Nueva   sintética ');
    await user.selectOptions(within(dialog).getByLabelText('Tipo'), TYPE_CAT.id);
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(api.createPet).toHaveBeenCalledWith({
        name: 'Nueva sintética',
        animalTypeId: TYPE_CAT.id,
        breed: null,
        birthDate: null,
      }),
    );
    expect(await screen.findByRole('heading', { level: 1, name: PET.name })).toBeInTheDocument();
  });

  it('ADMIN: "Gestionar tipos" — precargados sin acciones, símbolo sugiere nombre, Desactivar ≠ Eliminar', async () => {
    const user = userEvent.setup();
    asAdmin();
    api.createPetType.mockResolvedValue({ type: { ...TYPE_CUSTOM, name: 'Ternero' } });
    api.setPetTypeActive.mockResolvedValue({});
    renderPets();
    await user.click(await screen.findByRole('button', { name: '+ Tipo' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).queryByRole('button', { name: 'Eliminar el tipo Perro' }),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Ternero/Buey' }));
    expect(within(dialog).getByLabelText('Nombre')).toHaveValue('Ternero');
    await user.click(within(dialog).getByRole('button', { name: '+ Agregar tipo' }));
    await waitFor(() =>
      expect(api.createPetType).toHaveBeenCalledWith({ name: 'Ternero', icon: '🐂' }),
    );

    expect(
      within(dialog).queryByRole('button', { name: 'Desactivar el tipo Perro' }),
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: 'Desactivar el tipo Tipo sintético' }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: 'Desactivar el tipo «Tipo sintético»',
    });
    expect(confirm).toHaveTextContent('Las mascotas de este tipo no se borran');
    await user.click(within(confirm).getByRole('button', { name: 'Desactivar' }));
    await waitFor(() => expect(api.setPetTypeActive).toHaveBeenCalledWith(TYPE_CUSTOM.id, false));
    expect(api.deletePetType).not.toHaveBeenCalled();
  });

  it('ADMIN: eliminar un tipo agregado — confirmación irreversible, 409 PET_TYPE_IN_USE visible, doble clic = 1 request', async () => {
    const user = userEvent.setup();
    asAdmin();
    let reject: (error: unknown) => void = () => undefined;
    api.deletePetType.mockImplementation(() => new Promise((_resolve, fail) => (reject = fail)));
    renderPets();
    await user.click(await screen.findByRole('button', { name: '+ Tipo' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: 'Eliminar el tipo Tipo sintético' }),
    );
    const confirm = await screen.findByRole('dialog', { name: 'Eliminar «Tipo sintético»' });
    expect(confirm).toHaveTextContent('No se puede deshacer');
    expect(confirm).toHaveTextContent('«Desactivar»');
    const button = within(confirm).getByRole('button', { name: 'Eliminar definitivamente' });
    await user.dblClick(button);
    expect(api.deletePetType).toHaveBeenCalledTimes(1);
    reject(
      new ApiError(
        409,
        'Hay mascotas de este tipo y no se puede eliminar. Desactivalo para no ofrecerlo en mascotas nuevas.',
        'PET_TYPE_IN_USE',
      ),
    );
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(/Desactivalo/);
    expect(api.setPetTypeActive).not.toHaveBeenCalled();
  });

  it('ADMIN filtra por estado (Activas / Inactivas / Todas); EMPLOYEE no ve el filtro', async () => {
    const user = userEvent.setup();
    asAdmin();
    renderPets();
    const group = await screen.findByRole('group', { name: 'Filtrar por estado' });
    await user.click(within(group).getByRole('button', { name: 'Inactivas' }));
    await waitFor(() =>
      expect(api.fetchPets).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'inactive', page: 1 }),
      ),
    );
  });
});

describe('🐾 Mascotas — ficha: desactivar y eliminar (ADMIN)', () => {
  it('EMPLOYEE no ve Desactivar ni Eliminar', async () => {
    renderPets(`/pets/${PET.id}`);
    await screen.findByRole('heading', { level: 1, name: PET.name });
    expect(screen.queryByRole('group', { name: /Acciones sobre/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
  });

  it('Desactivar pide confirmación (conserva historia) y usa el endpoint de estado, nunca DELETE', async () => {
    const user = userEvent.setup();
    asAdmin();
    api.setPetActive.mockResolvedValue(detailResponse(makePet({ active: false })));
    renderPets(`/pets/${PET.id}`);
    const actions = await screen.findByRole('group', { name: `Acciones sobre ${PET.name}` });
    await user.click(within(actions).getByRole('button', { name: 'Desactivar' }));
    const confirm = await screen.findByRole('dialog', { name: `Desactivar «${PET.name}»` });
    expect(confirm).toHaveTextContent('No se borra nada');
    await user.click(within(confirm).getByRole('button', { name: 'Desactivar' }));
    await waitFor(() => expect(api.setPetActive).toHaveBeenCalledWith(PET.id, false));
    expect(api.deletePet).not.toHaveBeenCalled();
    await waitFor(() => expect(api.fetchPet).toHaveBeenCalledTimes(2));
  });

  it('una mascota inactiva muestra «Inactiva», ofrece Reactivar y no admite registros nuevos', async () => {
    asAdmin();
    api.fetchPet.mockResolvedValue(detailResponse(makePet({ active: false })));
    renderPets(`/pets/${PET.id}`);
    const actions = await screen.findByRole('group', { name: `Acciones sobre ${PET.name}` });
    expect(within(actions).getByRole('button', { name: 'Reactivar' })).toBeInTheDocument();
    expect(screen.getByText('Inactiva')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Nuevo registro' })).not.toBeInTheDocument();
    expect(screen.getByText(/no admite registros nuevos/)).toBeInTheDocument();
  });

  it('Eliminar: 409 ANIMAL_IN_USE se muestra y no navega; sin historia, 204 → vuelve al listado', async () => {
    const user = userEvent.setup();
    asAdmin();
    api.deletePet.mockRejectedValueOnce(
      new ApiError(
        409,
        'La mascota ya tiene historia clínica o fotos y no se puede eliminar. Desactivala para conservar su historia.',
        'ANIMAL_IN_USE',
      ),
    );
    renderPets(`/pets/${PET.id}`);
    const actions = await screen.findByRole('group', { name: `Acciones sobre ${PET.name}` });
    await user.click(within(actions).getByRole('button', { name: 'Eliminar' }));
    const confirm = await screen.findByRole('dialog', { name: `Eliminar «${PET.name}»` });
    await user.click(within(confirm).getByRole('button', { name: 'Eliminar definitivamente' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent('Desactivala');
    expect(screen.getByRole('heading', { level: 1, name: PET.name })).toBeInTheDocument();

    api.deletePet.mockResolvedValueOnce(undefined);
    await user.click(within(confirm).getByRole('button', { name: 'Eliminar definitivamente' }));
    expect(await screen.findByRole('heading', { level: 1, name: /Mascotas/ })).toBeInTheDocument();
    expect(api.deletePet).toHaveBeenCalledTimes(2);
  });
});

describe('🐾 Mascotas — ficha', () => {
  it('perfil, "← Volver", KPIs del prototipo e historial con etiquetas y persona', async () => {
    renderPets(`/pets/${PET.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: PET.name })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Volver/ })).toHaveAttribute('href', '/pets');
    expect(screen.getByText('🐕 Perro · Raza sintética')).toBeInTheDocument();
    const kpis = within(screen.getByRole('list', { name: 'Indicadores de la mascota' }));
    expect(kpis.getByText('Vacunas registradas').previousSibling).toHaveTextContent('2');
    expect(kpis.getByText('Último peso').previousSibling).toHaveTextContent('12,5 kg');
    expect(kpis.getByText('Desparasitaciones').previousSibling).toHaveTextContent('1');
    expect(kpis.getByText('Próximo cumple').previousSibling).toHaveTextContent('15 días');
    const history = within(await screen.findByRole('list', { name: 'Registros clínicos' }));
    expect(history.getByText('💉 Vacuna')).toBeInTheDocument();
    expect(history.getByText('20/09/2026')).toBeInTheDocument();
    expect(history.getByText('Persona sintética')).toBeInTheDocument();
    // EMPLOYEE: sin ✏️ ni ✕.
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eliminar registro/ })).not.toBeInTheDocument();
  });

  it('historial: sin persona, cada registro muestra al administrador que lo cargó', async () => {
    api.fetchPetRecords.mockResolvedValue(
      recordsResponse([
        makeRecord({
          id: 'r-a',
          description: 'Cargado por A',
          employee: null,
          recordedBy: { displayName: 'Admin sintética Uno' },
        }),
        makeRecord({
          id: 'r-b',
          description: 'Cargado por B',
          employee: null,
          recordedBy: { displayName: 'Admin sintético Dos' },
        }),
        makeRecord({ id: 'r-e', description: 'Cargado por la persona' }),
        makeRecord({ id: 'r-n', description: 'Sin evidencia', employee: null, recordedBy: null }),
      ]),
    );
    renderPets(`/pets/${PET.id}`);
    const history = await screen.findByRole('list', { name: 'Registros clínicos' });
    const itemOf = (text: string) => within(history).getByText(text).closest('li') as HTMLElement;
    expect(itemOf('Cargado por A')).toHaveTextContent('Admin sintética Uno');
    expect(itemOf('Cargado por B')).toHaveTextContent('Admin sintético Dos');
    expect(itemOf('Cargado por la persona')).toHaveTextContent('Persona sintética');
    expect(itemOf('Sin evidencia').querySelector('.pet-history__person')).toBeNull();
  });

  it('"Guardar registro": ⚖️ Peso exige kg (acepta coma), fecha de negocio, Idempotency-Key e invalidación', async () => {
    const user = userEvent.setup();
    api.createPetRecord.mockResolvedValue({
      record: makeRecord({ type: 'WEIGHT', weightKg: '13.2' }),
    });
    renderPets(`/pets/${PET.id}`);
    const form = await screen.findByRole('form', { name: 'Nuevo registro' });
    expect(within(form).getByLabelText('Fecha')).toHaveValue('2026-09-25');
    await user.selectOptions(within(form).getByLabelText('Tipo'), 'WEIGHT');
    await user.click(within(form).getByRole('button', { name: 'Guardar registro' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Ingresá el peso.');
    await user.type(within(form).getByLabelText('Peso (kg)'), '13,2');
    await user.click(within(form).getByRole('button', { name: 'Guardar registro' }));
    await waitFor(() => expect(api.createPetRecord).toHaveBeenCalledTimes(1));
    const [petId, body, key] = api.createPetRecord.mock.calls[0] ?? [];
    expect(petId).toBe(PET.id);
    expect(body).toEqual({ type: 'WEIGHT', recordDate: '2026-09-25', weightKg: '13.2' });
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(await within(form).findByText(/Registro guardado/)).toBeInTheDocument();
    await waitFor(() => expect(api.fetchPet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.fetchPetRecords).toHaveBeenCalledTimes(2));
  });

  it('filtrar el historial pide ese tipo; vacío = "Sin registros en esta categoría"', async () => {
    const user = userEvent.setup();
    renderPets(`/pets/${PET.id}`);
    await screen.findByRole('list', { name: 'Registros clínicos' });
    api.fetchPetRecords.mockResolvedValue(recordsResponse([]));
    await user.click(screen.getByRole('button', { name: '🩺 Chequeos' }));
    expect(await screen.findByText('Sin registros en esta categoría')).toBeInTheDocument();
    expect(api.fetchPetRecords).toHaveBeenLastCalledWith(PET.id, {
      type: 'CHECKUP',
      page: 1,
      pageSize: 20,
    });
  });

  it('ADMIN: "✕" confirma "¿Eliminar este registro?" y anula; "✏️" abre la edición', async () => {
    const user = userEvent.setup();
    asAdmin();
    api.voidPetRecord.mockResolvedValue({});
    renderPets(`/pets/${PET.id}`);
    await user.click(
      await screen.findByRole('button', { name: 'Eliminar registro 💉 Vacuna del 20/09/2026' }),
    );
    const confirm = await screen.findByRole('dialog', { name: '¿Eliminar este registro?' });
    await user.click(within(confirm).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(api.voidPetRecord).toHaveBeenCalledWith(PET.id, makeRecord().id));

    await user.click(screen.getByRole('button', { name: `Editar ${PET.name}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar mascota' });
    expect(within(dialog).getByLabelText('Nombre')).toHaveValue(PET.name);
  });

  it('mascota inexistente → mensaje claro (sin datos inventados)', async () => {
    api.fetchPet.mockRejectedValue(new ApiError(404, 'La mascota no existe.', 'PET_NOT_FOUND'));
    renderPets(`/pets/${PET.id}`);
    expect(
      await screen.findByRole('heading', { name: 'La mascota no existe' }),
    ).toBeInTheDocument();
  });

  it('con foto, la muestra a través del proxy autenticado (nunca una URL del bucket)', async () => {
    const createObjectURL = vi.fn(() => 'blob:sintetico');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    api.fetchPet.mockResolvedValue(detailResponse(makePet({ photo: { id: 'file-1' } })));
    api.fetchPetPhoto.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
    renderPets(`/pets/${PET.id}`);
    const image = await screen.findByRole('img', { name: `Foto de ${PET.name}` });
    expect(image).toHaveAttribute('src', 'blob:sintetico');
    expect(api.fetchPetPhoto).toHaveBeenCalledWith('file-1');
    vi.unstubAllGlobals();
  });
});

describe('🐾 Mascotas — próximas aplicaciones o controles', () => {
  // Sintéticos: dos vacunas distintas programadas para la misma mascota.
  const RABIES = makeDueItem({
    record: {
      id: '00000000-0000-4000-8000-0000000d0a11',
      type: 'VACCINE',
      recordDate: '2025-09-20',
      description: 'Antirrábica sintética',
    },
    nextDue: { date: '2026-09-22', status: 'OVERDUE', daysUntil: -3, fulfilledBy: null },
  });
  const SEXTUPLE = makeDueItem({
    record: {
      id: '00000000-0000-4000-8000-0000000d0a12',
      type: 'VACCINE',
      recordDate: '2026-01-10',
      description: 'Séxtuple sintética',
    },
    nextDue: { date: '2026-10-07', status: 'UPCOMING', daysUntil: 12, fulfilledBy: null },
  });
  const CHECKUP_TODAY = makeDueItem({
    record: {
      id: '00000000-0000-4000-8000-0000000d0a13',
      type: 'CHECKUP',
      recordDate: '2026-03-25',
      description: null,
    },
    nextDue: { date: '2026-09-25', status: 'DUE_TODAY', daysUntil: 0, fulfilledBy: null },
  });

  it('«Nuevo registro»: la próxima fecha es opcional, posterior a la atención y no aparece para Peso', async () => {
    const user = userEvent.setup();
    api.createPetRecord.mockResolvedValue({ record: makeRecord() });
    renderPets(`/pets/${PET.id}`);
    const form = await screen.findByRole('form', { name: 'Nuevo registro' });
    const nextDue = within(form).getByLabelText('Fecha de próxima aplicación o control');
    expect(nextDue).toHaveAttribute('min', '2026-09-26');
    await user.type(nextDue, '2026-09-25');
    await user.click(within(form).getByRole('button', { name: 'Guardar registro' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      /posterior a la de la atención/,
    );
    expect(api.createPetRecord).not.toHaveBeenCalled();
    await user.clear(nextDue);
    await user.type(nextDue, '2027-09-25');
    await user.click(within(form).getByRole('button', { name: 'Guardar registro' }));
    await waitFor(() => expect(api.createPetRecord).toHaveBeenCalledTimes(1));
    expect(api.createPetRecord.mock.calls[0]?.[1]).toEqual({
      type: 'VACCINE',
      recordDate: '2026-09-25',
      nextDueDate: '2027-09-25',
    });
    await user.selectOptions(within(form).getByLabelText('Tipo'), 'WEIGHT');
    expect(
      within(form).queryByLabelText('Fecha de próxima aplicación o control'),
    ).not.toBeInTheDocument();
  });

  it('«Próximas atenciones»: tipo, descripción, fechas, estado y tiempo restante o transcurrido', async () => {
    api.fetchPetDue.mockResolvedValue(dueResponse([RABIES, CHECKUP_TODAY, SEXTUPLE]));
    renderPets(`/pets/${PET.id}`);
    const list = await screen.findByRole('list', { name: 'Próximas atenciones' });
    expect(api.fetchPetDue).toHaveBeenCalledWith(expect.objectContaining({ petId: PET.id }));
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Antirrábica sintética');
    expect(rows[0]).toHaveTextContent('Atención: 20/09/2025');
    expect(rows[0]).toHaveTextContent('Programada: 22/09/2026');
    expect(rows[0]).toHaveTextContent('Vencida');
    expect(rows[0]).toHaveTextContent('Hace 3 días');
    expect(rows[1]).toHaveTextContent('Vence hoy');
    expect(within(rows[1]!).getByRole('button', { name: /Registrar control/ })).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('En 12 días');
    expect(
      within(rows[2]!).getByRole('button', { name: /Registrar aplicación/ }),
    ).toBeInTheDocument();
    // EMPLOYEE no corrige fechas.
    expect(within(list).queryByRole('button', { name: /Corregir/ })).not.toBeInTheDocument();
  });

  it('«Registrar aplicación» cumple SOLO el pendiente elegido: tipo fijo, fecha real y próxima fecha', async () => {
    const user = userEvent.setup();
    api.fetchPetDue.mockResolvedValue(dueResponse([RABIES, SEXTUPLE]));
    api.createPetRecord.mockResolvedValue({ record: makeRecord() });
    renderPets(`/pets/${PET.id}`);
    const list = await screen.findByRole('list', { name: 'Próximas atenciones' });
    const sextupleRow = within(list).getByText('Séxtuple sintética').closest('li') as HTMLElement;
    await user.click(within(sextupleRow).getByRole('button', { name: /Registrar aplicación/ }));
    const form = await screen.findByRole('form', { name: 'Nuevo registro' });
    expect(
      screen.getByText(/Cumple: 💉 Vacuna «Séxtuple sintética», programada para el 07\/10\/2026/),
    ).toBeInTheDocument();
    expect(within(form).getByLabelText('Tipo')).toBeDisabled();
    await user.type(
      within(form).getByLabelText('Fecha de próxima aplicación o control'),
      '2027-09-25',
    );
    await user.dblClick(within(form).getByRole('button', { name: 'Registrar aplicación' }));
    await waitFor(() => expect(api.createPetRecord).toHaveBeenCalledTimes(1));
    expect(api.createPetRecord.mock.calls[0]?.[1]).toEqual({
      type: 'VACCINE',
      recordDate: '2026-09-25',
      description: 'Séxtuple sintética',
      nextDueDate: '2027-09-25',
      fulfillsRecordId: SEXTUPLE.record.id,
    });
    // Invalida ficha, historial y pendientes.
    await waitFor(() => expect(api.fetchPetDue.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText(/la atención programada quedó cumplida/)).toBeInTheDocument();
  });

  it('desde 📅 Vencimientos (?cumplir=) la ficha abre el formulario con ese pendiente', async () => {
    api.fetchPetDue.mockResolvedValue(dueResponse([RABIES, SEXTUPLE]));
    renderPets(`/pets/${PET.id}?cumplir=${RABIES.record.id}`);
    expect(
      await screen.findByText(/Cumple: 💉 Vacuna «Antirrábica sintética»/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar aplicación' })).toBeInTheDocument();
  });

  it('una mascota inactiva muestra sus pendientes sin «Registrar aplicación»', async () => {
    api.fetchPet.mockResolvedValue(detailResponse(makePet({ active: false })));
    api.fetchPetDue.mockResolvedValue(dueResponse([RABIES]));
    renderPets(`/pets/${PET.id}`);
    const list = await screen.findByRole('list', { name: 'Próximas atenciones' });
    expect(within(list).queryByRole('button', { name: /Registrar/ })).not.toBeInTheDocument();
  });

  it('historial: próxima fecha con su estado, cumplida y el antecedente que la cumplió', async () => {
    api.fetchPetRecords.mockResolvedValue(
      recordsResponse([
        makeRecord({
          id: 'r-programada',
          description: 'Programada',
          nextDue: { date: '2026-10-07', status: 'UPCOMING', daysUntil: 12, fulfilledBy: null },
        }),
        makeRecord({
          id: 'r-cumplida',
          description: 'Cumplida',
          nextDue: {
            date: '2026-09-01',
            status: 'FULFILLED',
            daysUntil: -24,
            fulfilledBy: { id: 'r-aplicacion', recordDate: '2026-09-03' },
          },
        }),
        makeRecord({
          id: 'r-aplicacion',
          description: 'Aplicación',
          fulfills: { id: 'r-cumplida', type: 'VACCINE', recordDate: '2025-09-01' },
        }),
        makeRecord({ id: 'r-antiguo', description: 'Antiguo sin fecha' }),
      ]),
    );
    renderPets(`/pets/${PET.id}`);
    const history = within(await screen.findByRole('list', { name: 'Registros clínicos' }));
    const item = (text: string) => history.getByText(text).closest('li') as HTMLElement;
    expect(item('Programada')).toHaveTextContent('Próxima: 07/10/2026 · Próxima · En 12 días');
    expect(item('Cumplida')).toHaveTextContent('Cumplida el 03/09/2026');
    expect(item('Aplicación')).toHaveTextContent('Cumple la atención programada del 01/09/2025');
    expect(item('Antiguo sin fecha')).not.toHaveTextContent(/Próxima|Vencida/);
  });

  it('ADMIN completa la fecha de un registro anterior con una acción acotada', async () => {
    asAdmin();
    const user = userEvent.setup();
    api.fetchPetRecords.mockResolvedValue(
      recordsResponse([makeRecord({ id: 'r-antiguo', description: 'Antiguo sin fecha' })]),
    );
    api.updatePetRecordNextDue.mockResolvedValue({ record: makeRecord() });
    renderPets(`/pets/${PET.id}`);
    const history = within(await screen.findByRole('list', { name: 'Registros clínicos' }));
    await user.click(history.getByRole('button', { name: 'Programar próxima fecha' }));
    const dialog = await screen.findByRole('dialog', { name: 'Completar fecha programada' });
    await user.type(
      within(dialog).getByLabelText('Fecha de próxima aplicación o control'),
      '2026-12-01',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Guardar fecha' }));
    await waitFor(() =>
      expect(api.updatePetRecordNextDue).toHaveBeenCalledWith(PET.id, 'r-antiguo', '2026-12-01'),
    );
    await waitFor(() => expect(api.fetchPetDue.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('listado: indicador discreto de vencidas, de hoy y próximas (del backend, sin pedir por mascota)', async () => {
    api.fetchPets.mockResolvedValue({
      ...listResponse([
        { ...PET, dueSummary: { overdue: 1, dueToday: 1, upcoming: 2 } },
        {
          ...makePet({ id: 'otra', name: 'Otra sintética' }),
          dueSummary: { overdue: 0, dueToday: 0, upcoming: 0 },
        },
      ]),
    });
    renderPets();
    const card = (await screen.findByRole('link', { name: new RegExp(PET.name) })) as HTMLElement;
    expect(card).toHaveTextContent('1 vencida · 1 hoy · 2 próximas');
    const other = screen.getByRole('link', { name: /Otra sintética/ });
    expect(other).not.toHaveTextContent(/vencida|próxima/);
    expect(api.fetchPetDue).not.toHaveBeenCalled();
  });
});

describe('🐾 Mascotas — 📅 Vencimientos', () => {
  const OVERDUE = makeDueItem({
    record: {
      id: 'd-1',
      type: 'VACCINE',
      recordDate: '2025-01-01',
      description: 'Vencida sintética',
    },
    nextDue: { date: '2026-09-20', status: 'OVERDUE', daysUntil: -5, fulfilledBy: null },
  });
  const FULFILLED = makeDueItem({
    record: {
      id: 'd-2',
      type: 'DEWORMING',
      recordDate: '2025-01-01',
      description: 'Cumplida sintética',
    },
    nextDue: {
      date: '2026-06-01',
      status: 'FULFILLED',
      daysUntil: -116,
      fulfilledBy: { id: 'x', recordDate: '2026-06-01' },
    },
  });

  it('pestaña dentro de Mascotas; pendientes por defecto y filtros por estado, mascota y tipo en el backend', async () => {
    const user = userEvent.setup();
    api.fetchPetDue.mockResolvedValue(dueResponse([OVERDUE]));
    renderPets('/pets');
    await user.click(
      within(await screen.findByRole('navigation', { name: 'Secciones de Mascotas' })).getByRole(
        'link',
        { name: /Vencimientos/ },
      ),
    );
    const list = await screen.findByRole('list', { name: 'Atenciones programadas' });
    expect(within(list).getByText('Vencida sintética')).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: new RegExp(PET.name) })).toHaveAttribute(
      'href',
      `/pets/${PET.id}`,
    );
    expect(api.fetchPetDue).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });

    api.fetchPetDue.mockResolvedValue(dueResponse([FULFILLED]));
    await user.click(
      within(screen.getByRole('group', { name: 'Filtrar por estado' })).getByRole('button', {
        name: 'Cumplidas',
      }),
    );
    await waitFor(() =>
      expect(api.fetchPetDue).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'FULFILLED' }),
      ),
    );
    const fulfilledRow = (await screen.findByText('Cumplida sintética')).closest(
      'li',
    ) as HTMLElement;
    expect(
      within(fulfilledRow).queryByRole('button', { name: /Registrar/ }),
    ).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Tipo'), 'DEWORMING');
    await waitFor(() =>
      expect(api.fetchPetDue).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'DEWORMING' }),
      ),
    );
    await user.selectOptions(screen.getByLabelText('Mascota'), PET.id);
    await waitFor(() =>
      expect(api.fetchPetDue).toHaveBeenLastCalledWith(expect.objectContaining({ petId: PET.id })),
    );
  });

  it('estado vacío claro y «Registrar aplicación» lleva a la ficha con ese pendiente', async () => {
    const user = userEvent.setup();
    api.fetchPetDue.mockResolvedValueOnce(dueResponse([]));
    renderPets('/pets/due');
    expect(await screen.findByText('No hay atenciones programadas.')).toBeInTheDocument();
    api.fetchPetDue.mockResolvedValue(dueResponse([OVERDUE]));
    await user.click(
      within(screen.getByRole('group', { name: 'Filtrar por estado' })).getByRole('button', {
        name: 'Vencidas',
      }),
    );
    await user.click(await screen.findByRole('button', { name: /Registrar aplicación/ }));
    expect(await screen.findByText(/Cumple: 💉 Vacuna «Vencida sintética»/)).toBeInTheDocument();
  });

  it('al empezar el día de negocio (refreshAt) se revalidan los estados, sin sondeo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const soon = new Date(Date.now() + 5_000).toISOString();
      api.fetchPetDue.mockResolvedValue({ ...dueResponse([OVERDUE]), refreshAt: soon });
      renderPets('/pets/due');
      await screen.findByText('Vencida sintética');
      const calls = api.fetchPetDue.mock.calls.length;
      await vi.advanceTimersByTimeAsync(4_000);
      expect(api.fetchPetDue.mock.calls.length).toBe(calls);
      await vi.advanceTimersByTimeAsync(3_000);
      await waitFor(() => expect(api.fetchPetDue.mock.calls.length).toBe(calls + 1));
    } finally {
      vi.useRealTimers();
    }
  });
});
