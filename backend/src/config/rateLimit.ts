import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { config } from './index';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 100;

/**
 * Límite general y conservador para todo /api. No hay límites especiales de
 * autenticación todavía porque el login pertenece a una etapa posterior.
 * En NODE_ENV=test se omite por completo para no interferir con las suites
 * (no usa almacenamiento externo: el conteo vive en memoria del proceso).
 */
export function createApiRateLimiter(): RequestHandler {
  if (config.isTest) {
    return (_req, _res, next) => next();
  }
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { message: 'Demasiadas solicitudes. Intentá de nuevo más tarde.' } },
  });
}
