import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * Etapa 5R — el health check no debe tocar la base: cualquier acceso al
 * cliente Prisma durante estas pruebas queda registrado y falla.
 */
const { prismaAccesses } = vi.hoisted(() => ({ prismaAccesses: [] as string[] }));

vi.mock('../lib/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, property) {
        prismaAccesses.push(String(property));
        throw new Error('El health check no debe consultar la base.');
      },
    },
  ),
  disconnectPrisma: vi.fn(),
}));

import { createApp } from '../app';

describe('GET /api/v1/health', () => {
  it('responde 200 con el contrato mínimo { status: "ok" }', async () => {
    const response = await request(createApp()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('no requiere sesión: sin cookie ni Authorization responde igual', async () => {
    const response = await request(createApp())
      .get('/api/v1/health')
      .set('Authorization', 'Bearer token-que-no-existe');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('no consulta Prisma ni PostgreSQL (Neon)', async () => {
    prismaAccesses.length = 0;
    await request(createApp()).get('/api/v1/health').expect(200);
    await request(createApp()).get('/api/v1/health').expect(200);

    expect(prismaAccesses).toEqual([]);
  });

  it('no expone datos internos: ni versión, entorno, hora, hostname, memoria ni uptime', async () => {
    const response = await request(createApp()).get('/api/v1/health');
    const raw = JSON.stringify(response.body);

    expect(Object.keys(response.body)).toEqual(['status']);
    expect(raw).not.toMatch(/version|environment|timestamp|host|memory|uptime|la-canada-api/i);
    expect(raw).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('sigue permitiendo solicitudes sin header Origin (Render, monitoreo)', async () => {
    const response = await request(createApp()).get('/api/v1/health');
    expect(response.status).toBe(200);
  });
});
