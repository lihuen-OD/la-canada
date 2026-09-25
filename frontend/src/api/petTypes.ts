/** Contrato de `/api/v1/pets` (Etapa 5M) — ver backend/src/pets. */

export type MedicalRecordType = 'VACCINE' | 'WEIGHT' | 'DEWORMING' | 'CHECKUP' | 'CLINICAL_EVENT';
export type PhotoStorageStatus = 'configured' | 'unconfigured';

export interface PetType {
  id: string;
  name: string;
  icon: string;
  active: boolean;
  /** Uno de los 9 precargados: no se puede eliminar. */
  builtin: boolean;
  activeAnimalCount: number;
}

export interface PetTypesResponse {
  types: PetType[];
  iconOptions: { icon: string; label: string }[];
}

export interface Pet {
  id: string;
  name: string;
  breed: string | null;
  birthDate: string | null;
  active: boolean;
  type: Omit<PetType, 'activeAnimalCount'>;
  /** Calculada por el backend en `BUSINESS_TIME_ZONE`. */
  age: { years: number; months: number } | null;
  daysToBirthday: number | null;
  lastWeight: { kg: string; date: string } | null;
  photo: { id: string } | null;
}

export interface PetsListResponse {
  pets: Pet[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  photoStorage: PhotoStorageStatus;
}

export interface PetDetailResponse {
  pet: Pet;
  kpis: {
    vaccines: number;
    dewormings: number;
    lastWeight: { kg: string; date: string } | null;
    daysToBirthday: number | null;
  };
  /** Fecha de negocio de hoy, `YYYY-MM-DD`. */
  today: string;
  photoStorage: PhotoStorageStatus;
}

export interface PetRecord {
  id: string;
  type: MedicalRecordType;
  recordDate: string;
  description: string | null;
  weightKg: string | null;
  employee: { id: string; displayName: string; colorHex: string | null } | null;
  createdAt: string;
}

export interface PetRecordsResponse {
  records: PetRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PetFormRequest {
  name: string;
  animalTypeId: string;
  breed: string | null;
  birthDate: string | null;
}

export interface CreatePetRecordRequest {
  type: MedicalRecordType;
  recordDate: string;
  weightKg?: string;
  description?: string;
}
