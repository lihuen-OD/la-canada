import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError';
import { config } from '../config';
import type { ApiErrorBody } from '../types/http';

/**
 * Middleware centralizado de errores (firma de 4 argumentos: Express lo
 * reconoce como error handler por eso, aunque _req y _next no se usen).
 *
 * El stack trace nunca se expone para errores operacionales (rechazos
 * esperados y manejados: 404, el 403 de CORS, etc. — `isOperational` en
 * AppError) porque no son un bug a depurar, son una respuesta normal de la
 * API. Para errores no operacionales (inesperados, statusCode 500) sí se
 * incluye en desarrollo/test, para poder depurarlos; nunca en producción.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const message = isAppError ? err.message : 'Error interno del servidor';
  const isOperational = isAppError && err.isOperational;

  const body: ApiErrorBody = { error: { message } };
  if (isAppError && err.code) {
    body.error.code = err.code;
  }
  if (!config.isProduction && !isOperational && err instanceof Error) {
    body.error.stack = err.stack;
  }

  if (!isOperational) {
    // console.error está permitido por la regla no-console del proyecto.
    console.error('Error no controlado:', err);
  }

  res.status(statusCode).json(body);
}
