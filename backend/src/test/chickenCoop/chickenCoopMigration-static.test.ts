import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(
  resolve(
    __dirname,
    '../../../prisma/migrations/20260925150000_chicken_coop_voiding_checks/migration.sql',
  ),
  'utf-8',
);

describe('migración chicken_coop_voiding_checks (Etapa 5G)', () => {
  const statements = MIGRATION.split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  it('contiene exactamente las 7 sentencias aprobadas', () => {
    expect(statements.map((statement) => statement.split(' (')[0]?.split(' ON ')[0])).toEqual([
      'ALTER TABLE "egg_collections" ADD COLUMN "recorded_by_user_id" UUID, ADD COLUMN "voided_at" TIMESTAMP(3), ADD COLUMN "voided_by_user_id" UUID',
      'CREATE INDEX "egg_collections_collection_date_idx"',
      'ALTER TABLE "egg_collections" ADD CONSTRAINT "egg_collections_recorded_by_user_id_fkey" FOREIGN KEY',
      'ALTER TABLE "egg_collections" ADD CONSTRAINT "egg_collections_voided_by_user_id_fkey" FOREIGN KEY',
      'ALTER TABLE "chicken_coops" ADD CONSTRAINT "chicken_coops_active_hens_count_non_negative_check" CHECK',
      'ALTER TABLE "egg_collections" ADD CONSTRAINT "egg_collections_counts_non_negative_check" CHECK',
      'ALTER TABLE "egg_collections" ADD CONSTRAINT "egg_collections_at_least_one_egg_check" CHECK',
    ]);
  });

  it('solo agrega: nada destructivo, sin reescribir datos, sin CASCADE en borrado', () => {
    expect(MIGRATION).not.toMatch(
      /DROP\s+(?:TABLE|COLUMN|CONSTRAINT|INDEX)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|INSERT\s+INTO|ON DELETE CASCADE|NOT NULL/i,
    );
  });

  it('los CHECK son exactamente los de conteos no negativos y al menos un huevo', () => {
    expect(MIGRATION.match(/\bCHECK\s*\(/g)).toHaveLength(3);
    expect(MIGRATION).toContain('CHECK ("active_hens_count" >= 0)');
    expect(MIGRATION).toContain('CHECK ("good_eggs_count" >= 0 AND "broken_eggs_count" >= 0)');
    expect(MIGRATION).toContain('CHECK ("good_eggs_count" + "broken_eggs_count" > 0)');
  });

  it('sin URLs ni credenciales', () => {
    expect(MIGRATION).not.toMatch(/postgres(?:ql)?:\/\/|neon\.tech|password/i);
  });
});
