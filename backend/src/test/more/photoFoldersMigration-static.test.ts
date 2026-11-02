import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(__dirname, '../../../prisma/migrations');
const migrationName = '20261030150000_photo_folders';
const sql = readFileSync(resolve(migrationsDir, migrationName, 'migration.sql'), 'utf-8');
const schema = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf-8');

describe(`migración ${migrationName}`, () => {
  it('es la última y la única que menciona carpetas de fotos', () => {
    const names = readdirSync(migrationsDir).filter((name) => /^\d{14}_/.test(name));
    expect(names.sort().at(-1)).toBe(migrationName);
    for (const name of names.filter((other) => other !== migrationName)) {
      const previous = readFileSync(resolve(migrationsDir, name, 'migration.sql'), 'utf-8');
      expect(previous).not.toMatch(/photo_folders|"folder_id"/);
    }
  });

  it('crea la tabla vacía y una columna nula en file_assets, sin backfill ni datos', () => {
    expect(sql).toMatch(/ALTER TABLE "file_assets" ADD COLUMN\s+"folder_id" UUID;/);
    expect(sql).toMatch(/CREATE TABLE "photo_folders" \(/);
    expect(sql).not.toMatch(
      /\bUPDATE\s+"|INSERT\s+INTO|DELETE\s+FROM|DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)|TRUNCATE|ON DELETE CASCADE|ON DELETE SET NULL|ALTER COLUMN|SET NOT NULL/i,
    );
  });

  it('nombre único entre las VIGENTES e índice para listar y contar por carpeta', () => {
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "photo_folders_active_name_key" ON "photo_folders"("name_key") WHERE (deleted_at IS NULL);',
    );
    expect(sql).toContain(
      'CREATE INDEX "file_assets_folder_id_status_created_at_idx" ON "file_assets"("folder_id", "status", "created_at");',
    );
  });

  it('todas las FK son RESTRICT: nada se borra en cascada ni pierde su carpeta', () => {
    for (const [table, column, target] of [
      ['file_assets', 'folder_id', 'photo_folders'],
      ['photo_folders', 'created_by_user_id', 'users'],
      ['photo_folders', 'deleted_by_user_id', 'users'],
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_${column}_fkey" FOREIGN KEY \\("${column}"\\) REFERENCES "${target}"\\("id"\\) ON DELETE RESTRICT`,
        ),
      );
    }
  });

  it('CHECK: nombre, versión, eliminación consistente y carpeta solo en fotos confirmadas de la galería', () => {
    expect(sql).toContain(
      'CHECK (char_length("name") BETWEEN 1 AND 80 AND char_length("name_key") >= 1)',
    );
    expect(sql).toContain('"photo_folders_version_check" CHECK ("version" >= 1)');
    expect(sql).toContain(
      '"photo_folders_deleted_consistency_check" CHECK (("deleted_at" IS NULL) = ("deleted_by_user_id" IS NULL))',
    );
    expect(sql).toContain(
      `"file_assets_folder_gallery_check" CHECK ("folder_id" IS NULL OR "category" IN ('TASK_EVIDENCE', 'MEMORY'))`,
    );
    expect(sql).toContain(
      `"file_assets_folder_confirmed_check" CHECK ("folder_id" IS NULL OR "status" IN ('AVAILABLE', 'PENDING_DELETION', 'DELETED'))`,
    );
  });

  it('el modelo Prisma refleja la carpeta opcional con FK restrictiva y el único parcial', () => {
    const fileAsset = schema.match(/model FileAsset \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(fileAsset).toMatch(/folderId\s+String\?\s+@map\("folder_id"\)/);
    expect(fileAsset).toMatch(/folder\s+PhotoFolder\?\s+@relation\(.*onDelete: Restrict\)/);
    expect(fileAsset).toMatch(/@@index\(\[folderId, status, createdAt\]\)/);
    const folder = schema.match(/model PhotoFolder \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(folder).toMatch(
      /@@unique\(\[nameKey\], map: "photo_folders_active_name_key", where: raw\("deleted_at IS NULL"\)\)/,
    );
    expect(folder).toMatch(/createdBy\s+User\s+@relation\(.*onDelete: Restrict\)/);
    expect(folder).toMatch(/deletedBy\s+User\?\s+@relation\(.*onDelete: Restrict\)/);
  });
});
