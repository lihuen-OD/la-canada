/**
 * Contratos reales del backend de autenticación (Etapa 3B.2) — leídos
 * directamente de `backend/src/auth/authService.ts`/`authController.ts`,
 * nunca asumidos. Cualquier cambio ahí debe reflejarse acá.
 */

export type SystemRole = 'ADMIN' | 'EMPLOYEE';

/** Enum real de `backend/prisma/schema.prisma` (`UserStatus`) — usado tanto por `/auth/me` como por `/admin/users`. */
export type UserStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

/** Identidad mínima para el selector público de login (`GET /auth/login-options`). */
export interface LoginOption {
  id: string;
  displayName: string;
  role: SystemRole;
  colorHex: string | null;
}

/** Forma real de la respuesta de `GET /auth/login-options`: un objeto, nunca un array suelto. */
export interface LoginOptionsResponse {
  options: LoginOption[];
}

/**
 * `PublicUser` del backend — nunca incluye `username`, `pinHash` ni datos de
 * sesión. Deliberadamente un tipo DISTINTO de `AdminUserListItem`
 * (`api/adminTypes.ts`): son dos contratos reales distintos
 * (`authService.PublicUser` vs. el `select` de `adminUsersController.listUsers`),
 * no la misma forma reusada — ver ese archivo para el detalle exacto.
 */
export interface AuthenticatedUser {
  id: string;
  role: SystemRole;
  status: UserStatus;
  /** Etapa 5F — nombre visible cargado (Employee o perfil personal); null = sin nombre. Nunca `username`. */
  displayName: string | null;
  employee: { id: string; displayName: string; colorHex: string } | null;
}

/** Respuesta real de `POST /auth/login`. */
export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthenticatedUser;
}

/** Respuesta real de `POST /auth/refresh` — a propósito, sin `user` (ver authController.ts). */
export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

/** Respuesta real de `GET /auth/me`. */
export interface MeResponse {
  user: AuthenticatedUser;
}

/** Forma real de todo error del backend (`backend/src/middleware/errorHandler.ts`). */
export interface ApiErrorBody {
  error: {
    message: string;
    code?: string;
    stack?: string;
  };
}

/**
 * Autor de un registro (`recordedBy` en Stock y Mascotas): el nombre visible
 * del usuario que lo registró, resuelto por el backend con la sesión del alta.
 * Solo viene cuando el registro no tiene persona asociada. Nunca `username`.
 */
export interface RecordedBy {
  displayName: string;
}

/**
 * Persona que puede figurar como quien realizó una actividad (Stock,
 * Gallinero): un empleado activo o un ADMIN activo sin ficha. `id` es el
 * `employeeId` o el `userId` según `kind` — identidad estable, nunca el nombre.
 */
export interface ParticipantOption {
  kind: 'EMPLOYEE' | 'ADMIN';
  id: string;
  displayName: string;
  colorHex: string | null;
}

export interface ParticipantsResponse {
  participants: ParticipantOption[];
}

/** Administrador sin ficha que realizó la actividad (`participantUser` en los DTO). */
export interface ParticipantUser {
  id: string;
  displayName: string;
}
