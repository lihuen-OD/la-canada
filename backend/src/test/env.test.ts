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

  it('acepta las variables conceptuales de Object Storage como opcionales (módulo de archivos no implementado todavía)', () => {
    const env = loadEnv({ FRONTEND_URL: 'http://localhost:5173' });
    expect(env.OBJECT_STORAGE_ENDPOINT).toBeUndefined();
    expect(env.OBJECT_STORAGE_BUCKET).toBeUndefined();

    const withStorage = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      OBJECT_STORAGE_ENDPOINT: 'https://example-storage.neon.tech',
      OBJECT_STORAGE_REGION: 'us-east-1',
      OBJECT_STORAGE_BUCKET: 'la-canada-uploads',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'test-key',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret',
    });
    expect(withStorage.OBJECT_STORAGE_BUCKET).toBe('la-canada-uploads');
  });

  it('ya no declara ninguna variable de Google Drive', () => {
    const env = loadEnv({ FRONTEND_URL: 'http://localhost:5173' }) as unknown as Record<
      string,
      unknown
    >;
    expect(env).not.toHaveProperty('GOOGLE_DRIVE_FOLDER_ID');
    expect(env).not.toHaveProperty('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    expect(env).not.toHaveProperty('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
  });
});
