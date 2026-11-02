import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName = '20261030130000_news_replies';
const sql = readFileSync(
  resolve(__dirname, `../../../prisma/migrations/${migrationName}/migration.sql`),
  'utf-8',
);
const schema = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf-8');

describe(`migración ${migrationName}`, () => {
  it('solo crea la tabla de respuestas, sus índices y claves restrictivas', () => {
    expect(sql).toMatch(/CREATE TABLE "news_replies"/);
    expect(sql).toMatch(/news_report_id" UUID NOT NULL/);
    expect(sql).toMatch(/author_user_id" UUID NOT NULL/);
    expect(sql).toMatch(/created_at" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(sql).toMatch(/quoted_reply_id" UUID/);
    expect(sql).toMatch(/news_replies_news_report_id_created_at_id_idx/);
    expect(sql).toMatch(/FOREIGN KEY \("news_report_id"\).*ON DELETE RESTRICT/);
    expect(sql).toMatch(/FOREIGN KEY \("author_user_id"\).*ON DELETE RESTRICT/);
    expect(sql).toMatch(
      /FOREIGN KEY \("quoted_reply_id", "news_report_id"\).*REFERENCES "news_replies"\("id", "news_report_id"\).*ON DELETE RESTRICT/,
    );
    expect(sql).not.toMatch(
      /DROP\s+(TABLE|COLUMN|INDEX)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"news_reports"|ON DELETE CASCADE/i,
    );
  });

  it('el modelo Prisma conserva la cita dentro de la misma novedad', () => {
    const block = schema.match(/model NewsReply \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(block).toMatch(/@@unique\(\[id, newsReportId\]\)/);
    expect(block).toMatch(/references: \[id, newsReportId\], onDelete: Restrict/);
    expect(block).toMatch(/@@index\(\[newsReportId, createdAt, id\]\)/);
  });
});
