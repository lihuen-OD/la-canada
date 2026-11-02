import { apiRequest } from './httpClient';
import type {
  CreateGardenActivityRequest,
  CreateGardenActivityResponse,
  GardenActivitiesResponse,
  GardenActivity,
  GardenCandidate,
  GardenHistoryEntriesResponse,
  GardenHistoryFilters,
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

/**
 * Alta de un registro (y del trasplante programado junto a una siembra).
 * `Idempotency-Key` estable por intento: un doble envío o un reintento tras
 * una falla de red devuelve lo ya creado, sin duplicar.
 */
export function createGardenActivity(
  body: CreateGardenActivityRequest,
  idempotencyKey: string,
): Promise<CreateGardenActivityResponse> {
  return apiRequest(`${BASE}/activities`, {
    method: 'POST',
    body,
    authenticated: true,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
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

/** 📅 Historial cronológico: una página de 20 (filtros y orden en el backend). */
export function fetchGardenHistoryEntries(
  filters: GardenHistoryFilters,
  cursor: string | null,
): Promise<GardenHistoryEntriesResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== false && value !== '') query.set(key, String(value));
  }
  if (cursor) query.set('cursor', cursor);
  const search = query.toString();
  return apiRequest(`${BASE}/history/entries${search ? `?${search}` : ''}`, {
    authenticated: true,
  });
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
