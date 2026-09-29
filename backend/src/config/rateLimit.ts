import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { config } from './index';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 100;
/** Lecturas de imágenes (galería de Fotos, fichas de Mascotas y plano del Jardín). */
const MAX_IMAGE_REQUESTS = 600;
const IMAGE_READ_PATH =
  /^\/(?:photos\/[^/]+\/content|pets\/photos\/[^/]+|more\/garden\/versions\/[^/]+\/content)\/?$/;

/** `GET /api/v1/health` (ruta relativa a `/api/v1`). */
export function isHealthCheck(req: { method: string; path: string }): boolean {
  return (req.method === 'GET' || req.method === 'HEAD') && /^\/health\/?$/.test(req.path);
}

/**
 * Cupo propio del health check (Etapa 5R): el frontend lo consulta con
 * backoff (2 s, 4 s, 8 s y luego cada 10 s como máximo) solo mientras el
 * backend no responde. Una espera larga de varias pestañas no debe agotar el
 * cupo general de la API (100 cada 15 min), y el health no debe restarle
 * requests a las pantallas reales. 300 cada 15 min por IP cubre ~12 minutos
 * de espera continua en tres pestañas, y sigue acotando el abuso.
 */
const MAX_HEALTH_REQUESTS = 300;

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
    // Las imágenes y el health tienen su propio cupo: una grilla de fotos o
    // la espera de un arranque en frío no agotan el de la API.
    skip: (req) => isImageRead(req) || isHealthCheck(req),
    message: {
      error: {
        message:
          'Realizaste demasiadas solicitudes. Esperá unos minutos antes de volver a intentar.',
        code: 'RATE_LIMITED',
      },
    },
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
    message: {
      error: {
        message:
          'Realizaste demasiadas solicitudes. Esperá unos minutos antes de volver a intentar.',
        code: 'RATE_LIMITED',
      },
    },
  });
}

/** Cupo aparte para `GET /health` (ver `MAX_HEALTH_REQUESTS`). Solo cuenta esa ruta. */
export function createHealthRateLimiter(): RequestHandler {
  if (config.isTest) {
    return (_req, _res, next) => next();
  }
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: MAX_HEALTH_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => !isHealthCheck(req),
    message: {
      error: {
        message:
          'Realizaste demasiadas solicitudes. Esperá unos minutos antes de volver a intentar.',
        code: 'RATE_LIMITED',
      },
    },
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
    message: {
      error: {
        message: 'Realizaste demasiados intentos. Esperá unos minutos antes de volver a intentar.',
        code: 'RATE_LIMITED',
      },
    },
  });
}
