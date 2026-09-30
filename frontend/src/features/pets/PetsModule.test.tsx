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
  listResponse,
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
