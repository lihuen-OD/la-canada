import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Etapa 5P — la caché de datos y el access token viven SOLO en memoria.
 * Escaneo estático del código de runtime (sin tests): ninguna API de
 * almacenamiento persistente del navegador ni persistidores de caché.
 *
 * Etapa 5R — única excepción: `auth/refreshAttempt.ts` guarda en
 * `localStorage` el identificador del intento de refresh en curso (no es un
 * token). Su contenido exacto se verifica en `auth/refreshAttempt.test.ts`.
 */
const REFRESH_ATTEMPT_MODULE = join(resolve(__dirname, '..'), 'auth', 'refreshAttempt.ts');
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
  ])('%s no aparece en el código de runtime', (label, pattern) => {
    const offenders = runtimeFiles(SRC)
      .filter((file) => !(label === 'localStorage' && file === REFRESH_ATTEMPT_MODULE))
      .filter((file) => pattern.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('el módulo del intento de refresh usa una sola clave y nunca menciona tokens al guardar', () => {
    const source = readFileSync(REFRESH_ATTEMPT_MODULE, 'utf8');
    const keys = source.match(/localStorage\.(?:getItem|setItem|removeItem)\(([^,)]+)/g) ?? [];
    expect(keys.length).toBeGreaterThan(0);
    for (const call of keys) expect(call).toMatch(/\(STORAGE_KEY$/);
    expect(source).not.toMatch(/getAccessToken|accessToken|refreshToken/);
  });
});
