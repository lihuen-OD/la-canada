import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = '../../../prisma/migrations/20260930180000_pet_record_next_due/migration.sql';
const sql = readFileSync(resolve(__dirname, MIGRATION), 'utf-8');

describe('migración 20260930180000_pet_record_next_due (próximas atenciones)', () => {
  it('no borra, no reescribe y no inventa fechas para los registros existentes', () => {
    expect(sql).not.toMatch(
      /DROP\s+(?:TABLE|COLUMN|CONSTRAINT|INDEX|TYPE)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|INSERT\s+INTO|SET NOT NULL|DEFAULT|ON DELETE CASCADE/i,
    );
    expect(sql).not.toMatch(/postgres(?:ql)?:\/\/|neon\.tech|password/i);
  });

  it('dos columnas nullable, índices de consulta, cumplimiento único entre vigentes y CHECK', () => {
    expect(sql).toContain('ADD COLUMN     "fulfills_record_id" UUID');
    expect(sql).toContain('ADD COLUMN     "next_due_date" DATE');
    expect(sql).toContain(
      'CREATE INDEX "animal_medical_records_next_due_date_idx" ON "animal_medical_records"("next_due_date")',
    );
    expect(sql).toContain(
      'CREATE INDEX "animal_medical_records_animal_id_next_due_date_idx" ON "animal_medical_records"("animal_id", "next_due_date")',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "animal_medical_records_active_fulfillment_key" ON "animal_medical_records"("fulfills_record_id") WHERE (voided_at IS NULL)',
    );
    expect(sql).toMatch(
      /FOREIGN KEY \("fulfills_record_id"\) REFERENCES "animal_medical_records"\("id"\) ON DELETE RESTRICT/,
    );
    expect(sql).toContain('CHECK ("next_due_date" IS NULL OR "next_due_date" > "record_date")');
    expect(sql).toContain('CHECK ("next_due_date" IS NULL OR "type" <> \'WEIGHT\')');
    expect(sql).toContain('CHECK ("fulfills_record_id" IS NULL OR "fulfills_record_id" <> "id")');
  });
});
