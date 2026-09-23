import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthContext } from '../auth/types';
import { AuthenticationRequiredError, ForbiddenError } from '../errors/AppError';

/** Debe montarse siempre después de `requireAuth` — depende de `req.auth`. */
export function requireRole(...roles: AuthContext['role'][]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new AuthenticationRequiredError());
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}
