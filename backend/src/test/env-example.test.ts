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
