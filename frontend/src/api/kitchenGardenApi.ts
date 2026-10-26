import { apiRequest } from './httpClient';
import type {
  CreateGardenActivityRequest,
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
