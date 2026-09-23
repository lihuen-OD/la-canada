import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Demuestra que los comandos estáticos de Prisma (sin ninguno de los cuales
 * el build/CI no puede avanzar) funcionan de verdad — no solo "deberían" —
 * sin `DATABASE_URL`/`DIRECT_URL`/`DATABASE_TARGET` disponibles. Spawnea
 * procesos reales (más lento que un test puro, pero es lo único que
 * realmente demuestra "funciona sin secretos"); no toca Neon en ningún
 * caso — `prisma format`/`validate`/`generate` no abren ninguna conexión.
 */

const BACKEND_DIR = resolve(__dirname, '../..');

function envWithoutDbVars(): NodeJS.ProcessEnv {
  const clone = { ...process.env };
  delete clone.DATABASE_URL;
  delete clone.DIRECT_URL;
  delete clone.DATABASE_TARGET;
  return clone;
}

function runPrisma(subcommand: string): void {
  execFileSync('npx', ['prisma', subcommand], {
    cwd: BACKEND_DIR,
    env: envWithoutDbVars(),
    stdio: 'pipe',
  });
}

describe('Comandos estáticos de Prisma — funcionan sin DATABASE_URL/DIRECT_URL/DATABASE_TARGET', () => {
  it('prisma format no requiere ningún secreto', () => {
    expect(() => runPrisma('format')).not.toThrow();
  });

  it('prisma validate no requiere ningún secreto', () => {
    expect(() => runPrisma('validate')).not.toThrow();
  });

  it('prisma generate no requiere ningún secreto', () => {
    expect(() => runPrisma('generate')).not.toThrow();
  });
});
