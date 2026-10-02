/**
 * Clasificación de errores de la copia en Drive (Etapa 5Z). Los mensajes se
 * arman SOLO con plantillas fijas, el código HTTP y un `reason` de Google
 * filtrado a `[A-Za-z_]`: nunca el cuerpo de la respuesta, una URL (de
 * sesión de subida o firmada), un token, una clave ni el JSON de credenciales.
 */

export type DriveErrorKind =
  /** Red, timeout, 429, 5xx o límite de cuota de Google: se reintenta con backoff. */
  | 'transient'
  /** Credenciales, permisos o destino inválidos: se reintenta, pero espaciado. */
  | 'config'
  /** La solicitud es inválida para Google (400): no se reintenta. */
  | 'invalid'
  /** 409: el ID pre-generado ya existe (la copia anterior sí llegó). */
  | 'conflict'
  /** 404 sobre el archivo consultado (no sobre el destino). */
  | 'not_found';

export class DriveBackupError extends Error {
  constructor(
    readonly kind: DriveErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'DriveBackupError';
  }
}

const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'sharingRateLimitExceeded',
  'backendError',
]);

/** Solo un identificador seguro de Google (`insufficientFilePermissions`), nunca texto libre. */
export function safeReason(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z_]{1,64}$/.test(value) ? value : null;
}

/** Extrae el `reason` de un cuerpo de error de Google, sin conservar nada más. */
export function googleReason(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error === 'string') return safeReason(error); // endpoint de tokens
  if (!error || typeof error !== 'object') return null;
  const errors = (error as { errors?: unknown }).errors;
  const first = Array.isArray(errors) ? (errors[0] as { reason?: unknown } | undefined) : undefined;
  return safeReason(first?.reason) ?? safeReason((error as { status?: unknown }).status);
}

export function classifyHttpError(status: number, reason: string | null): DriveErrorKind {
  if (status === 409) return 'conflict';
  if (status === 429 || status >= 500) return 'transient';
  if (status === 403 && reason && RATE_LIMIT_REASONS.has(reason)) return 'transient';
  if (status === 401) return 'transient'; // token vencido o revocado: se renueva y se reintenta
  if (status === 403) return 'config';
  if (status === 404) return 'not_found';
  return 'invalid';
}

export function httpError(operation: string, status: number, body: unknown): DriveBackupError {
  const reason = googleReason(body);
  return new DriveBackupError(
    classifyHttpError(status, reason),
    `Drive ${operation} respondió HTTP ${status}${reason ? ` (${reason})` : ''}.`,
    status,
  );
}

/** Cualquier error → mensaje saneado y acotado para guardar o registrar. */
export function sanitizeError(error: unknown): { kind: DriveErrorKind; message: string } {
  if (error instanceof DriveBackupError) {
    return { kind: error.kind, message: error.message.slice(0, 200) };
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return { kind: 'transient', message: 'Tiempo de espera agotado.' };
  }
  return { kind: 'transient', message: 'Error de red o inesperado.' };
}
