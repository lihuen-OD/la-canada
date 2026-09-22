import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env';

describe('loadEnv', () => {
  it('parsea un entorno válido y aplica los valores por defecto', () => {
    const env = loadEnv({ FRONTEND_URL: 'http://localhost:5173' });
    expect(env.FRONTEND_URL).toBe('http://localhost:5173');
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
  });

  it('lanza un error cuando falta una variable requerida (FRONTEND_URL)', () => {
    expect(() => loadEnv({})).toThrow(/FRONTEND_URL/);
  });

  it('ignora variables no declaradas, incluidas las VITE_* del frontend', () => {
    // El backend nunca debe leer variables del frontend (VITE_*): si están
    // presentes en process.env (por ejemplo, en un entorno local compartido
    // vía el .env centralizado), el schema las descarta silenciosamente.
    const env = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      VITE_API_URL: 'http://localhost:4000/api/v1',
      SOME_UNRELATED_VAR: 'x',
    });

    expect(env).not.toHaveProperty('VITE_API_URL');
    expect(env).not.toHaveProperty('SOME_UNRELATED_VAR');
    expect(Object.keys(env)).toEqual(expect.arrayContaining(['NODE_ENV', 'PORT', 'FRONTEND_URL']));
  });
});
