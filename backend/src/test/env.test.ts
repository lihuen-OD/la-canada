import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env';

const VALID_DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
// Sintético, >=32 caracteres — nunca un secreto real. JWT_ACCESS_SECRET pasó
// a ser obligatoria (corrección posterior a la Etapa 3B.1, ver
// "loadEnv — autenticación" más abajo), así que se agrega a casi todos los
// entornos de prueba de este archivo, igual que ya se hacía con
// VALID_DATABASE_URL desde la corrección post-Etapa 3A.
const VALID_JWT_SECRET = 'a'.repeat(32);

describe('loadEnv', () => {
  it('parsea un entorno válido y aplica los valores por defecto', () => {
    const env = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
    });
    expect(env.FRONTEND_URL).toBe('http://localhost:5173');
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
  });

  it('lanza un error cuando falta una variable requerida (FRONTEND_URL)', () => {
    expect(() =>
      loadEnv({ DATABASE_URL: VALID_DATABASE_URL, JWT_ACCESS_SECRET: VALID_JWT_SECRET }),
    ).toThrow(/FRONTEND_URL/);
  });

  it('ignora variables no declaradas, incluidas las VITE_* del frontend', () => {
    // El backend nunca debe leer variables del frontend (VITE_*): si están
    // presentes en process.env (por ejemplo, en un entorno local compartido
    // vía el .env centralizado), el schema las descarta silenciosamente.
    const env = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
      VITE_API_URL: 'http://localhost:4000/api/v1',
      SOME_UNRELATED_VAR: 'x',
    });

    expect(env).not.toHaveProperty('VITE_API_URL');
    expect(env).not.toHaveProperty('SOME_UNRELATED_VAR');
    expect(Object.keys(env)).toEqual(expect.arrayContaining(['NODE_ENV', 'PORT', 'FRONTEND_URL']));
  });

  it('acepta las variables conceptuales de Object Storage como opcionales (módulo de archivos no implementado todavía)', () => {
    const env = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
    });
    expect(env.OBJECT_STORAGE_ENDPOINT).toBeUndefined();
    expect(env.OBJECT_STORAGE_BUCKET).toBeUndefined();

    const withStorage = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
      OBJECT_STORAGE_ENDPOINT: 'https://example-storage.neon.tech',
      OBJECT_STORAGE_REGION: 'us-east-1',
      OBJECT_STORAGE_BUCKET: 'la-canada-uploads',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'test-key',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret',
    });
    expect(withStorage.OBJECT_STORAGE_BUCKET).toBe('la-canada-uploads');
  });

  it('ya no declara ninguna variable de Google Drive', () => {
    const env = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
    }) as unknown as Record<string, unknown>;
    expect(env).not.toHaveProperty('GOOGLE_DRIVE_FOLDER_ID');
    expect(env).not.toHaveProperty('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    expect(env).not.toHaveProperty('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
  });
});

describe('loadEnv — DATABASE_URL / DIRECT_URL / DATABASE_TARGET (corrección post-Etapa 3A)', () => {
  it('DATABASE_URL es obligatoria: falla temprano y con claridad si falta', () => {
    expect(() =>
      loadEnv({ FRONTEND_URL: 'http://localhost:5173', JWT_ACCESS_SECRET: VALID_JWT_SECRET }),
    ).toThrow(/DATABASE_URL/);
  });

  it('el error por DATABASE_URL faltante nunca incluye un valor de connection string', () => {
    try {
      loadEnv({ FRONTEND_URL: 'http://localhost:5173', JWT_ACCESS_SECRET: VALID_JWT_SECRET });
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect(String(error)).not.toMatch(/postgres(ql)?:\/\//i);
    }
  });

  it('DIRECT_URL sigue siendo opcional — el servidor nunca la necesita para arrancar', () => {
    const env = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
    });
    expect(env.DIRECT_URL).toBeUndefined();
  });

  it('DATABASE_TARGET es opcional (el gate real vive en los scripts, no en el arranque del servidor) y solo acepta demo/production', () => {
    const withoutTarget = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
    });
    expect(withoutTarget.DATABASE_TARGET).toBeUndefined();

    const withDemo = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
      DATABASE_TARGET: 'demo',
    });
    expect(withDemo.DATABASE_TARGET).toBe('demo');

    expect(() =>
      loadEnv({
        FRONTEND_URL: 'http://localhost:5173',
        DATABASE_URL: VALID_DATABASE_URL,
        JWT_ACCESS_SECRET: VALID_JWT_SECRET,
        DATABASE_TARGET: 'staging',
      }),
    ).toThrow();
  });

  it('DATABASE_TARGET vacío ("KEY=" sin completar en .env) se trata como ausente, no como valor inválido', () => {
    const env = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
      DATABASE_TARGET: '',
    });
    expect(env.DATABASE_TARGET).toBeUndefined();
  });
});

