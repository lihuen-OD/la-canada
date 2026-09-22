import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

describe('Rutas inexistentes', () => {
  it('responde 404 con una estructura de error consistente', async () => {
    const app = createApp();
    const response = await request(app).get('/api/v1/ruta-que-no-existe');

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('error.message');
  });
});
