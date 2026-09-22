import type { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../errors/AppError';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Ruta no encontrada: ${req.method} ${req.originalUrl}`));
}
