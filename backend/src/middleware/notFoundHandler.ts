import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError';

/** Ruta inexistente: mensaje humano sin repetir método ni URL (no se exponen rutas internas). */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('No encontramos lo que buscás.', 404, { code: 'ROUTE_NOT_FOUND' }));
}
