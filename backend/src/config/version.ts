import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Lee la versión desde el package.json del propio workspace `backend`.
 * Asume que el proceso corre con cwd = backend/ (cierto para `npm run dev`,
 * `npm run start` y `npm run test`, ya sea invocados directamente dentro de
 * backend/ o vía `npm run <script> --workspace=backend` desde la raíz, que
 * npm ejecuta con el cwd del workspace). Si no logra leerlo, no rompe el
 * arranque: cae a un valor por defecto.
 */
function readVersion(): string {
  try {
    const pkgPath = resolve(process.cwd(), 'package.json');
    const raw = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const SERVICE_VERSION = readVersion();
