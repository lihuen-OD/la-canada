import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { OriginValidationError } from '../errors/AppError';

/**
 * Protección CSRF para `/auth/refresh` y `/auth/logout` (endpoints que
 * actúan sobre una cookie ya existente) — CORS (`config/cors.ts`) ya
 * restringe qué origen puede leer la *respuesta*, pero un `<form>` u otro
 * request simple cross-site puede disparar la petición igual sin leer la
 * respuesta; validar `Origin` explícitamente cierra ese hueco. A
 * diferencia del check de CORS, acá un `Origin` ausente NO se permite: los
 * navegadores siempre envían `Origin` en requests con cookies que cambian
 * estado (POST); su ausencia es sospechosa acá, no un caso legítimo de
 * server-a-servidor como en CORS general.
 */
export function validateOrigin(req: Request, _res: Response, next: NextFunction): void {
  const origin = req.header('origin');
  if (!origin || origin !== config.frontendUrl) {
    next(new OriginValidationError());
    return;
  }
  next();
}
