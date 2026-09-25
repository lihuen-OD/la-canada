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
  deactivatePetType: vi.fn(),
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
    expect(api.fetchPets).toHaveBeenCalledWith({ typeId: undefined, page: 1, pageSize: 24 });
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

  it('ADMIN: "Gestionar tipos" — sin "×" en precargados, símbolo sugiere nombre, baja con confirmación', async () => {
    const user = userEvent.setup();
    asAdmin();
    api.createPetType.mockResolvedValue({ type: { ...TYPE_CUSTOM, name: 'Ternero' } });
    api.deactivatePetType.mockResolvedValue({});
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

    await user.click(
      within(dialog).getByRole('button', { name: 'Eliminar el tipo Tipo sintético' }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: /¿Eliminar el tipo "Tipo sintético"\?/,
    });
    expect(confirm).toHaveTextContent('Las mascotas de este tipo no se borran.');
    await user.click(within(confirm).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(api.deactivatePetType).toHaveBeenCalledWith(TYPE_CUSTOM.id));
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
