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
  constructor(message = 'No encontramos lo que buscás.') {
    super(message, 404);
  }
}

export class CorsOriginError extends AppError {
  constructor() {
    super('No se puede acceder desde este sitio.', 403, { code: 'CORS_ORIGIN_DENIED' });
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
    super('Tu sesión venció. Volvé a ingresar.', 401, { code: 'AUTH_TOKEN_INVALID' });
  }
}

/** Distinto del anterior a propósito: el frontend puede reaccionar a "expiró" (intentar /refresh) distinto de "inválido". No revela nada sobre la cuenta, solo sobre el token. */
export class ExpiredAccessTokenError extends AppError {
  constructor() {
    super('Tu sesión venció. Volvé a ingresar.', 401, { code: 'AUTH_TOKEN_EXPIRED' });
  }
}

/** Sesión inexistente, revocada o vencida — nunca se distingue cuál al cliente (mismo tratamiento que credenciales inválidas: no dar pistas). */
export class InvalidSessionError extends AppError {
  constructor() {
    super('Tu sesión venció. Volvé a ingresar.', 401, { code: 'AUTH_SESSION_INVALID' });
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
    super('Tu sesión venció. Volvé a ingresar.', 401, { code: 'AUTH_REQUIRED' });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No tenés permiso para realizar esta acción.') {
    super(message, 403, { code: 'AUTH_FORBIDDEN' });
  }
}

/** CSRF: el header Origin de un request de auth que cambia estado no coincide con FRONTEND_URL (o falta). */
export class OriginValidationError extends AppError {
  constructor() {
    super('No se puede acceder desde este sitio.', 403, { code: 'AUTH_ORIGIN_INVALID' });
  }
}

export class UnsupportedContentTypeError extends AppError {
  constructor() {
    super('Los datos enviados no tienen un formato válido. Revisalos e intentá nuevamente.', 415, {
      code: 'UNSUPPORTED_CONTENT_TYPE',
    });
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
    super('No pudimos identificar la operación. Actualizá la pantalla e intentá nuevamente.', 400, {
      code: 'IDEMPOTENCY_KEY_INVALID',
    });
  }
}

/** Misma (actor, endpoint, clave) ya completada con un cuerpo de request distinto. */
export class IdempotencyKeyConflictError extends AppError {
  constructor() {
    super(
      'Esta operación ya se registró con otros datos. Actualizá la pantalla para ver el estado actual.',
      409,
      {
        code: 'IDEMPOTENCY_KEY_CONFLICT',
      },
    );
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
      'La operación anterior todavía se está completando. Esperá un momento e intentá nuevamente.',
      409,
      { code: 'IDEMPOTENCY_RECORD_PENDING' },
    );
  }
}

// ── Gallinero (Etapa 5G) ──────────────────────────────────────────────────

/** El gallinero principal (`ChickenCoop.code = "main"`) todavía no tiene su cantidad inicial real. */
export class ChickenCoopNotConfiguredError extends AppError {
  constructor() {
    super('El gallinero todavía no está configurado.', 409, {
      code: 'CHICKEN_COOP_NOT_CONFIGURED',
    });
  }
}

/** La configuración inicial solo se hace una vez; después, altas y bajas de a una. */
export class ChickenCoopAlreadyConfiguredError extends AppError {
  constructor() {
    super('El gallinero ya está configurado.', 409, {
      code: 'CHICKEN_COOP_ALREADY_CONFIGURED',
    });
  }
}

/**
 * La cantidad de gallinas cambió entre que se mostró la confirmación
 * ("¿Cambiar gallinas activas de X a Y?") y se aplicó — nunca se aplica
 * un cambio distinto del confirmado.
 */
export class ChickenCoopCountChangedError extends AppError {
  constructor() {
    super('La cantidad de gallinas cambió mientras tanto. Revisá el valor actual.', 409, {
      code: 'CHICKEN_COOP_COUNT_CHANGED',
    });
  }
}

/** Baja con 0 gallinas: el conteo nunca es negativo. */
export class ChickenCoopCountLimitError extends AppError {
  constructor(message = 'La cantidad de gallinas no puede ser negativa.') {
    super(message, 409, { code: 'CHICKEN_COOP_COUNT_LIMIT' });
  }
}

export class EggCollectionNotFoundError extends AppError {
  constructor() {
    super('La recolección no existe.', 404, { code: 'EGG_COLLECTION_NOT_FOUND' });
  }
}

/** Ya estaba anulada (dos anulaciones simultáneas nunca se aplican ambas). */
export class EggCollectionAlreadyVoidedError extends AppError {
  constructor() {
    super('La recolección ya fue eliminada.', 409, { code: 'EGG_COLLECTION_ALREADY_VOIDED' });
  }
}

/** Persona elegida por un ADMIN inexistente o inactiva. */
export class EggCollectorInvalidError extends AppError {
  constructor() {
    super('La persona elegida no existe o no está activa.', 400, {
      code: 'EGG_COLLECTOR_INVALID',
    });
  }
}

