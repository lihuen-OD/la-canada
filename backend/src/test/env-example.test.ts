import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Aserciones sobre el `.env.example` centralizado en la raíz del monorepo,
 * leído como texto — no requiere ningún proceso corriendo. Complementa
 * `env.test.ts` (que valida `loadEnv` en memoria, no el archivo de ejemplo).
 */

const ENV_EXAMPLE = readFileSync(resolve(__dirname, '../../../.env.example'), 'utf-8');

describe('.env.example — Object Storage reemplaza a Google Drive', () => {
  it('no contiene ninguna variable ni mención de Google Drive', () => {
    expect(ENV_EXAMPLE).not.toMatch(/GOOGLE_DRIVE_FOLDER_ID/);
    expect(ENV_EXAMPLE).not.toMatch(/GOOGLE_SERVICE_ACCOUNT_EMAIL/);
    expect(ENV_EXAMPLE).not.toMatch(/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/);
    expect(ENV_EXAMPLE.toLowerCase()).not.toMatch(/google/);
  });

  it('contiene las 5 variables conceptuales de Object Storage', () => {
    for (const key of [
      'OBJECT_STORAGE_ENDPOINT',
      'OBJECT_STORAGE_REGION',
      'OBJECT_STORAGE_BUCKET',
      'OBJECT_STORAGE_ACCESS_KEY_ID',
      'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    ]) {
      expect(ENV_EXAMPLE).toMatch(new RegExp(`^${key}=`, 'm'));
    }
  });

  it('ninguna variable de Object Storage tiene prefijo VITE_ (el frontend nunca recibe credenciales de almacenamiento)', () => {
    expect(ENV_EXAMPLE).not.toMatch(/VITE_OBJECT_STORAGE/);
    expect(ENV_EXAMPLE).not.toMatch(/VITE_.*STORAGE/i);
  });

  it('las variables de Object Storage no tienen valores reales (quedan vacías, no son obligatorias todavía)', () => {
    const storageLines = ENV_EXAMPLE.split('\n').filter((line) =>
      line.startsWith('OBJECT_STORAGE_'),
    );
    expect(storageLines.length).toBe(5);
    for (const line of storageLines) {
      expect(line).toMatch(/^OBJECT_STORAGE_[A-Z_]+=$/);
    }
  });
});

describe('.env.example — Neon (Etapa 3A): DATABASE_URL/DIRECT_URL nunca con valor real', () => {
  // Guard directo contra la regresión detectada en esta misma etapa: un
  // valor real de Neon (usuario, password y host reales) llegó a pegarse en
  // `.env.example` por error, antes de commitearse. Este test falla si
  // vuelve a pasar — no compara contra el valor puntual que se filtró (eso
  // sería reintroducirlo como fixture), sino contra la *forma* de una
  // connection string real.
  it('DATABASE_URL y DIRECT_URL están presentes pero vacías', () => {
    expect(ENV_EXAMPLE).toMatch(/^DATABASE_URL=$/m);
    expect(ENV_EXAMPLE).toMatch(/^DIRECT_URL=$/m);
  });

  it('ninguna línea del archivo contiene una connection string de Postgres con credenciales', () => {
    expect(ENV_EXAMPLE).not.toMatch(/postgres(ql)?:\/\/[^:\s]+:[^@\s]+@/i);
  });

  it('ninguna línea del archivo contiene un host de Neon real', () => {
    expect(ENV_EXAMPLE).not.toMatch(/[a-z0-9-]+\.neon\.tech/i);
  });
});

describe('.env.example — zona horaria de negocio (Etapa 4A)', () => {
  it('declara BUSINESS_TIME_ZONE con una zona IANA, sin prefijo VITE_', () => {
    expect(ENV_EXAMPLE).toMatch(/^BUSINESS_TIME_ZONE=America\/Argentina\/Buenos_Aires$/m);
    expect(ENV_EXAMPLE).not.toMatch(/VITE_BUSINESS_TIME_ZONE/);
  });
});
