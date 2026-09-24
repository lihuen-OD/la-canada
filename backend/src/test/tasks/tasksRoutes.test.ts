import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';

const TASK_ID = '11111111-1111-4111-8111-111111111111';

/** Ningún endpoint de tareas es público: sin token, 401 genérico antes de tocar la base. */
describe('/api/v1/tasks — requiere autenticación', () => {
  const app = createApp();
  const cases: [string, string][] = [
    ['get', '/api/v1/tasks'],
    ['get', '/api/v1/tasks/employees'],
    ['get', '/api/v1/tasks/history'],
    ['post', '/api/v1/tasks'],
    ['patch', `/api/v1/tasks/${TASK_ID}`],
    ['patch', `/api/v1/tasks/${TASK_ID}/status`],
    ['post', `/api/v1/tasks/${TASK_ID}/complete`],
    ['post', `/api/v1/tasks/${TASK_ID}/revert`],
  ];

  it.each(cases)('%s %s → 401 AUTH_REQUIRED sin detalles internos', async (method, path) => {
    const response = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[
      method
    ]!(path).send({});
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { message: 'Autenticación requerida.', code: 'AUTH_REQUIRED' },
    });
  });
});
