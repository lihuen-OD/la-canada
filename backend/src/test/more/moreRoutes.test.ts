import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app';

const ID = '11111111-1111-4111-8111-111111111111';

describe('☰ Más — ningún endpoint es público', () => {
  it.each([
    ['GET', '/api/v1/more/summary'],
    ['GET', '/api/v1/news'],
    ['POST', '/api/v1/news'],
    ['GET', '/api/v1/events'],
    ['POST', '/api/v1/events'],
    ['PATCH', `/api/v1/events/${ID}`],
    ['POST', `/api/v1/events/${ID}/delete`],
    ['GET', '/api/v1/weather'],
    ['GET', '/api/v1/photos'],
    ['POST', '/api/v1/photos'],
    ['GET', `/api/v1/photos/${ID}/content`],
    ['POST', `/api/v1/photos/${ID}/delete`],
    ['GET', '/api/v1/employees'],
    ['GET', '/api/v1/employees/profiles'],
    ['POST', '/api/v1/employees'],
    ['PATCH', `/api/v1/employees/${ID}`],
    ['PATCH', `/api/v1/employees/${ID}/status`],
    ['GET', '/api/v1/me/profile'],
    ['PUT', '/api/v1/me/profile'],
    ['POST', '/api/v1/me/children'],
    ['POST', `/api/v1/me/children/${ID}/remove`],
  ] as const)('%s %s requiere sesión', async (method, path) => {
    const app = createApp();
    const agent = request(app);
    const call =
      method === 'GET'
        ? agent.get(path)
        : method === 'POST'
          ? agent.post(path).send({})
          : method === 'PUT'
            ? agent.put(path).send({})
            : agent.patch(path).send({});
    const response = await call;
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });
});

describe('routers de Más — superficie', () => {
  const source = readFileSync(resolve(__dirname, '../../routes/moreRoutes.ts'), 'utf-8');

  it('cada router exige sesión; Configuración además exige ADMIN', () => {
    for (const name of [
      'moreRouter',
      'newsRouter',
      'eventsRouter',
      'weatherRouter',
      'photosRouter',
      'meRouter',
    ]) {
      expect(source).toMatch(new RegExp(`${name}\\.use\\(requireAuth\\)`));
    }
    expect(source).toMatch(/employeesRouter\.use\(requireAuth, requireRole\('ADMIN'\)\)/);
  });

  it('sin DELETE; el único PUT es el formulario completo de Mi perfil', () => {
    expect(source).not.toMatch(/\.delete\(/);
    expect([...source.matchAll(/\.put\(/g)]).toHaveLength(1);
    expect(source).toMatch(/meRouter\.put\('\/profile', requireJsonContentType/);
  });

  it('toda mutación JSON exige Content-Type; la subida de fotos usa su parser binario acotado', () => {
    const mutations = [...source.matchAll(/Router\.(post|patch|put)\(([^)]*)\)/g)].map(
      (m) => m[2] ?? '',
    );
    expect(mutations.length).toBeGreaterThanOrEqual(12);
    for (const args of mutations) {
      expect(args).toMatch(
        args.startsWith("'/', parseGalleryPhotoBody")
          ? /parseGalleryPhotoBody/
          : /requireJsonContentType/,
      );
    }
  });
});
