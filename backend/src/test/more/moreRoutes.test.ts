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
    ['GET', '/api/v1/more/garden/versions'],
    ['POST', '/api/v1/more/garden/versions'],
    ['GET', `/api/v1/more/garden/versions/${ID}/content`],
    ['GET', '/api/v1/employees'],
    ['GET', '/api/v1/employees/profiles'],
    ['POST', '/api/v1/employees'],
    ['PATCH', `/api/v1/employees/${ID}`],
    ['PATCH', `/api/v1/employees/${ID}/status`],
    ['GET', '/api/v1/me/profile'],
    ['PUT', '/api/v1/me/profile'],
    ['POST', '/api/v1/me/children'],
    ['POST', `/api/v1/me/children/${ID}/remove`],
    ['GET', '/api/v1/me/family'],
    ['POST', '/api/v1/me/family'],
    ['PATCH', `/api/v1/me/family/${ID}`],
    ['PATCH', `/api/v1/me/family/${ID}/status`],
    ['DELETE', `/api/v1/me/family/${ID}`],
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
            : method === 'DELETE'
              ? agent.delete(path)
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
      'gardenRouter',
      'meRouter',
    ]) {
      expect(source).toMatch(new RegExp(`${name}\\.use\\(requireAuth\\)`));
    }
    expect(source).toMatch(/employeesRouter\.use\(requireAuth, requireRole\('ADMIN'\)\)/);
  });

  it('el único DELETE es un familiar propio (Etapa 5F); el único PUT es el formulario de Mi perfil', () => {
    expect([...source.matchAll(/\.delete\(/g)].map((m) => m.index)).toHaveLength(1);
    expect(source).toMatch(/meRouter\.delete\('\/family\/:id', deleteMyFamilyHandler\)/);
    expect([...source.matchAll(/\.put\(/g)]).toHaveLength(1);
    expect(source).toMatch(/meRouter\.put\('\/profile', requireJsonContentType/);
  });

  it('toda mutación exige un guard de cuerpo: JSON, o el parser binario acotado', () => {
    // `.*` hasta el cierre de la línea: los guards pueden traer paréntesis
    // propios (`requireRole('ADMIN')`) y no deben partirse al cortarlos.
    const mutations = [...source.matchAll(/Router\.(post|patch|put)\((.*)\);/g)].map(
      (m) => m[2] ?? '',
    );
    expect(mutations.length).toBeGreaterThanOrEqual(13);
    for (const args of mutations) {
      expect(args).toMatch(/requireJsonContentType|parseGalleryPhotoBody|parseGardenPlanBody/);
    }
  });

  it('el parser binario acotado es solo de imágenes, y publicar el plano exige ADMIN antes', () => {
    expect(source).toMatch(/photosRouter\.post\('\/', parseGalleryPhotoBody/);
    // ADMIN se comprueba ANTES de leer el cuerpo: un EMPLOYEE recibe el 403
    // sin subir 10 MB de imagen.
    expect(source).toMatch(
      /gardenRouter\.post\('\/versions', requireRole\('ADMIN'\), parseGardenPlanBody/,
    );
    expect(source).not.toMatch(/express\.json/);
  });

  it('el Jardín no tiene borrado ni edición: las versiones son inmutables', () => {
    expect(source).not.toMatch(/gardenRouter\.(delete|patch|put)\(/);
  });
});
