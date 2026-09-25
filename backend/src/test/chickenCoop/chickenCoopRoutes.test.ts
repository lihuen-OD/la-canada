import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app';

const ID = '11111111-1111-4111-8111-111111111111';

describe('/api/v1/chicken-coop — autenticación', () => {
  it.each([
    ['GET', '/api/v1/chicken-coop/summary'],
    ['GET', '/api/v1/chicken-coop/collections'],
    ['POST', '/api/v1/chicken-coop/collections'],
    ['POST', `/api/v1/chicken-coop/collections/${ID}/void`],
    ['POST', '/api/v1/chicken-coop/configuration'],
    ['POST', '/api/v1/chicken-coop/hens-adjustments'],
  ] as const)('%s %s requiere sesión y no expone detalles', async (method, path) => {
    const app = createApp();
    const response =
      method === 'GET' ? await request(app).get(path) : await request(app).post(path).send({});
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { message: 'Autenticación requerida.', code: 'AUTH_REQUIRED' },
    });
  });
});

describe('router de gallinero — superficie', () => {
  const source = readFileSync(resolve(__dirname, '../../routes/chickenCoopRoutes.ts'), 'utf-8');

  it('todo detrás de requireAuth y sin borrado ni edición de recolecciones', () => {
    expect(source).toMatch(/chickenCoopRouter\.use\(requireAuth\)/);
    expect(source).not.toMatch(/\.(delete|put|patch)\(/);
  });

  it('toda mutación exige Content-Type JSON', () => {
    const posts = [...source.matchAll(/chickenCoopRouter\.post\(([^)]*)\)/g)].map((m) => m[1]);
    expect(posts).toHaveLength(4);
    for (const args of posts) expect(args).toContain('requireJsonContentType');
  });
});
