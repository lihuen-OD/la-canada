import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Regresión: un `NODE_ENV=development` en el `.env` (el `.env` de la raíz lo
 * define para el backend) no debe producir nunca el build de desarrollo de
 * React. Vite traduce ese valor del `.env` a `VITE_USER_NODE_ENV`; el test
 * lo inyecta directamente para reproducir la condición sin depender del
 * contenido del `.env` local (ni leerlo). `NODE_ENV` se quita del entorno
 * hijo porque Vitest lo fija en `test`.
 */
const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = mkdtempSync(path.join(tmpdir(), 'la-canada-build-'));
const DEV_REACT_MARKER = 'unique "key" prop';

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, VITE_USER_NODE_ENV: 'development' };
  delete env.NODE_ENV;
  return env;
}

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe('build de producción', () => {
  it('`scripts/build.mjs` genera el build de producción de React aunque el .env diga development', () => {
    const result = spawnSync(process.execPath, ['scripts/build.mjs', '--outDir', outDir], {
      cwd: frontendDir,
      env: childEnv(),
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);

    const assets = path.join(outDir, 'assets');
    const js = readdirSync(assets).filter((file) => file.endsWith('.js'));
    expect(js.length).toBeGreaterThan(0);
    for (const file of js) {
      expect(readFileSync(path.join(assets, file), 'utf8')).not.toContain(DEV_REACT_MARKER);
    }
  }, 60_000);

  it('`vite build` directo en esa condición falla con un mensaje claro (guarda de vite.config.ts)', () => {
    const result = spawnSync(
      process.execPath,
      [path.resolve(frontendDir, '../node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir],
      { cwd: frontendDir, env: childEnv(), encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('npm run build');
  }, 60_000);
});
