import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName = '20261030140000_news_message_edit_delete';
const sql = readFileSync(
  resolve(__dirname, `../../../prisma/migrations/${migrationName}/migration.sql`),
  'utf-8',
);
const schema = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf-8');

describe(`migración ${migrationName}`, () => {
  it('solo agrega columnas de edición, eliminación lógica y versión, sin tocar filas', () => {
    for (const table of ['news_reports', 'news_replies']) {
      expect(sql).toMatch(
        new RegExp(
          `ALTER TABLE "${table}" ADD COLUMN\\s+"deleted_at" TIMESTAMP\\(3\\),\\s*` +
            `ADD COLUMN\\s+"deleted_by_user_id" UUID,\\s*` +
            `ADD COLUMN\\s+"edited_at" TIMESTAMP\\(3\\),\\s*` +
            `ADD COLUMN\\s+"version" INTEGER NOT NULL DEFAULT 1;`,
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_deleted_by_user_id_fkey" FOREIGN KEY \\("deleted_by_user_id"\\) REFERENCES "users"\\("id"\\) ON DELETE RESTRICT`,
        ),
      );
      expect(sql).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_deleted_consistency_check" CHECK (("deleted_at" IS NULL) = ("deleted_by_user_id" IS NULL));`,
      );
      expect(sql).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_version_check" CHECK ("version" >= 1);`,
      );
    }
    // Sin backfill ni reescritura: ningún UPDATE/DELETE/DROP ni cascadas.
    expect(sql).not.toMatch(
      /\bUPDATE\s+"|DELETE\s+FROM|DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)|TRUNCATE|ON DELETE CASCADE|ALTER COLUMN/i,
    );
  });

  it('la migración anterior de respuestas no cambió', () => {
    const previous = readFileSync(
      resolve(__dirname, '../../../prisma/migrations/20261030130000_news_replies/migration.sql'),
      'utf-8',
    );
    expect(previous).not.toMatch(/deleted_at|edited_at|"version"/);
  });

  it('el modelo Prisma refleja las columnas con FK restrictiva a quien eliminó', () => {
    for (const model of ['NewsReport', 'NewsReply']) {
      const block = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
      expect(block).toMatch(/version\s+Int\s+@default\(1\)/);
      expect(block).toMatch(/editedAt\s+DateTime\?\s+@map\("edited_at"\)/);
      expect(block).toMatch(/deletedAt\s+DateTime\?\s+@map\("deleted_at"\)/);
      expect(block).toMatch(/deletedBy\s+User\?\s+@relation\(.*onDelete: Restrict\)/);
    }
  });
});
