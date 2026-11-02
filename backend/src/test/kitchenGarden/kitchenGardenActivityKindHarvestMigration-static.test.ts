import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const NAME = '20261102200000_kitchen_garden_activity_kind_harvest';
const STATEMENTS = readFileSync(resolve(ROOT, `prisma/migrations/${NAME}/migration.sql`), 'utf-8')
  .split('\n')
  .filter((line) => line.trim() && !line.trim().startsWith('--'))
  .join('\n');

/**
 * «Cosecha» se agregó y se retiró de la aplicación el 2026-11-02. La migración
 * ya está aplicada en demo y no se modifica ni se borra: el valor queda en el
 * enum de la base, sin uso (el backend lo rechaza; ver `gardenSchemas.ts`).
 */
describe('migración kitchen_garden_activity_kind_harvest (valor HARVEST, sin uso)', () => {
  it('es la última y solo agrega el valor HARVEST al tipo existente', () => {
    const migrations = readdirSync(resolve(ROOT, 'prisma/migrations'))
      .filter((entry) => /^\d{14}_/.test(entry))
      .sort();
    expect(migrations.at(-1)).toBe(NAME);
    expect(STATEMENTS.trim()).toBe(`ALTER TYPE "KitchenGardenActivityKind" ADD VALUE 'HARVEST';`);
  });

  it('no reclasifica ni toca filas, tablas ni otras migraciones', () => {
    expect(STATEMENTS).not.toMatch(/\b(UPDATE|INSERT|DELETE|TRUNCATE|DROP|CREATE|ALTER TABLE)\b/i);
  });
});
