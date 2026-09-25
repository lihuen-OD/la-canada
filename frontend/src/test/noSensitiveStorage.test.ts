import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Etapa 5P — la caché de datos y el access token viven SOLO en memoria.
 * Escaneo estático del código de runtime (sin tests): ninguna API de
 * almacenamiento persistente del navegador ni persistidores de caché.
 */
const SRC = resolve(__dirname, '..');

function runtimeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'test' ? [] : runtimeFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('sin almacenamiento persistente de tokens ni de caché', () => {
  it.each([
    ['localStorage', /\blocalStorage\s*[.[]/],
    ['sessionStorage', /\bsessionStorage\s*[.[]/],
    ['IndexedDB', /\bindexedDB\b/],
    ['document.cookie', /document\.cookie/],
    [
      'persistidores de TanStack Query',
      /persistQueryClient|createSyncStoragePersister|query-persist/,
    ],
    ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ])('%s no aparece en el código de runtime', (_label, pattern) => {
    const offenders = runtimeFiles(SRC).filter((file) => pattern.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
