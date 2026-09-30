import { apiRequest } from './httpClient';
import type {
  CreatePetRecordRequest,
  PetDetailResponse,
  PetDueFilters,
  PetDueResponse,
  PetFormRequest,
  PetRecord,
  PetRecordsResponse,
  PetType,
  PetTypesResponse,
  MedicalRecordType,
  PetsListResponse,
} from './petTypes';

/** Todas autenticadas: ningún endpoint de mascotas es público. */

export async function fetchPetTypes(
  status: 'active' | 'all' = 'active',
): Promise<PetTypesResponse> {
  return apiRequest<PetTypesResponse>(`/pets/types?status=${status}`, { authenticated: true });
}

export async function fetchPets(params: {
  typeId?: string;
  /** `inactive`/`all`: solo ADMIN (el backend responde 403 al resto). */
  status?: 'active' | 'inactive' | 'all';
  page: number;
  pageSize: number;
}): Promise<PetsListResponse> {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.typeId) search.set('typeId', params.typeId);
  if (params.status && params.status !== 'active') search.set('status', params.status);
  return apiRequest<PetsListResponse>(`/pets?${search.toString()}`, { authenticated: true });
}

export async function fetchPet(petId: string): Promise<PetDetailResponse> {
  return apiRequest<PetDetailResponse>(`/pets/${petId}`, { authenticated: true });
}

export async function fetchPetRecords(
  petId: string,
  params: { type?: MedicalRecordType; page: number; pageSize: number },
): Promise<PetRecordsResponse> {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.type) search.set('type', params.type);
  return apiRequest<PetRecordsResponse>(`/pets/${petId}/records?${search.toString()}`, {
    authenticated: true,
  });
}

/** 📅 Vencimientos (todo usuario autenticado): filtros y paginación en el backend. */
export async function fetchPetDue(
  filters: PetDueFilters & { page: number; pageSize: number },
): Promise<PetDueResponse> {
  const search = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  });
  if (filters.petId) search.set('petId', filters.petId);
  if (filters.type) search.set('type', filters.type);
  if (filters.status) search.set('status', filters.status);
  return apiRequest<PetDueResponse>(`/pets/due?${search.toString()}`, { authenticated: true });
}

/** Completar o corregir la próxima fecha de un registro (solo ADMIN). */
export async function updatePetRecordNextDue(
  petId: string,
  recordId: string,
  nextDueDate: string,
): Promise<{ record: PetRecord }> {
  return apiRequest<{ record: PetRecord }>(`/pets/${petId}/records/${recordId}/next-due`, {
    method: 'PATCH',
    body: { nextDueDate },
    authenticated: true,
  });
}

/** Imagen servida por el backend (proxy autenticado): nunca una URL del bucket. */
export async function fetchPetPhoto(fileId: string): Promise<Blob> {
  return apiRequest<Blob>(`/pets/photos/${fileId}`, { authenticated: true, responseType: 'blob' });
}

/** Cualquier usuario autenticado; `Idempotency-Key` solo como header. */
export async function createPetRecord(
  petId: string,
  body: CreatePetRecordRequest,
  idempotencyKey: string,
): Promise<{ record: PetRecord }> {
  return apiRequest<{ record: PetRecord }>(`/pets/${petId}/records`, {
    method: 'POST',
    body,
    authenticated: true,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// ── Solo ADMIN (el backend rechaza al resto) ─────────────────────────────

export async function createPet(body: PetFormRequest): Promise<PetDetailResponse> {
  return apiRequest<PetDetailResponse>('/pets', { method: 'POST', body, authenticated: true });
}

export async function updatePet(petId: string, body: PetFormRequest): Promise<PetDetailResponse> {
  return apiRequest<PetDetailResponse>(`/pets/${petId}`, {
    method: 'PATCH',
    body,
    authenticated: true,
  });
}

export async function voidPetRecord(petId: string, recordId: string): Promise<unknown> {
  return apiRequest<unknown>(`/pets/${petId}/records/${recordId}/void`, {
    method: 'POST',
    body: {},
    authenticated: true,
  });
}

export async function uploadPetPhoto(
  petId: string,
  file: File,
): Promise<{ photo: { id: string } }> {
  return apiRequest<{ photo: { id: string } }>(`/pets/${petId}/photo`, {
    method: 'POST',
    rawBody: file,
    contentType: file.type,
    authenticated: true,
    headers: { 'X-File-Name': encodeURIComponent(file.name) },
  });
}

export async function removePetPhoto(petId: string): Promise<unknown> {
  return apiRequest<unknown>(`/pets/${petId}/photo/remove`, {
    method: 'POST',
    body: {},
    authenticated: true,
  });
}

export async function createPetType(body: {
  name: string;
  icon: string;
}): Promise<{ type: PetType }> {
  return apiRequest<{ type: PetType }>('/pets/types', {
    method: 'POST',
    body,
    authenticated: true,
  });
}

/** Desactivar o reactivar un tipo agregado (los precargados no cambian). */
export async function setPetTypeActive(typeId: string, active: boolean): Promise<unknown> {
  return apiRequest<unknown>(`/pets/types/${typeId}/status`, {
    method: 'PATCH',
    body: { active },
    authenticated: true,
  });
}

/** Eliminar un tipo agregado que ninguna mascota usa (409 `PET_TYPE_IN_USE` si no). */
export async function deletePetType(typeId: string): Promise<void> {
  return apiRequest<void>(`/pets/types/${typeId}`, { method: 'DELETE', authenticated: true });
}

/** Desactivar (murió, se entregó, ya no está) o reactivar una mascota. */
export async function setPetActive(petId: string, active: boolean): Promise<PetDetailResponse> {
  return apiRequest<PetDetailResponse>(`/pets/${petId}/status`, {
    method: 'PATCH',
    body: { active },
    authenticated: true,
  });
}

/** Eliminar una mascota creada por error (409 `ANIMAL_IN_USE` si tiene historia). */
export async function deletePet(petId: string): Promise<void> {
  return apiRequest<void>(`/pets/${petId}`, { method: 'DELETE', authenticated: true });
}
