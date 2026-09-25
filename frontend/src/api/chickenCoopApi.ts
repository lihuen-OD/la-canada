import { apiRequest } from './httpClient';
import type {
  ChickenCoopMutationResponse,
  ChickenCoopPeriodDays,
  ChickenCoopSummary,
  CreateEggCollectionRequest,
  EggCollectionHistoryResponse,
  EggCollectionMutationResponse,
} from './chickenCoopTypes';

/** Todas autenticadas: ningún endpoint del gallinero es público (`requireAuth` en el router). */

export async function fetchChickenCoopSummary(
  days: ChickenCoopPeriodDays,
): Promise<ChickenCoopSummary> {
  return apiRequest<ChickenCoopSummary>(`/chicken-coop/summary?days=${days}`, {
    authenticated: true,
  });
}

export async function fetchEggCollectionHistory(
  page: number,
  pageSize: number,
): Promise<EggCollectionHistoryResponse> {
  return apiRequest<EggCollectionHistoryResponse>(
    `/chicken-coop/collections?page=${page}&pageSize=${pageSize}`,
    { authenticated: true },
  );
}

/**
 * `idempotencyKey` viaja SOLO como header: el mismo envío (doble clic,
 * reintento tras una falla de red) nunca registra dos recolecciones.
 */
export async function createEggCollection(
  body: CreateEggCollectionRequest,
  idempotencyKey: string,
): Promise<EggCollectionMutationResponse> {
  return apiRequest<EggCollectionMutationResponse>('/chicken-coop/collections', {
    method: 'POST',
    body,
    authenticated: true,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// ── Solo ADMIN (el backend rechaza al resto) ─────────────────────────────

export async function voidEggCollection(collectionId: string): Promise<unknown> {
  return apiRequest<unknown>(`/chicken-coop/collections/${collectionId}/void`, {
    method: 'POST',
    body: {},
    authenticated: true,
  });
}

export async function configureChickenCoop(
  activeHensCount: number,
): Promise<ChickenCoopMutationResponse> {
  return apiRequest<ChickenCoopMutationResponse>('/chicken-coop/configuration', {
    method: 'POST',
    body: { activeHensCount },
    authenticated: true,
  });
}

export async function adjustChickenCoopHens(
  delta: 1 | -1,
  expectedCount: number,
): Promise<ChickenCoopMutationResponse> {
  return apiRequest<ChickenCoopMutationResponse>('/chicken-coop/hens-adjustments', {
    method: 'POST',
    body: { delta, expectedCount },
    authenticated: true,
  });
}
