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
    ['GET', `/api/v1/stock/reports/summary?from=2026-09-01&to=2026-09-25`],
    ['GET', `/api/v1/stock/reports/movements?from=2026-09-01&to=2026-09-25`],
    ['GET', `/api/v1/stock/reports/movements.csv?from=2026-09-01&to=2026-09-25`],
    ['GET', `/api/v1/stock/items/${ID}`],
    ['GET', `/api/v1/stock/items/${ID}/movements`],
    ['POST', `/api/v1/stock/categories`],
    ['POST', `/api/v1/stock/destinations`],
    ['POST', `/api/v1/stock/items`],
    ['POST', `/api/v1/stock/items/${ID}/movements`],
    ['PATCH', `/api/v1/stock/categories/${ID}`],
    ['PATCH', `/api/v1/stock/destinations/${ID}`],
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

describe('/api/v1/stock/destinations — alta y edición sin borrado físico', () => {
  const source = readFileSync(resolve(__dirname, '../../routes/stockRoutes.ts'), 'utf8');

  it('declara POST y PATCH de destinos', () => {
    expect(source).toMatch(/stockRouter\.post\('\/destinations'/);
    expect(source).toMatch(/stockRouter\.patch\('\/destinations\/:id'/);
  });

  it('no declara DELETE para destinos (la baja es inactivación)', () => {
    expect(source).not.toMatch(/stockRouter\.delete\(/);
    expect(source).not.toMatch(/stockRouter\.patch\([^\n]*movements/);
  });
});

describe('/api/v1/stock/reports — solo lectura', () => {
  const source = readFileSync(resolve(__dirname, '../../routes/stockRoutes.ts'), 'utf8');

  it('declara únicamente GET para reportes', () => {
    expect(source).toMatch(/stockRouter\.get\('\/reports\/summary'/);
    expect(source).toMatch(/stockRouter\.get\('\/reports\/movements'/);
    expect(source).toMatch(/stockRouter\.get\('\/reports\/movements\.csv'/);
    expect(source).not.toMatch(/stockRouter\.(?:post|patch|put|delete)\('\/reports/);
  });
});
