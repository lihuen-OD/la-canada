import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(
  resolve(
    __dirname,
    '../../../prisma/migrations/20260925180000_pets_medical_voiding/migration.sql',
  ),
  'utf-8',
);

describe('migración pets_medical_voiding (Etapa 5M)', () => {
  const statements = MIGRATION.split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  it('contiene exactamente las 7 sentencias aprobadas', () => {
    expect(statements.map((s) => s.split(' (')[0]?.split(' ON ')[0])).toEqual([
      'ALTER TYPE "PhotoCategory" ADD VALUE \'ANIMAL_PROFILE\'',
      'ALTER TABLE "animal_medical_records" ADD COLUMN "recorded_by_user_id" UUID, ADD COLUMN "voided_at" TIMESTAMP(3), ADD COLUMN "voided_by_user_id" UUID',
      'CREATE INDEX "animal_medical_records_animal_id_record_date_idx"',
      'ALTER TABLE "animal_medical_records" ADD CONSTRAINT "animal_medical_records_recorded_by_user_id_fkey" FOREIGN KEY',
      'ALTER TABLE "animal_medical_records" ADD CONSTRAINT "animal_medical_records_voided_by_user_id_fkey" FOREIGN KEY',
      'ALTER TABLE "animal_medical_records" ADD CONSTRAINT "animal_medical_records_weight_value_check" CHECK',
      'ALTER TABLE "animal_medical_records" ADD CONSTRAINT "animal_medical_records_value_positive_check" CHECK',
    ]);
  });

  it('solo agrega: nada destructivo, sin reescribir datos, sin CASCADE ni NOT NULL', () => {
    expect(MIGRATION).not.toMatch(
      /DROP\s+(?:TABLE|COLUMN|CONSTRAINT|INDEX|TYPE)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|INSERT\s+INTO|ON DELETE CASCADE/i,
    );
    // Columnas nuevas nullable: ninguna exige backfill.
    expect(statements[1]).not.toMatch(/NOT NULL/);
    expect(MIGRATION).not.toMatch(/postgres(?:ql)?:\/\/|neon\.tech|password/i);
  });

  it('CHECK del peso: solo WEIGHT tiene valor, y siempre positivo', () => {
    expect(MIGRATION).toContain('CHECK (("type" = \'WEIGHT\') = ("value" IS NOT NULL))');
    expect(MIGRATION).toContain('CHECK ("value" IS NULL OR "value" > 0)');
  });
});
