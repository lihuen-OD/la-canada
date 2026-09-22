import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

describe('GET /api/v1/health', () => {
  it('responde 200 con la estructura esperada', async () => {
    const app = createApp();
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'la-canada-api',
    });
    expect(typeof response.body.environment).toBe('string');
    expect(typeof response.body.timestamp).toBe('string');
    expect(typeof response.body.version).toBe('string');
  });
});
