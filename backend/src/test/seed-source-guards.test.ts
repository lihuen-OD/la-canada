import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards de regresión sobre el texto fuente del seed: cosas que el seed
 * NUNCA debe hacer, verificadas leyendo los archivos como texto (no
 * requiere PostgreSQL ni PrismaClient). Complementan las aserciones
 * estructurales de seed-data.test.ts.
 */

const PRISMA_DIR = resolve(__dirname, '../../prisma');
const SEED_FILE = readFileSync(resolve(PRISMA_DIR, 'seed.ts'), 'utf-8');

function readAllSeedSources(): string {
  const dataDir = resolve(PRISMA_DIR, 'seed-data');
  const libDir = resolve(PRISMA_DIR, 'seed-lib');
  const files = [
    ...readdirSync(dataDir).map((f) => resolve(dataDir, f)),
    ...readdirSync(libDir).map((f) => resolve(libDir, f)),
    resolve(PRISMA_DIR, 'seed.ts'),
  ];
  return files.map((f) => readFileSync(f, 'utf-8')).join('\n');
}

describe('Guards de seguridad e integridad del seed (texto fuente)', () => {
  const allSources = readAllSeedSources();

  it('el seed no llama a deleteMany (uso real, no la mención en comentarios)', () => {
    // Se busca la sintaxis de llamada real (`.deleteMany(`), no la palabra
    // suelta — el propio archivo la menciona en un comentario para
    // documentar que NO se usa.
    expect(SEED_FILE).not.toMatch(/\.deleteMany\s*\(/);
  });

  it('el seed no contiene resets de base (drop, truncate)', () => {
    expect(SEED_FILE.toLowerCase()).not.toMatch(/drop table|truncate/);
  });

  it('no aparece la URL ni la API key de Supabase en ningún archivo del seed', () => {
    // Se busca el identificador real del proyecto/la key, no la palabra
    // "supabase" — varios comentarios la mencionan legítimamente al
    // explicar de dónde viene un dato o por qué algo no se siembra.
    expect(allSources).not.toMatch(/REDACTED_SUPABASE_PROJECT_REF/);
    expect(allSources).not.toMatch(/REDACTED_JWT_HEADER/);
  });

  it('no hay ningún PIN ni contraseña hardcodeada en el seed', () => {
    expect(allSources).not.toMatch(/\b1234\b/);
    expect(allSources.toLowerCase()).not.toMatch(/password\s*[:=]\s*['"][^'"]+['"]/);
    expect(allSources.toLowerCase()).not.toMatch(/\bpin\s*[:=]\s*['"]\d+['"]/);
  });

  it('el seed nunca crea un usuario con rol ADMIN', () => {
    expect(SEED_FILE).not.toMatch(/SystemRole\.ADMIN/);
    expect(SEED_FILE).toMatch(/SystemRole\.EMPLOYEE/);
  });

  it('el seed nunca setea passwordHash a un valor inventado', () => {
    expect(SEED_FILE).not.toMatch(/passwordHash\s*:/);
  });

  it('no existe ningún módulo de seed-data para gallinero (cantidad de gallinas)', () => {
    const dataDir = resolve(PRISMA_DIR, 'seed-data');
    const files = readdirSync(dataDir);
    expect(files.some((f) => /chicken|coop|gallin/i.test(f))).toBe(false);
    expect(SEED_FILE).not.toMatch(/chickenCoop\.create/);
    expect(SEED_FILE).not.toMatch(/activeHensCount/);
  });

  it('el seed nunca crea TaskExecution, Session, AuditLog ni Animal (sin evidencia real en el HTML)', () => {
    expect(SEED_FILE).not.toMatch(/taskExecution\.create/);
    expect(SEED_FILE).not.toMatch(/\bsession\.create/);
    expect(SEED_FILE).not.toMatch(/auditLog\.create/);
    expect(SEED_FILE).not.toMatch(/\banimal\.create/); // animalType sí existe; "animal." (minúscula) no debe aparecer
  });

  it('el seed nunca crea FileAsset ni EggCollection (sin fotos ni recolecciones reales en el HTML)', () => {
    expect(SEED_FILE).not.toMatch(/fileAsset\.create/);
    expect(SEED_FILE).not.toMatch(/eggCollection\.create/);
  });

  it('el único StockMovementType que el seed usa es OPENING_BALANCE (sin consumos ficticios)', () => {
    // El valor del enum se referencia en seed-data/stock.ts, no en seed.ts
    // directamente — por eso se revisa `allSources` acá.
    expect(allSources).not.toMatch(/StockMovementType\.CONSUMPTION/);
    expect(allSources).not.toMatch(/StockMovementType\.INCOME/);
    expect(allSources).not.toMatch(/StockMovementType\.ADJUSTMENT/);
    expect(allSources).toMatch(/StockMovementType\.OPENING_BALANCE/);
  });

  it('el seed usa createIfMissing (create-if-missing) y no upsert directo de Prisma para los datos de negocio', () => {
    expect(SEED_FILE).not.toMatch(/\.upsert\(/);
  });

  it('el seed nunca crea un usuario con status ACTIVE (todos quedan PENDING_ACTIVATION, el default del schema)', () => {
    expect(SEED_FILE).not.toMatch(/UserStatus\.ACTIVE/);
    expect(SEED_FILE).not.toMatch(/status\s*:\s*['"]ACTIVE['"]/);
  });

  it('cada StockItem crea exactamente un movimiento de apertura (escritura anidada singular, no un array)', () => {
    // `movements: { create: { ... } }` (objeto singular) — si en el futuro
    // alguien lo cambia a `create: [{...}, {...}]` (array), este test debe
    // fallar para forzar a revisar el conteo de 14 movimientos.
    const nestedMovementCreates = SEED_FILE.match(/movements:\s*{\s*create:\s*{/g) ?? [];
    expect(nestedMovementCreates).toHaveLength(1);
    expect(SEED_FILE).not.toMatch(/movements:\s*{\s*create:\s*\[/);
  });

  it('todo movimiento de apertura que crea el seed incluye `reference` (clave de idempotencia)', () => {
    expect(SEED_FILE).toMatch(
      /reference:\s*`\$\{seed\.area\}::\$\{seed\.name\}::\$\{seed\.movementType\}`/,
    );
  });
});
