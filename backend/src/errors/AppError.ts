export interface AppErrorOptions {
  /** Error esperado/manejado (404, 403 por CORS, etc.) vs. falla inesperada. Afecta si se loguea y si se expone stack trace. */
  isOperational?: boolean;
  /** Código estable, apto para que un cliente lo matchee sin parsear el mensaje humano. */
  code?: string;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly isOperational: boolean;
  readonly code?: string;

  constructor(message: string, statusCode = 500, options: AppErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.isOperational = options.isOperational ?? true;
    this.code = options.code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado') {
    super(message, 404);
  }
}

export class CorsOriginError extends AppError {
  constructor() {
    super('Origen no permitido por CORS.', 403, { code: 'CORS_ORIGIN_DENIED' });
  }
}

/**
 * Un único error para TODO fallo de login (identidad inexistente, PIN
 * incorrecto, estado no ACTIVE, o cuenta bloqueada por intentos fallidos)
 * — a propósito, para no permitir enumeración de cuentas ni de motivos de
 * bloqueo por el mensaje ni por el código de error.
 */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super('Identidad o PIN incorrectos.', 401, { code: 'AUTH_INVALID_CREDENTIALS' });
  }
}

/** Access token ausente, con formato inválido, firma inválida, o issuer/audience incorrectos. */
export class InvalidAccessTokenError extends AppError {
  constructor() {
    super('Token de acceso inválido.', 401, { code: 'AUTH_TOKEN_INVALID' });
  }
}

/** Distinto del anterior a propósito: el frontend puede reaccionar a "expiró" (intentar /refresh) distinto de "inválido". No revela nada sobre la cuenta, solo sobre el token. */
export class ExpiredAccessTokenError extends AppError {
  constructor() {
    super('Token de acceso vencido.', 401, { code: 'AUTH_TOKEN_EXPIRED' });
  }
}

/** Sesión inexistente, revocada o vencida — nunca se distingue cuál al cliente (mismo tratamiento que credenciales inválidas: no dar pistas). */
export class InvalidSessionError extends AppError {
  constructor() {
    super('Sesión inválida o expirada.', 401, { code: 'AUTH_SESSION_INVALID' });
  }
}

export class AuthenticationRequiredError extends AppError {
  constructor() {
    super('Autenticación requerida.', 401, { code: 'AUTH_REQUIRED' });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No tenés permisos para esta acción.') {
    super(message, 403, { code: 'AUTH_FORBIDDEN' });
  }
}

/** CSRF: el header Origin de un request de auth que cambia estado no coincide con FRONTEND_URL (o falta). */
export class OriginValidationError extends AppError {
  constructor() {
    super('Origen no válido.', 403, { code: 'AUTH_ORIGIN_INVALID' });
  }
}

export class UnsupportedContentTypeError extends AppError {
  constructor() {
    super('Content-Type debe ser application/json.', 415, { code: 'UNSUPPORTED_CONTENT_TYPE' });
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, { code: 'VALIDATION_ERROR' });
  }
}

/** Transición de estado de usuario no permitida (ver backend/src/auth/userStatus.ts). */
export class InvalidStatusTransitionError extends AppError {
  constructor(message: string) {
    super(message, 400, { code: 'INVALID_STATUS_TRANSITION' });
  }
}

/** Un ADMIN intentando suspenderse/desactivarse a sí mismo dejaría el sistema sin administración utilizable. */
export class SelfLockoutError extends AppError {
  constructor() {
    super(
      'No podés suspender ni desactivar tu propia cuenta si sos el único administrador activo.',
      409,
      { code: 'AUTH_SELF_LOCKOUT' },
    );
  }
}

/** Ya existe una ejecución vigente de esa tarea para el período actual (incluye la carrera de dos finalizaciones simultáneas). */
export class TaskAlreadyCompletedError extends AppError {
  constructor() {
    super('Esta tarea ya fue completada para el período actual.', 409, {
      code: 'TASK_ALREADY_COMPLETED',
    });
  }
}

/** Una tarea desactivada no se puede completar hasta reactivarla. */
export class TaskInactiveError extends AppError {
  constructor() {
    super('La tarea está desactivada.', 409, { code: 'TASK_INACTIVE' });
  }
}

/** La ejecución ya fue revertida (o nunca estuvo vigente). */
export class TaskExecutionNotActiveError extends AppError {
  constructor() {
    super('Esta finalización ya fue revertida.', 409, { code: 'TASK_EXECUTION_NOT_ACTIVE' });
  }
}

/** Mismo responsable con una tarea de descripción idéntica (`@@unique([employeeId, description])`). */
export class DuplicateTaskError extends AppError {
  constructor() {
    super('Ese responsable ya tiene una tarea con la misma descripción.', 409, {
      code: 'TASK_DUPLICATE',
    });
  }
}

export class EmployeeLinkRequiredError extends AppError {
  constructor() {
    super('Tu usuario no tiene un empleado activo vinculado.', 409, {
      code: 'EMPLOYEE_LINK_REQUIRED',
    });
  }
}
