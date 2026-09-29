import { describe, expect, it, onTestFinished, vi } from 'vitest';
import request from 'supertest';

/**
 * Etapa 5R — política de rate limit del health check. Los limitadores son un
 * no-op con `NODE_ENV=test`; acá se fuerza `isTest: false` para probar los
 * limitadores reales (en memoria, sin dependencias externas).
 */
vi.mock('../config', async (importOriginal) => {
  const original = await importOriginal<typeof import('../config')>();
  return { ...original, config: { ...original.config, isTest: false } };
});

import { isHealthCheck } from '../config/rateLimit';
import { createApp } from '../app';

const HEALTH_LIMIT = 300;

describe('rate limit del health check', () => {
  it('isHealthCheck reconoce solo GET/HEAD /health', () => {
    expect(isHealthCheck({ method: 'GET', path: '/health' })).toBe(true);
    expect(isHealthCheck({ method: 'HEAD', path: '/health' })).toBe(true);
    expect(isHealthCheck({ method: 'POST', path: '/health' })).toBe(false);
    expect(isHealthCheck({ method: 'GET', path: '/health/extra' })).toBe(false);
    expect(isHealthCheck({ method: 'GET', path: '/auth/me' })).toBe(false);
  });

  it('tiene un cupo propio: supera el límite general (100) sin consumirlo, y corta con 429 al pasar el suyo', async () => {
    // Un único servidor en 127.0.0.1 para las 302 requests: `request(app)`
    // levantaría y cerraría un servidor efímero por cada una, lo que bajo la
    // carga de la suite en paralelo cortaba conexiones de forma intermitente.
    const server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const app = request(server);
    for (let index = 0; index < HEALTH_LIMIT; index += 1) {
      const response = await app.get('/api/v1/health');
      expect(response.status).toBe(200);
    }

    const limited = await app.get('/api/v1/health');
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      error: {
        message:
          'Realizaste demasiadas solicitudes. Esperá unos minutos antes de volver a intentar.',
        code: 'RATE_LIMITED',
      },
    });

    // El cupo general de la API sigue intacto.
    const other = await app.get('/api/v1/ruta-que-no-existe');
    expect(other.status).toBe(404);
  }, 60_000);
});
