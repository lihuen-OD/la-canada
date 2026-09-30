/** Contrato de `/api/v1/pets` (Etapa 5M) — ver backend/src/pets. */

import type { RecordedBy } from './types';

export type MedicalRecordType = 'VACCINE' | 'WEIGHT' | 'DEWORMING' | 'CHECKUP' | 'CLINICAL_EVENT';
export type PhotoStorageStatus = 'configured' | 'unconfigured';

/**
 * Estado de una próxima aplicación o control, calculado SIEMPRE por el
 * backend con fechas de `BUSINESS_TIME_ZONE` (nunca con la zona del
 * navegador): vigente (> 30 días), próxima (1–30), vence hoy, vencida o
 * cumplida (otra atención vigente la registró).
 */
export type DueStatus = 'SCHEDULED' | 'UPCOMING' | 'DUE_TODAY' | 'OVERDUE' | 'FULFILLED';

export interface NextDue {
  /** Fecha programada `YYYY-MM-DD`. */
  date: string;
  status: DueStatus;
  /** Días que faltan (negativo = transcurridos), en días de calendario. */
  daysUntil: number;
  /** La atención que la cumplió, si está vigente. */
  fulfilledBy: { id: string; recordDate: string } | null;
}

/** Revalidación al cambiar el día de negocio (sin sondeo). */
export interface BusinessDay {
  /** Hoy en `BUSINESS_TIME_ZONE`, `YYYY-MM-DD`. */
  today: string;
  /** Instante ISO en que empieza el próximo día de negocio. */
  refreshAt: string;
}

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
  /** Solo en el listado: atenciones pendientes vencidas, de hoy y próximas (≤ 30 días). */
  dueSummary?: { overdue: number; dueToday: number; upcoming: number };
}

export interface PetsListResponse extends Partial<BusinessDay> {
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
  /** Sin persona (un ADMIN sin empleado): quien cargó el registro. */
  recordedBy?: RecordedBy | null;
  /** Próxima aplicación o control programada con este registro (`null` = sin fecha). */
  nextDue?: NextDue | null;
  /** El pendiente que esta atención cumplió. */
  fulfills?: { id: string; type: MedicalRecordType; recordDate: string } | null;
  createdAt: string;
}

export interface PetRecordsResponse extends Partial<BusinessDay> {
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
  /** «Fecha de próxima aplicación o control» (nunca en ⚖️ Peso). */
  nextDueDate?: string;
  /** «Registrar aplicación / control»: el pendiente que esta atención cumple. */
  fulfillsRecordId?: string;
}

/** Una atención programada (📅 Vencimientos y «Próximas atenciones»). */
export interface PetDueItem {
  record: { id: string; type: MedicalRecordType; recordDate: string; description: string | null };
  pet: { id: string; name: string; typeName: string; icon: string };
  nextDue: NextDue;
}

export interface PetDueResponse extends BusinessDay {
  items: PetDueItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PetDueFilters {
  petId?: string;
  type?: MedicalRecordType;
  status?: DueStatus;
}
