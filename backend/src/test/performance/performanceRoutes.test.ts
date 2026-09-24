import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app';

describe('/api/v1/performance — autenticación', () => {
  it.each([
    '/api/v1/performance/summary?from=2026-09-01&to=2026-09-24',
    '/api/v1/performance/employees/11111111-1111-4111-8111-111111111111?from=2026-09-01&to=2026-09-24',
  ])('%s requiere sesión y no expone detalles', async (path) => {
    const response = await request(createApp()).get(path);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { message: 'Autenticación requerida.', code: 'AUTH_REQUIRED' },
    });
  });
});