// ── Mascotas (Etapa 5M) ───────────────────────────────────────────────────

export class PetNotFoundError extends AppError {
  constructor() {
    super('La mascota no existe.', 404, { code: 'PET_NOT_FOUND' });
  }
}

export class PetTypeNotFoundError extends AppError {
  constructor() {
    super('El tipo de mascota no existe o está inactivo.', 400, { code: 'PET_TYPE_INVALID' });
  }
}

/** "Este tipo ya existe." del prototipo (comparación sin distinguir mayúsculas). */
export class PetTypeDuplicateError extends AppError {
  constructor() {
    super('Este tipo ya existe.', 409, { code: 'PET_TYPE_DUPLICATE' });
  }
}

/** Los 9 tipos precargados no se eliminan (el prototipo tampoco lo permitía). */
export class PetTypeBuiltinError extends AppError {
  constructor() {
    super('Este tipo forma parte de la configuración inicial y no se puede eliminar.', 409, {
      code: 'PET_TYPE_BUILTIN',
    });
  }
}

export class PetMedicalRecordNotFoundError extends AppError {
  constructor() {
    super('El registro no existe.', 404, { code: 'PET_RECORD_NOT_FOUND' });
  }
}

export class PetMedicalRecordAlreadyVoidedError extends AppError {
  constructor() {
    super('El registro ya fue eliminado.', 409, { code: 'PET_RECORD_ALREADY_VOIDED' });
  }
}

export class PetPhotoNotFoundError extends AppError {
  constructor() {
    super('La foto no existe.', 404, { code: 'PET_PHOTO_NOT_FOUND' });
  }
}

/** MIME real (bytes) no admitido o distinto del declarado. */
export class PetPhotoInvalidError extends AppError {
  constructor(message = 'La foto debe ser una imagen JPG, PNG o WebP.') {
    super(message, 415, { code: 'PET_PHOTO_INVALID' });
  }
}

export class PetPhotoTooLargeError extends AppError {
  constructor(maxMegabytes: number) {
    super(`La foto no puede superar ${maxMegabytes} MB.`, 413, { code: 'PET_PHOTO_TOO_LARGE' });
  }
}

/** Faltan las variables `OBJECT_STORAGE_*`: las fotos quedan deshabilitadas, el resto funciona. */
export class ObjectStorageNotConfiguredError extends AppError {
  constructor() {
    super('Las fotos no están disponibles: falta configurar el almacenamiento.', 503, {
      code: 'OBJECT_STORAGE_NOT_CONFIGURED',
    });
  }
}

/** El proveedor no respondió o rechazó la operación. Reintentable; nunca expone detalles. */
export class ObjectStorageUnavailableError extends AppError {
  constructor() {
    super('No pudimos acceder al almacenamiento de fotos. Volvé a intentar.', 502, {
      code: 'OBJECT_STORAGE_UNAVAILABLE',
    });
  }
}

// ── Más (Etapa 5X) ────────────────────────────────────────────────────────

/** La persona elegida para una novedad o una foto no existe o está dada de baja. */
export class EmployeeInvalidError extends AppError {
  constructor() {
    super('La persona elegida no existe o no está activa.', 400, { code: 'EMPLOYEE_INVALID' });
  }
}

export class EmployeeNotFoundError extends AppError {
  constructor() {
    super('La persona no existe.', 404, { code: 'EMPLOYEE_NOT_FOUND' });
  }
}

export class EventNotFoundError extends AppError {
  constructor() {
    super('El evento no existe o ya fue eliminado.', 404, { code: 'EVENT_NOT_FOUND' });
  }
}

/** Mismo título, fecha y tipo que otro evento vigente. */
export class EventDuplicateError extends AppError {
  constructor() {
    super('Ya existe un evento con ese título, fecha y tipo.', 409, { code: 'EVENT_DUPLICATE' });
  }
}

/** Etapa 5F — un cumpleaños manual para alguien cuyo cumpleaños ya se deriva de un perfil. */
export class EventBirthdayDerivedError extends AppError {
  constructor() {
    super(
      'Este cumpleaños ya se genera automáticamente desde el perfil correspondiente. Editalo desde su perfil para evitar duplicados.',
      409,
      { code: 'EVENT_BIRTHDAY_DERIVED' },
    );
  }
}

/** Etapa 5F — otro cumpleaños manual vigente con el mismo nombre (sin distinguir mayúsculas) y fecha. */
export class EventBirthdayDuplicateError extends AppError {
  constructor() {
    super('Ya existe un cumpleaños con este nombre y fecha.', 409, {
      code: 'EVENT_BIRTHDAY_DUPLICATE',
    });
  }
}

export class ChildNotFoundError extends AppError {
  constructor() {
    super('El hijo no existe en tu perfil.', 404, { code: 'CHILD_NOT_FOUND' });
  }
}

