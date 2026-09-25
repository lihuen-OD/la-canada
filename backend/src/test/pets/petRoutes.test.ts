import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app';

const ID = '11111111-1111-4111-8111-111111111111';

describe('/api/v1/pets — autenticación', () => {
  it.each([
    ['GET', '/api/v1/pets'],
    ['GET', '/api/v1/pets/types'],
    ['GET', `/api/v1/pets/${ID}`],
    ['GET', `/api/v1/pets/${ID}/records`],
    ['GET', `/api/v1/pets/photos/${ID}`],
    ['POST', '/api/v1/pets'],
    ['POST', '/api/v1/pets/types'],
    ['POST', `/api/v1/pets/${ID}/records`],
    ['POST', `/api/v1/pets/${ID}/records/${ID}/void`],
    ['POST', `/api/v1/pets/${ID}/photo`],
    ['POST', `/api/v1/pets/${ID}/photo/remove`],
    ['PATCH', `/api/v1/pets/${ID}`],
    ['PATCH', `/api/v1/pets/types/${ID}/status`],
  ] as const)('%s %s requiere sesión', async (method, path) => {
    const app = createApp();
    const call =
      method === 'GET'
        ? request(app).get(path)
        : method === 'POST'
          ? request(app).post(path).send({})
          : request(app).patch(path).send({});
    const response = await call;
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });
});

describe('router de mascotas — superficie', () => {
  const source = readFileSync(resolve(__dirname, '../../routes/petsRoutes.ts'), 'utf-8');
  it('todo detrás de requireAuth, sin DELETE ni PUT', () => {
    expect(source).toMatch(/petsRouter\.use\(requireAuth\)/);
    expect(source).not.toMatch(/\.(delete|put)\(/);
  });
  it('las mutaciones JSON exigen Content-Type; la foto usa su parser binario acotado', () => {
    const mutations = [...source.matchAll(/petsRouter\.(post|patch)\(([^)]*)\)/g)].map(
      (m) => m[2] ?? '',
    );
    expect(mutations).toHaveLength(8);
    for (const args of mutations) {
      expect(args).toMatch(
        args.includes("'/:id/photo',") ? /parsePetPhotoBody/ : /requireJsonContentType/,
      );
    }
  });
});
