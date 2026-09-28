import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION_DIR = '../../../prisma/migrations/20260928100000_garden_plan_versions';

const sql = readFileSync(resolve(__dirname, MIGRATION_DIR, 'migration.sql'), 'utf-8');
const schema = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf-8');

describe('migración 20260928100000_garden_plan_versions (Etapa 5Y)', () => {
  it('no borra tablas, columnas ni filas y no usa CASCADE al borrar', () => {
    expect(sql).not.toMatch(
      /DROP\s+(?:TABLE|COLUMN|CONSTRAINT|INDEX|TYPE)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|INSERT\s+INTO|ON DELETE CASCADE/i,
    );
    expect(sql).not.toMatch(/postgres(?:ql)?:\/\/|neon\.tech|password/i);
  });

  it('es estrictamente aditiva: solo un valor de enum, una tabla, dos índices y dos FK', () => {
    expect([...sql.matchAll(/CREATE TABLE/g)]).toHaveLength(1);
    expect([...sql.matchAll(/ADD CONSTRAINT/g)]).toHaveLength(2);
    expect([...sql.matchAll(/CREATE (UNIQUE )?INDEX/g)]).toHaveLength(2);
    expect(sql).toMatch(/ALTER TYPE "PhotoCategory" ADD VALUE 'GARDEN_PLAN'/);
  });

  it('crea garden_plan_versions con unicidad de versión y de archivo, y FK RESTRICT', () => {
    expect(sql).toMatch(/CREATE TABLE "garden_plan_versions"/);
    expect(sql).toMatch(/"version_number" INTEGER NOT NULL/);
    expect(sql).toMatch(/"file_asset_id" UUID NOT NULL/);
    expect(sql).toMatch(/"published_by_user_id" UUID NOT NULL/);
    // Las DOS unicidades, no una: el número de versión no puede repetirse y un
    // archivo no puede ser el plano de dos versiones.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "garden_plan_versions_version_number_key" ON "garden_plan_versions"\("version_number"\)/,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "garden_plan_versions_file_asset_id_key" ON "garden_plan_versions"\("file_asset_id"\)/,
    );
    expect([...sql.matchAll(/CREATE UNIQUE INDEX/g)]).toHaveLength(2);
    expect(sql).toMatch(
      /FOREIGN KEY \("file_asset_id"\) REFERENCES "file_assets"\("id"\) ON DELETE RESTRICT/,
    );
    expect(sql).toMatch(
      /FOREIGN KEY \("published_by_user_id"\) REFERENCES "users"\("id"\) ON DELETE RESTRICT/,
    );
  });

  it('no siembra datos ni imágenes: el módulo arranca vacío', () => {
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(sql).not.toMatch(/INSERT INTO/i);
  });

  it('el schema declara el modelo y su relación 1 a 1 sin columna nueva en FileAsset', () => {
    expect(schema).toMatch(/GARDEN_PLAN/);
    expect(schema).toMatch(/model GardenPlanVersion/);
    expect(schema).toMatch(/fileAssetId String\s+@unique @map\("file_asset_id"\) @db\.Uuid/);
    expect(schema).toMatch(/versionNumber Int @unique @map\("version_number"\)/);
    expect(schema).toMatch(/@@map\("garden_plan_versions"\)/);
    // Un solo índice por número de versión: el único ya sirve para el historial
    // en reverso, así que no debe haber un `@@index` redundante.
    expect(schema).not.toMatch(/@@index\(\[versionNumber/);
    // La FK vive en la versión: FileAsset no gana columnas, solo la relación inversa.
    expect(schema).toMatch(/gardenPlanVersion GardenPlanVersion\?/);
    expect(schema).not.toMatch(/garden_plan_version_id/);
  });
});