describe('loadEnv — autenticación (Etapa 3B.1, corregido en el hardening posterior)', () => {
  it('JWT_ACCESS_SECRET es obligatoria: falla temprano y con claridad si falta (misma fuente de verdad que DATABASE_URL)', () => {
    expect(() =>
      loadEnv({ FRONTEND_URL: 'http://localhost:5173', DATABASE_URL: VALID_DATABASE_URL }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('el error por JWT_ACCESS_SECRET faltante nunca incluye ningún valor de secreto', () => {
    try {
      loadEnv({ FRONTEND_URL: 'http://localhost:5173', DATABASE_URL: VALID_DATABASE_URL });
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect(String(error)).not.toContain(VALID_JWT_SECRET);
    }
  });

  it('JWT_ACCESS_SECRET exige un mínimo de 32 caracteres', () => {
    expect(() =>
      loadEnv({
        FRONTEND_URL: 'http://localhost:5173',
        DATABASE_URL: VALID_DATABASE_URL,
        JWT_ACCESS_SECRET: 'demasiado-corto',
      }),
    ).toThrow(/32/);
  });

  it('acepta JWT_ACCESS_SECRET con 32+ caracteres', () => {
    const env = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
    });
    expect(env.JWT_ACCESS_SECRET).toBe(VALID_JWT_SECRET);
  });

  it('ya no declara JWT_REFRESH_SECRET (el refresh token es opaco, no un JWT)', () => {
    const env = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
    }) as unknown as Record<string, unknown>;
    expect(env).not.toHaveProperty('JWT_REFRESH_SECRET');
  });

  it('ACCESS_TOKEN_TTL / REFRESH_TOKEN_TTL: valores por defecto cuando faltan', () => {
    const env = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
    });
    expect(env.ACCESS_TOKEN_TTL).toBe(720);
    expect(env.REFRESH_TOKEN_TTL).toBe(60 * 60 * 24 * 30);
  });

  it('ACCESS_TOKEN_TTL / REFRESH_TOKEN_TTL vacíos ("KEY=" sin completar) aplican el default, no fallan', () => {
    const env = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
      ACCESS_TOKEN_TTL: '',
      REFRESH_TOKEN_TTL: '',
    });
    expect(env.ACCESS_TOKEN_TTL).toBe(720);
    expect(env.REFRESH_TOKEN_TTL).toBe(60 * 60 * 24 * 30);
  });

  it('ACCESS_TOKEN_TTL / REFRESH_TOKEN_TTL respetan un valor explícito', () => {
    const env = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
      ACCESS_TOKEN_TTL: '900',
      REFRESH_TOKEN_TTL: '3600',
    });
    expect(env.ACCESS_TOKEN_TTL).toBe(900);
    expect(env.REFRESH_TOKEN_TTL).toBe(3600);
  });

  it('rechaza un ACCESS_TOKEN_TTL no positivo', () => {
    expect(() =>
      loadEnv({
        FRONTEND_URL: 'http://localhost:5173',
        DATABASE_URL: VALID_DATABASE_URL,
        JWT_ACCESS_SECRET: VALID_JWT_SECRET,
        ACCESS_TOKEN_TTL: '0',
      }),
    ).toThrow();
  });

  it('COOKIE_SAME_SITE es opcional, solo acepta lax/strict/none, y vacío se trata como ausente', () => {
    const empty = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
      COOKIE_SAME_SITE: '',
    });
    expect(empty.COOKIE_SAME_SITE).toBeUndefined();

    const valid = loadEnv({
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
      COOKIE_SAME_SITE: 'none',
    });
    expect(valid.COOKIE_SAME_SITE).toBe('none');

    expect(() =>
      loadEnv({
        FRONTEND_URL: 'http://localhost:5173',
        DATABASE_URL: VALID_DATABASE_URL,
        JWT_ACCESS_SECRET: VALID_JWT_SECRET,
        COOKIE_SAME_SITE: 'invalido',
      }),
    ).toThrow();
  });
});
