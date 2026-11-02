import { apiRequest } from './httpClient';
import type {
  CreateGardenActivityRequest,
  CreateGardenSowingRequest,
  CreateGardenTransplantRequest,
  GardenBatchMutationResponse,
  GardenBatchResponse,
  GardenBatchStatusFilter,
  GardenBatchesResponse,
  GardenCrop,
  GardenCropRecordFilters,
  GardenCropRecordsResponse,
  UpdateGardenBatchRequest,
  UpdateGardenCropRecordRequest,
  GardenActivitiesResponse,
  GardenActivity,
  GardenCandidate,
  GardenHistoryResponse,
  GardenParticipant,
  GardenPerformanceResponse,
  GardenStatusFilter,
  UpdateGardenActivityRequest,
} from './kitchenGardenTypes';

/** 🥬 Huerta — endpoints propios (`/kitchen-garden/*`), nunca los de ✅ Tareas. */
const BASE = '/kitchen-garden';

export function fetchGardenParticipants(): Promise<{ participants: GardenParticipant[] }> {
  return apiRequest(`${BASE}/participants`, { authenticated: true });
}

export function fetchGardenCandidates(): Promise<{ candidates: GardenCandidate[] }> {
  return apiRequest(`${BASE}/participants/candidates`, { authenticated: true });
}

export function addGardenParticipant(userId: string): Promise<{ participant: GardenParticipant }> {
  return apiRequest(`${BASE}/participants`, {
    method: 'POST',
    body: { userId },
    authenticated: true,
  });
}

export function setGardenParticipantActive(
  participantId: string,
  active: boolean,
): Promise<{ participant: GardenParticipant }> {
  return apiRequest(`${BASE}/participants/${participantId}/status`, {
    method: 'PATCH',
    body: { active },
    authenticated: true,
  });
}

export function fetchGardenActivities(
  status: GardenStatusFilter = 'active',
): Promise<GardenActivitiesResponse> {
  const query = status === 'active' ? '' : `?status=${status}`;
  return apiRequest(`${BASE}/activities${query}`, { authenticated: true });
}

type ActivityResponse = Promise<{ activity: GardenActivity }>;

export function createGardenActivity(body: CreateGardenActivityRequest): ActivityResponse {
  return apiRequest(`${BASE}/activities`, { method: 'POST', body, authenticated: true });
}

export function updateGardenActivity(
  activityId: string,
  body: UpdateGardenActivityRequest,
): ActivityResponse {
  return apiRequest(`${BASE}/activities/${activityId}`, {
    method: 'PATCH',
    body,
    authenticated: true,
  });
}

export function setGardenActivityActive(activityId: string, active: boolean): ActivityResponse {
  return apiRequest(`${BASE}/activities/${activityId}/status`, {
    method: 'PATCH',
    body: { active },
    authenticated: true,
  });
}

/** Sin `participantId`: la realizó quien está en la sesión (participante). Con él: lo registra un ADMIN. */
export function completeGardenActivity(
  activityId: string,
  participantId?: string,
): ActivityResponse {
  return apiRequest(`${BASE}/activities/${activityId}/complete`, {
    method: 'POST',
    body: participantId ? { participantId } : {},
    authenticated: true,
  });
}

export function revertGardenCompletion(
  activityId: string,
  executionId: string,
  reason?: string,
): ActivityResponse {
  return apiRequest(`${BASE}/activities/${activityId}/revert`, {
    method: 'POST',
    body: reason ? { executionId, reason } : { executionId },
    authenticated: true,
  });
}

export function fetchGardenHistory(params: {
  week?: string;
  participantId?: string;
}): Promise<GardenHistoryResponse> {
  const query = new URLSearchParams();
  if (params.week) query.set('week', params.week);
  if (params.participantId) query.set('participantId', params.participantId);
  const search = query.toString();
  return apiRequest(`${BASE}/history${search ? `?${search}` : ''}`, { authenticated: true });
}

const rangeQuery = (from: string, to: string) => new URLSearchParams({ from, to }).toString();

export function fetchGardenPerformance(
  from: string,
  to: string,
): Promise<GardenPerformanceResponse> {
  return apiRequest(`${BASE}/performance/summary?${rangeQuery(from, to)}`, { authenticated: true });
}

export function fetchGardenParticipantPerformance(
  participantId: string,
  from: string,
  to: string,
): Promise<GardenPerformanceResponse> {
  return apiRequest(`${BASE}/performance/participants/${participantId}?${rangeQuery(from, to)}`, {
    authenticated: true,
  });
}

// ── 🥕 Cultivos y 📝 Registros ────────────────────────────────────────────

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(name, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

export function fetchGardenCrops(): Promise<{ crops: GardenCrop[] }> {
  return apiRequest(`${BASE}/crops`, { authenticated: true });
}

export function fetchGardenBatches(params: {
  status: GardenBatchStatusFilter;
  cropId?: string;
  page: number;
  pageSize: number;
}): Promise<GardenBatchesResponse> {
  return apiRequest(`${BASE}/batches${query(params)}`, { authenticated: true });
}

export function fetchGardenBatch(batchId: string): Promise<GardenBatchResponse> {
  return apiRequest(`${BASE}/batches/${batchId}`, { authenticated: true });
}

/** Tanda + siembra en una operación; `Idempotency-Key` estable por intento. */
export function createGardenSowing(
  body: CreateGardenSowingRequest,
  idempotencyKey: string,
): Promise<GardenBatchMutationResponse> {
  return apiRequest(`${BASE}/batches`, {
    method: 'POST',
    body,
    authenticated: true,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function createGardenTransplant(
  batchId: string,
  body: CreateGardenTransplantRequest,
  idempotencyKey: string,
): Promise<GardenBatchMutationResponse> {
  return apiRequest(`${BASE}/batches/${batchId}/transplants`, {
    method: 'POST',
    body,
    authenticated: true,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function updateGardenBatch(
  batchId: string,
  body: UpdateGardenBatchRequest,
): Promise<GardenBatchMutationResponse> {
  return apiRequest(`${BASE}/batches/${batchId}`, { method: 'PATCH', body, authenticated: true });
}

export function setGardenBatchArchived(
  batchId: string,
  archived: boolean,
): Promise<GardenBatchMutationResponse> {
  return apiRequest(`${BASE}/batches/${batchId}/${archived ? 'archive' : 'reopen'}`, {
    method: 'POST',
    body: {},
    authenticated: true,
  });
}

export function fetchGardenCropRecords(
  filters: GardenCropRecordFilters & { page: number; pageSize: number },
): Promise<GardenCropRecordsResponse> {
  return apiRequest(`${BASE}/crop-records${query({ ...filters })}`, { authenticated: true });
}

export function updateGardenCropRecord(
  recordId: string,
  body: UpdateGardenCropRecordRequest,
): Promise<GardenBatchMutationResponse> {
  return apiRequest(`${BASE}/crop-records/${recordId}`, {
    method: 'PATCH',
    body,
    authenticated: true,
  });
}

export function voidGardenCropRecord(
  recordId: string,
  reason: string,
): Promise<{ record: { id: string; batchId: string; voidedAt: string } }> {
  return apiRequest(`${BASE}/crop-records/${recordId}/void`, {
    method: 'POST',
    body: { reason },
    authenticated: true,
  });
}
