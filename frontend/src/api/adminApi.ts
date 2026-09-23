import { apiRequest } from './httpClient';
import type {
  ActivateUserRequest,
  AdminActionResult,
  AdminUsersListResponse,
  ChangeUserStatusRequest,
  ResetPinRequest,
} from './adminTypes';

/**
 * Todas `authenticated: true` — exclusivas de `ADMIN`, el backend las
 * rechaza con 401/403 para cualquier otro caso (`requireAuth` +
 * `requireRole('ADMIN')`, ver `backend/src/routes/adminUsersRoutes.ts`).
 * Ninguna envía el PIN por query string — siempre en el body JSON.
 */

/** Sin filtros ni paginación explícita: el volumen real de usuarios (hoy 4, eventualmente +1 admin) entra cómodo en la primera página por defecto del backend. */
export async function fetchAdminUsers(): Promise<AdminUsersListResponse> {
  return apiRequest<AdminUsersListResponse>('/admin/users', {
    method: 'GET',
    authenticated: true,
  });
}

export async function activateUser(userId: string, pin: string): Promise<AdminActionResult> {
  const body: ActivateUserRequest = { pin };
  return apiRequest<AdminActionResult>(`/admin/users/${userId}/activate`, {
    method: 'POST',
    body,
    authenticated: true,
  });
}

export async function resetUserPin(userId: string, pin: string): Promise<AdminActionResult> {
  const body: ResetPinRequest = { pin };
  return apiRequest<AdminActionResult>(`/admin/users/${userId}/reset-pin`, {
    method: 'POST',
    body,
    authenticated: true,
  });
}

export async function changeUserStatus(
  userId: string,
  status: ChangeUserStatusRequest['status'],
): Promise<AdminActionResult> {
  const body: ChangeUserStatusRequest = { status };
  return apiRequest<AdminActionResult>(`/admin/users/${userId}/status`, {
    method: 'PATCH',
    body,
    authenticated: true,
  });
}
