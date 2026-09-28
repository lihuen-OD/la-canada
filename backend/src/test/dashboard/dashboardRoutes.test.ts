import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app';

describe('Dashboard', () => {
  it('GET /dashboard exige sesión', async () => {
    const response = await request(createApp()).get('/api/v1/dashboard');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });
});
