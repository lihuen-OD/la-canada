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
