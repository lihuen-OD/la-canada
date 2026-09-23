import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Aserciones estructurales sobre la migración inicial ya generada y
 * aplicada a `demo` (`20260922174631_init`), leída como texto — no
 * requieren conexión a Neon. Complementan la verificación en vivo hecha al
 * aplicar la migración (ver docs/MIGRATION_PLAN.md, "Etapa 3A").
 */

const MIGRATION_SQL = readFileSync(
  resolve(__dirname, '../../prisma/migrations/20260922174631_init/migration.sql'),
  'utf-8',
);

describe('Migración inicial — conteos esperados', () => {
  it('crea exactamente 22 tablas', () => {
    const tables = MIGRATION_SQL.match(/^CREATE TABLE "\w+"/gm) ?? [];
    expect(tables).toHaveLength(22);
  });

  it('crea exactamente 11 enums', () => {
    const enums = MIGRATION_SQL.match(/^CREATE TYPE "\w+" AS ENUM/gm) ?? [];
    expect(enums).toHaveLength(11);
  });

  it('file_assets tiene la restricción única compuesta (bucket, object_key)', () => {
    expect(MIGRATION_SQL).toMatch(
      /CREATE UNIQUE INDEX "file_assets_bucket_object_key_key" ON "file_assets"\("bucket", "object_key"\)/,
    );
  });

  it('ninguna FK usa ON DELETE CASCADE (no debe poder borrarse en cascada historial dependiente)', () => {
    expect(MIGRATION_SQL).not.toMatch(/ON DELETE CASCADE/);
  });
});

describe('Migración inicial — CHECK constraints agregados a mano (docs/DATABASE.md, matriz de invariantes)', () => {
  it('StockItem.area nunca BOTH (fila 1)', () => {
    expect(MIGRATION_SQL).toMatch(
      /ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_area_not_both_check" CHECK \("area" != 'BOTH'\)/,
    );
  });

  it('User.status = ACTIVE ⇒ password_hash no nulo (fila 3)', () => {
    expect(MIGRATION_SQL).toMatch(/users_active_requires_password_hash_check/);
    expect(MIGRATION_SQL).toMatch(/"status" != 'ACTIVE' OR "password_hash" IS NOT NULL/);
  });

  it('FileAsset no vinculado simultáneamente a task_id y animal_id (fila 4)', () => {
    expect(MIGRATION_SQL).toMatch(/file_assets_not_task_and_animal_check/);
    expect(MIGRATION_SQL).toMatch(/NOT \("task_id" IS NOT NULL AND "animal_id" IS NOT NULL\)/);
  });

  it('StockMovement.quantity siempre positiva (fila 5)', () => {
    expect(MIGRATION_SQL).toMatch(
      /ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_positive_check" CHECK \("quantity" > 0\)/,
    );
  });

  it('FileAsset.sizeBytes nunca negativo (fila 13)', () => {
    expect(MIGRATION_SQL).toMatch(
      /ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_size_bytes_non_negative_check" CHECK \("size_bytes" >= 0\)/,
    );
  });

  it('exactamente 5 CHECK constraints — ni más ni menos que las filas aprobadas de la matriz', () => {
    const checks = MIGRATION_SQL.match(/ADD CONSTRAINT "\w+_check" CHECK/g) ?? [];
    expect(checks).toHaveLength(5);
  });
});
