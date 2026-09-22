import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const ALLOWED_ORIGIN = 'http://localhost:5173';
const REJECTED_ORIGIN = 'https://evil.example.com';

describe('CORS', () => {
  it('permite el origen configurado (FRONTEND_URL) y refleja el header correspondiente', async () => {
    const app = createApp();
    const response = await request(app).get('/api/v1/health').set('Origin', ALLOWED_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('permite solicitudes sin header Origin (health checks, server-to-server)', async () => {
    const app = createApp();
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('rechaza un origen no autorizado con 403 estructurado y código estable', async () => {
    const app = createApp();
    const response = await request(app).get('/api/v1/health').set('Origin', REJECTED_ORIGIN);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: { code: 'CORS_ORIGIN_DENIED', message: expect.any(String) },
    });
  });

  it('no agrega Access-Control-Allow-Origin para el origen rechazado', async () => {
    const app = createApp();
    const response = await request(app).get('/api/v1/health').set('Origin', REJECTED_ORIGIN);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('el rechazo no incluye stack trace', async () => {
    const app = createApp();
    const response = await request(app).get('/api/v1/health').set('Origin', REJECTED_ORIGIN);

    expect(response.body.error.stack).toBeUndefined();
  });
});
