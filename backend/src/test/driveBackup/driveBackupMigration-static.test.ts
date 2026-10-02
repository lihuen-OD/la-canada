import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION_DIR = '../../../prisma/migrations/20261002120000_drive_photo_backup';

const sql = readFileSync(resolve(__dirname, MIGRATION_DIR, 'migration.sql'), 'utf-8');

describe('migración 20261002120000_drive_photo_backup (Etapa 5Z)', () => {
  it('es aditiva: no borra, no reescribe datos, no toca tablas existentes ni usa CASCADE al borrar', () => {
    expect(sql).not.toMatch(
      /DROP\s+(?:TABLE|COLUMN|CONSTRAINT|INDEX|TYPE)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|INSERT\s+INTO|ON DELETE CASCADE/i,
    );
    expect(sql).not.toMatch(/ALTER TABLE "(?!drive_backup_)/);
    expect(sql).not.toMatch(/ALTER TYPE/);
    expect(sql).not.toMatch(/postgres(?:ql)?:\/\/|neon\.tech|password|private_key|googleapis/i);
  });

  it('crea solo las dos tablas de la cola, sin carga histórica', () => {
    expect([...sql.matchAll(/CREATE TABLE/g)]).toHaveLength(2);
    expect(sql).toMatch(/CREATE TABLE "drive_backup_jobs"/);
    expect(sql).toMatch(/CREATE TABLE "drive_backup_folders"/);
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('garantiza una copia por archivo, un ID remoto único y la FK RESTRICT', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX "drive_backup_jobs_file_asset_id_key"/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX "drive_backup_jobs_remote_file_id_key"/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX "drive_backup_folders_remote_folder_id_key"/);
    expect(sql).toMatch(/"drive_backup_folders_pkey" PRIMARY KEY \("path"\)/);
    expect(sql).toMatch(/CREATE INDEX "drive_backup_jobs_status_next_attempt_at_idx"/);
    expect(sql).toMatch(
      /FOREIGN KEY \("file_asset_id"\) REFERENCES "file_assets"\("id"\) ON DELETE RESTRICT/,
    );
  });

  it('CHECK de intentos, módulos permitidos, reclamo y cierre completo', () => {
    expect(sql).toMatch(/CHECK \("attempts" >= 0\)/);
    expect(sql).toMatch(/CHECK \("module" IN \('fotos', 'mascotas'\)\)/);
    expect(sql).toMatch(/"drive_backup_jobs_claim_check"/);
    expect(sql).toMatch(/"drive_backup_jobs_completed_check"/);
  });
});
