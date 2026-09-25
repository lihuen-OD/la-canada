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

/**
 * La base no pudo iniciar/completar la transacción de rotación (p. ej.
 * `P2028` al no conseguir conexión a tiempo) y la sesión quedó intacta —
 * no hubo carrera ni cambio de estado. Reintentable; nunca expone Prisma.
 */
export class SessionRefreshUnavailableError extends AppError {
  constructor() {
    super('No pudimos renovar la sesión en este momento. Volvé a intentar.', 503, {
      code: 'AUTH_REFRESH_UNAVAILABLE',
    });
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

// ── Stock (Etapa 5A) ──────────────────────────────────────────────────────

/** Un producto desactivado no admite movimientos hasta que un ADMIN lo reactive. */
export class StockItemInactiveError extends AppError {
  constructor() {
    super('El producto está desactivado.', 409, { code: 'STOCK_ITEM_INACTIVE' });
  }
}

/**
 * Un consumo/ajuste a la baja no puede dejar el saldo en negativo. El
 * mensaje incluye el saldo actual cuando ya se leyó; sin detalle es la
 * carrera de dos movimientos simultáneos (la condición atómica de base
 * rechazó la actualización).
 */
export class StockInsufficientQuantityError extends AppError {
  constructor(
    message = 'Stock insuficiente: el saldo cambió durante la operación. Volvé a intentar.',
  ) {
    super(message, 409, { code: 'STOCK_INSUFFICIENT_QUANTITY' });
  }
}

/** Una categoría inactiva no admite nuevos productos ni reasignaciones. */
export class StockCategoryInactiveError extends AppError {
  constructor() {
    super('La categoría está inactiva.', 409, { code: 'STOCK_CATEGORY_INACTIVE' });
  }
}

/** Un destino de consumo inactivo no admite nuevos movimientos. */
export class StockDestinationInactiveError extends AppError {
  constructor() {
    super('El destino está inactivo.', 409, { code: 'STOCK_DESTINATION_INACTIVE' });
  }
}

/** Mismo `(area, name)` en StockItem (`@@unique([area, name])`). */
export class DuplicateStockItemError extends AppError {
  constructor() {
    super('Ya existe un producto con ese nombre en esa área.', 409, {
      code: 'STOCK_ITEM_DUPLICATE',
    });
  }
}

/** Mismo `(name, area)` en StockCategory (`@@unique([name, area])`). */
export class DuplicateStockCategoryError extends AppError {
  constructor() {
    super('Ya existe una categoría con ese nombre en esa área.', 409, {
      code: 'STOCK_CATEGORY_DUPLICATE',
    });
  }
}

/** Identificadores de recursos de Stock que no existen usan 404 + código estable. */
export class StockItemNotFoundError extends AppError {
  constructor() {
    super('Producto no encontrado.', 404, { code: 'STOCK_ITEM_NOT_FOUND' });
  }
}

export class StockCategoryNotFoundError extends AppError {
  constructor() {
    super('Categoría no encontrada.', 404, { code: 'STOCK_CATEGORY_NOT_FOUND' });
  }
}

export class StockDestinationNotFoundError extends AppError {
  constructor() {
    super('Destino no encontrado.', 404, { code: 'STOCK_DESTINATION_NOT_FOUND' });
  }
}

/** No se desactiva una categoría mientras tenga productos activos vinculados. */
export class StockCategoryInUseError extends AppError {
  constructor() {
    super('La categoría tiene productos activos y no se puede desactivar.', 409, {
      code: 'STOCK_CATEGORY_IN_USE',
    });
  }
}

/** Un incremento no puede exceder Decimal(10,2). */
export class StockBalanceLimitError extends AppError {
  constructor() {
    super('El movimiento excede el saldo máximo admitido.', 409, {
      code: 'STOCK_BALANCE_LIMIT',
    });
  }
}

/** Mismo `name` en ConsumptionDestination (`name String @unique`). */
export class StockDestinationDuplicateError extends AppError {
  constructor() {
    super('Ya existe un destino con ese nombre.', 409, {
      code: 'STOCK_DESTINATION_DUPLICATE',
    });
  }
}

// ── Idempotencia (Etapa 5C.1) ─────────────────────────────────────────────

/** El header `Idempotency-Key` no cumple `^[A-Za-z0-9_-]{8,64}$`. */
export class IdempotencyKeyInvalidError extends AppError {
  constructor() {
    super(
      'Idempotency-Key inválido: se admiten de 8 a 64 caracteres (letras, números, "-" o "_").',
      400,
      { code: 'IDEMPOTENCY_KEY_INVALID' },
    );
  }
}

/** Misma (actor, endpoint, clave) ya completada con un cuerpo de request distinto. */
export class IdempotencyKeyConflictError extends AppError {
  constructor() {
    super('La clave Idempotency-Key ya fue usada con un cuerpo distinto.', 409, {
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    });
  }
}

/**
 * La operación idempotente no está disponible para replay seguro: el registro
 * está incompleto o, defensivamente, no quedó visible tras la colisión. En
 * Postgres el INSERT perdedor normalmente espera el commit del ganador, así
 * que esto representa un estado transitorio/inesperado. Nunca se reejecuta la
 * escritura a ciegas.
 */
export class IdempotencyRecordPendingError extends AppError {
  constructor() {
    super(
      'La operación anterior con esta clave todavía se está completando. Volvé a intentar.',
      409,
      { code: 'IDEMPOTENCY_RECORD_PENDING' },
    );
  }
}
