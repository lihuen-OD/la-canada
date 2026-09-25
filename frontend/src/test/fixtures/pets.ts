import type {
  Pet,
  PetDetailResponse,
  PetRecord,
  PetRecordsResponse,
  PetType,
  PetTypesResponse,
  PetsListResponse,
} from '../../api/petTypes';

/**
 * Fixtures SINTÉTICOS, solo para tests (nunca importados por código de
 * runtime). Mascotas, registros y personas explícitamente de prueba. Los
 * tipos reproducen solo nombre/emoji de dos de los 9 tipos reales.
 */
export const TYPE_DOG: PetType = {
  id: '00000000-0000-4000-8000-0000000a7001',
  name: 'Perro',
  icon: '🐕',
  active: true,
  builtin: true,
  activeAnimalCount: 1,
};
export const TYPE_CAT: PetType = {
  id: '00000000-0000-4000-8000-0000000a7002',
  name: 'Gato',
  icon: '🐈',
  active: true,
  builtin: true,
  activeAnimalCount: 0,
};
export const TYPE_CUSTOM: PetType = {
  id: '00000000-0000-4000-8000-0000000a7003',
  name: 'Tipo sintético',
  icon: '🐂',
  active: true,
  builtin: false,
  activeAnimalCount: 0,
};

export function typesResponse(
  types: PetType[] = [TYPE_DOG, TYPE_CAT, TYPE_CUSTOM],
): PetTypesResponse {
  return {
    types,
    iconOptions: [
      { icon: '🐕', label: 'Perro' },
      { icon: '🐂', label: 'Ternero/Buey' },
      { icon: '🐾', label: 'Otro' },
    ],
  };
}

export function makePet(overrides: Partial<Pet> = {}): Pet {
  const type = {
    id: TYPE_DOG.id,
    name: TYPE_DOG.name,
    icon: TYPE_DOG.icon,
    active: true,
    builtin: true,
  };
  return {
    id: '00000000-0000-4000-8000-0000000a0001',
    name: 'Mascota sintética',
    breed: 'Raza sintética',
    birthDate: '2023-10-10',
    active: true,
    type,
    age: { years: 2, months: 35 },
    daysToBirthday: 15,
    lastWeight: { kg: '12.5', date: '2026-09-20' },
    photo: null,
    ...overrides,
  };
}

export function listResponse(
  pets: Pet[] = [makePet()],
  page = 1,
  totalPages = 1,
): PetsListResponse {
  return { pets, page, pageSize: 24, total: pets.length, totalPages, photoStorage: 'unconfigured' };
}

export function detailResponse(pet: Pet = makePet()): PetDetailResponse {
  return {
    pet,
    kpis: {
      vaccines: 2,
      dewormings: 1,
      lastWeight: pet.lastWeight,
      daysToBirthday: pet.daysToBirthday,
    },
    today: '2026-09-25',
    photoStorage: 'unconfigured',
  };
}

export const RECORD_PERSON = {
  id: '00000000-0000-4000-8000-0000000e0a01',
  displayName: 'Persona sintética',
  colorHex: null,
};

export function makeRecord(overrides: Partial<PetRecord> = {}): PetRecord {
  return {
    id: '00000000-0000-4000-8000-0000000c0a01',
    type: 'VACCINE',
    recordDate: '2026-09-20',
    description: 'Vacuna sintética',
    weightKg: null,
    employee: RECORD_PERSON,
    createdAt: '2026-09-20T12:00:00.000Z',
    ...overrides,
  };
}

export function recordsResponse(records: PetRecord[] = [makeRecord()]): PetRecordsResponse {
  return { records, page: 1, pageSize: 20, total: records.length, totalPages: 1 };
}
