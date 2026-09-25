import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(__dirname, '../../../prisma/migrations/20260925200000_more_module/migration.sql'),
  'utf-8',
);
const schema = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf-8');

describe('migración 20260925200000_more_module (Etapa 5X)', () => {
  it('no borra tablas, columnas ni filas', () => {
    expect(sql).not.toMatch(
      /DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN|CASCADE\b(?!;)/i,
    );
    expect(sql).not.toMatch(/ON DELETE CASCADE/);
  });

  it('solo reemplaza dos índices únicos: novedades sin unicidad y eventos con unicidad parcial', () => {
    expect([...sql.matchAll(/DROP INDEX/g)]).toHaveLength(2);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "events_title_date_type_key" ON "events"\("title", "date", "type"\) WHERE \(deleted_at IS NULL\)/,
    );
    expect(schema).toMatch(/@@unique\(\[title, date, type\], where: raw\("deleted_at IS NULL"\)\)/);
    expect(schema).not.toMatch(/@@unique\(\[employeeId, text\]\)/);
  });

  it('agrega actor, anulación, título de foto, índices y el CHECK de anulación', () => {
    expect(sql).toMatch(/ADD COLUMN\s+"recorded_by_user_id" UUID/);
    expect(sql).toMatch(/ADD COLUMN\s+"deleted_at" TIMESTAMP\(3\)/);
    expect(sql).toMatch(/"file_assets" ADD COLUMN\s+"title" TEXT/);
    expect(sql).toMatch(/file_assets_category_status_created_at_idx/);
    expect(sql).toMatch(/events_deleted_consistency_check/);
  });
});
