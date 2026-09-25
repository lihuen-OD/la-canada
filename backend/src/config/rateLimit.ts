import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { config } from './index';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 100;
/** Etapa 5X — lecturas de imágenes (galería de Fotos y fichas de Mascotas). */
const MAX_IMAGE_REQUESTS = 600;
const IMAGE_READ_PATH = /^\/(?:photos\/[^/]+\/content|pets\/photos\/[^/]+)\/?$/;

/** GET de una imagen servida por el proxy autenticado (ruta relativa a `/api/v1`). */
export function isImageRead(req: { method: string; path: string }): boolean {
  return req.method === 'GET' && IMAGE_READ_PATH.test(req.path);
}

/**
 * Límite general y conservador para todo /api.
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
    // Las imágenes tienen su propio cupo: una grilla de fotos no agota el de la API.
    skip: isImageRead,
    message: { error: { message: 'Demasiadas solicitudes. Intentá de nuevo más tarde.' } },
  });
}

/**
 * Cupo aparte y más amplio para las imágenes (cada miniatura visible es un
 * GET autenticado; el navegador las cachea después). Solo cuenta esas rutas.
 */
export function createImageRateLimiter(): RequestHandler {
  if (config.isTest) {
    return (_req, _res, next) => next();
  }
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: MAX_IMAGE_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => !isImageRead(req),
    message: { error: { message: 'Demasiadas solicitudes. Intentá de nuevo más tarde.' } },
  });
}

const AUTH_WINDOW_MS = 15 * 60 * 1000;
/** Bastante más estricto que el límite general — login/refresh son el blanco típico de fuerza bruta. */
const AUTH_MAX_REQUESTS = 10;

/**
 * Límite específico para `/api/v1/auth/login` y `/api/v1/auth/refresh` —
 * ver docs/ARCHITECTURE.md, "Autenticación". Mismo criterio que el limiter
 * general: no-op en tests (sin dependencias externas).
 */
export function createAuthRateLimiter(): RequestHandler {
  if (config.isTest) {
    return (_req, _res, next) => next();
  }
  return rateLimit({
    windowMs: AUTH_WINDOW_MS,
    limit: AUTH_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { message: 'Demasiados intentos. Intentá de nuevo más tarde.' } },
  });
}