/** Etapa 5F — el familiar no existe o pertenece a otra persona (misma respuesta: no se revela cuál). */
export class FamilyMemberNotFoundError extends AppError {
  constructor() {
    super('El familiar no existe en tu perfil.', 404, { code: 'FAMILY_MEMBER_NOT_FOUND' });
  }
}

/** Mismo nombre y misma fecha que otro familiar propio (doble carga), sin impedir homónimos. */
export class FamilyMemberDuplicateError extends AppError {
  constructor() {
    super('Ya agregaste un familiar con ese nombre y esa fecha.', 409, {
      code: 'FAMILY_MEMBER_DUPLICATE',
    });
  }
}

/** Un familiar de los datos originales (con clave de seed) se desactiva, nunca se elimina. */
export class FamilyMemberSeededError extends AppError {
  constructor() {
    super(
      'Este familiar viene de los datos originales y no se puede eliminar. Podés desactivarlo.',
      409,
      { code: 'FAMILY_MEMBER_SEEDED' },
    );
  }
}

/** Un usuario con ficha de equipo carga sus hijos en `EmployeeChild`, no en Mi familia. */
export class FamilyUsesEmployeeProfileError extends AppError {
  constructor() {
    super('Tus hijos se cargan en la sección «Hijos» de tu perfil.', 409, {
      code: 'FAMILY_USES_EMPLOYEE_PROFILE',
    });
  }
}

export class PhotoNotFoundError extends AppError {
  constructor() {
    super('La foto no existe o ya fue eliminada.', 404, { code: 'PHOTO_NOT_FOUND' });
  }
}

// ── Jardín (Etapa 5Y) ─────────────────────────────────────────────────────

/** Etapa 5Y — la versión pedida no existe. El historial nunca se elimina, así que
 *  no hay "borrado": un 404 solo puede significar un id que nunca existió. */
export class GardenPlanVersionNotFoundError extends AppError {
  constructor() {
    super('Esa versión del plano no existe.', 404, { code: 'GARDEN_PLAN_VERSION_NOT_FOUND' });
  }
}

/** Open-Meteo no respondió a tiempo o devolvió algo inesperado. Reintentable. */
export class WeatherUnavailableError extends AppError {
  constructor() {
    super('No se pudo cargar el clima. Verificá tu conexión.', 502, {
      code: 'WEATHER_UNAVAILABLE',
    });
  }
}

// ── Eliminación definitiva (solo registros sin historia) ───────────────────
// Cada entidad tiene su propio código `*_IN_USE`: el cliente puede ofrecer
// "Desactivar" sin parsear el mensaje humano.

export class TaskInUseError extends AppError {
  constructor() {
    super(
      'No se puede eliminar esta tarea porque tiene actividad registrada. Podés desactivarla para conservar su historial.',
      409,
      { code: 'TASK_IN_USE' },
    );
  }
}

export class TaskNotFoundError extends AppError {
  constructor() {
    super('Tarea no encontrada.', 404, { code: 'TASK_NOT_FOUND' });
  }
}

/** Mismo código que la desactivación con productos activos: el motivo es el mismo (tiene productos). */
export class StockCategoryHasItemsError extends AppError {
  constructor() {
    super(
      'No se puede eliminar esta categoría porque tiene productos asociados. Primero reasigná los productos o desactivá la categoría.',
      409,
      { code: 'STOCK_CATEGORY_IN_USE' },
    );
  }
}

export class StockItemInUseError extends AppError {
  constructor() {
    super(
      'No se puede eliminar este producto porque tiene movimientos de stock. Podés desactivarlo para conservar el historial.',
      409,
      { code: 'STOCK_ITEM_IN_USE' },
    );
  }
}

export class StockDestinationInUseError extends AppError {
  constructor() {
    super(
      'No se puede eliminar este destino porque fue utilizado en movimientos de stock. Podés desactivarlo.',
      409,
      { code: 'STOCK_DESTINATION_IN_USE' },
    );
  }
}

export class PetTypeMissingError extends AppError {
  constructor() {
    super('El tipo de mascota no existe.', 404, { code: 'PET_TYPE_NOT_FOUND' });
  }
}

export class PetTypeInUseError extends AppError {
  constructor() {
    super(
      'No se puede eliminar este tipo porque está asociado a una o más mascotas. Podés desactivarlo.',
      409,
      { code: 'PET_TYPE_IN_USE' },
    );
  }
}

export class AnimalInUseError extends AppError {
  constructor() {
    super(
      'No se puede eliminar esta mascota porque tiene registros o fotos. Podés desactivarla para conservar su historia.',
      409,
      { code: 'ANIMAL_IN_USE' },
    );
  }
}

export class PetInactiveError extends AppError {
  constructor() {
    super('La mascota está inactiva. Reactivala para registrar datos nuevos.', 409, {
      code: 'PET_INACTIVE',
    });
  }
}
