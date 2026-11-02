import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf-8');
const NAME = '20261102180000_kitchen_garden_activity_kind_notes';
const MIGRATION = read(`prisma/migrations/${NAME}/migration.sql`);
/** Solo las sentencias (sin comentarios). */
const STATEMENTS = MIGRATION.split('\n')
  .filter((line) => line.trim() && !line.trim().startsWith('--'))
  .join('\n');

describe('migración kitchen_garden_activity_kind_notes (🥬 Huerta: 📝 Registros)', () => {
  it('va después de la de cultivos y antes de la del valor HARVEST (las tres ya aplicadas en demo, sin tocar)', () => {
    const migrations = readdirSync(resolve(ROOT, 'prisma/migrations'))
      .filter((entry) => /^\d{14}_/.test(entry))
      .sort();
    const index = migrations.indexOf(NAME);
    expect(migrations[index - 1]).toBe('20261102120000_kitchen_garden_crops');
    expect(migrations[index + 1]).toBe('20261102200000_kitchen_garden_activity_kind_harvest');
  });

  it('solo agrega: un tipo y tres columnas, con tipo y observaciones opcionales', () => {
    expect(STATEMENTS).toContain(
      `CREATE TYPE "KitchenGardenActivityKind" AS ENUM ('SOWING', 'TRANSPLANT', 'OTHER');`,
    );
    expect(STATEMENTS).toMatch(/ADD COLUMN\s+"kind" "KitchenGardenActivityKind",/);
    expect(STATEMENTS).toMatch(/ADD COLUMN\s+"notes" TEXT,/);
    expect(STATEMENTS).toMatch(/ADD COLUMN\s+"version" INTEGER NOT NULL DEFAULT 1;/);
    // Tipo y observaciones sin DEFAULT ni NOT NULL: las actividades existentes quedan «Sin clasificar».
    expect(STATEMENTS).not.toMatch(/"kind"[^,;]*(NOT NULL|DEFAULT)/);
    expect(STATEMENTS).not.toMatch(/"notes" TEXT[^,;]*(NOT NULL|DEFAULT)/);
  });

  it('no convierte, completa ni borra datos; no toca otras tablas ni las de cultivos', () => {
    expect(STATEMENTS).not.toMatch(/^\s*(UPDATE|INSERT|DELETE|TRUNCATE|DROP)\b|ALTER TYPE/im);
    const altered = [...STATEMENTS.matchAll(/ALTER TABLE "(\w+)"/g)].map((match) => match[1]);
    expect(new Set(altered)).toEqual(new Set(['kitchen_garden_activities']));
    expect(STATEMENTS).not.toMatch(/CREATE TABLE|kitchen_garden_(crops|batches|crop_records)/);
  });

  it('CHECK de observaciones (1–500) y de versión positiva', () => {
    expect(STATEMENTS).toContain(
      `CHECK ("notes" IS NULL OR char_length("notes") BETWEEN 1 AND 500)`,
    );
    expect(STATEMENTS).toContain(`CHECK ("version" >= 1)`);
  });
});
