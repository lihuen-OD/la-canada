import type { NextFunction, Request, Response } from 'express';
import { UnsupportedContentTypeError } from '../errors/AppError';

/** Login/activate/reset-pin/status solo aceptan JSON — nunca un body sin declarar (o mal declarado). */
export function requireJsonContentType(req: Request, _res: Response, next: NextFunction): void {
  if (!req.is('application/json')) {
    next(new UnsupportedContentTypeError());
    return;
  }
  next();
}
