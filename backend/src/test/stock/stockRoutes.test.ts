import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app';

const ID = '11111111-1111-4111-8111-111111111111';

describe('/api/v1/stock — autenticación', () => {
  it.each([
    ['GET', `/api/v1/stock/items`],
    ['GET', `/api/v1/stock/categories`],
    ['GET', `/api/v1/stock/destinations`],
    ['GET', `/api/v1/stock/items/${ID}`],
    ['GET', `/api/v1/stock/items/${ID}/movements`],
    ['POST', `/api/v1/stock/categories`],
    ['POST', `/api/v1/stock/items`],
    ['POST', `/api/v1/stock/items/${ID}/movements`],
    ['PATCH', `/api/v1/stock/categories/${ID}`],
    ['PATCH', `/api/v1/stock/items/${ID}`],
    ['PATCH', `/api/v1/stock/items/${ID}/status`],
  ] as const)('%s %s requiere sesión y no expone detalles', async (method, path) => {
    const app = createApp();
    const response =
      method === 'GET'
        ? await request(app).get(path)
        : method === 'POST'
          ? await request(app).post(path).send({})
          : await request(app).patch(path).send({});
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { message: 'Autenticación requerida.', code: 'AUTH_REQUIRED' },
    });
  });
});

describe('/api/v1/stock — historial inmutable', () => {
  it('no declara PUT, PATCH ni DELETE para movimientos', () => {
    const source = readFileSync(resolve(__dirname, '../../routes/stockRoutes.ts'), 'utf8');
    expect(source).not.toMatch(/stockRouter\.(?:put|delete)\(/);
    expect(source).not.toMatch(/stockRouter\.patch\([^\n]*movements/);
  });
});
