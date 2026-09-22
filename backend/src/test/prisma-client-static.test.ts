import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Aserciones estáticas (lectura de texto fuente, sin conexión real) sobre
 * la separación pooled/direct y la inicialización única del cliente Prisma
 * — ver docs/ARCHITECTURE.md, "Neon — rama demo".
 */

const BACKEND_DIR = resolve(__dirname, '../..');

const PRISMA_CONFIG = readFileSync(resolve(BACKEND_DIR, 'prisma.config.ts'), 'utf-8');
const PRISMA_LIB = readFileSync(resolve(BACKEND_DIR, 'src/lib/prisma.ts'), 'utf-8');

describe('Selección pooled vs. direct', () => {
  it('prisma.config.ts (Prisma Migrate) usa DIRECT_URL, nunca DATABASE_URL', () => {
    expect(PRISMA_CONFIG).toMatch(/env\('DIRECT_URL'\)/);
    expect(PRISMA_CONFIG).not.toMatch(/env\('DATABASE_URL'\)/);
  });

  it('src/lib/prisma.ts (runtime de la app) usa DATABASE_URL, nunca lee DIRECT_URL como código', () => {
    expect(PRISMA_LIB).toMatch(/DATABASE_URL/);
    // Puede *mencionar* DIRECT_URL en un comentario explicando por qué no se
    // usa acá — lo que no debe aparecer es una referencia real a la
    // variable (`process.env.DIRECT_URL`, `config.directUrl`, etc.).
    expect(PRISMA_LIB).not.toMatch(/process\.env\.DIRECT_URL/);
    expect(PRISMA_LIB).not.toMatch(/\.directUrl\b/i);
  });
});

function listTsFilesRecursive(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'generated' || entry === 'node_modules' || entry === 'test') continue;
      files.push(...listTsFilesRecursive(full));
    } else if (entry.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('Inicialización única del cliente Prisma', () => {
  it('solo hay un `new PrismaClient(` en todo src/ (fuera de src/generated) — un único cliente reutilizable, nunca uno por request', () => {
    const srcDir = resolve(BACKEND_DIR, 'src');
    const files = listTsFilesRecursive(srcDir);
    const matches = files.flatMap((file) => {
      const content = readFileSync(file, 'utf-8');
      const found = content.match(/new PrismaClient\(/g) ?? [];
      return found.map(() => file);
    });
    expect(matches, `archivos con \`new PrismaClient(\`: ${matches.join(', ')}`).toEqual([
      resolve(srcDir, 'lib/prisma.ts'),
    ]);
  });
});
