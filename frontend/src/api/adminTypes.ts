import type { SystemRole, UserStatus } from './types';

/**
 * Contrato real de `GET /api/v1/admin/users`
 * (`backend/src/controllers/adminUsersController.ts`, `listUsers`) — leído
 * directamente del `select` de Prisma, nunca asumido. Deliberadamente
 * DISTINTO de `AuthenticatedUser` (`api/types.ts`, el `PublicUser` de
 * `/auth/me`/`/auth/login`): son dos endpoints, dos `select` y dos
 * propósitos distintos —
 *
 * - `AuthenticatedUser` es lo que ve la propia persona autenticada sobre
 *   sí misma (nunca `username`, porque ya no es lo que usa para loguearse).
 * - `AdminUserListItem` es lo que ve un ADMIN sobre CUALQUIER usuario —
 *   sí incluye `username` (identificador técnico interno, útil en una
 *   vista administrativa) y fechas, pero el `employee` que devuelve este
 *   endpoint NO incluye `colorHex` (a diferencia de `LoginOption` y de
 *   `AuthenticatedUser.employee`) — el `select` real de este endpoint
 *   simplemente no lo pide. Nunca inventar un campo que el backend no
 *   devuelve acá.
 *
 * Ninguno de los dos incluye jamás `pinHash`, intentos fallidos, fecha de
 * bloqueo, sesiones ni tokens — el backend no los selecciona, así que no
 * hay nada que ocultar del lado del cliente: directamente no llegan.
 */
export interface AdminUserListItem {
  id: string;
  username: string;
  role: SystemRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  employee: { id: string; displayName: string } | null;
}

export interface AdminUsersListResponse {
  users: AdminUserListItem[];
  pagination: { page: number; pageSize: number; total: number };
}

export interface ActivateUserRequest {
  pin: string;
}

export interface ResetPinRequest {
  pin: string;
}

export interface ChangeUserStatusRequest {
  status: UserStatus;
}

/** Las tres mutaciones administrativas devuelven exactamente esta forma en éxito. */
export interface AdminActionResult {
  ok: true;
}
