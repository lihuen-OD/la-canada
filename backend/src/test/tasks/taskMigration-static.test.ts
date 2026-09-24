import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(
  resolve(
    __dirname,
    '../../../prisma/migrations/20260924120000_task_execution_reversal/migration.sql',
  ),
  'utf-8',
);
const SCHEMA = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf-8');

describe('migración task_execution_reversal (Etapa 4A)', () => {
  it('la unicidad por tarea+período pasa a ser parcial: solo ejecuciones no revertidas', () => {
    expect(MIGRATION).toMatch(
      /CREATE UNIQUE INDEX "task_executions_task_id_period_key_key" ON "task_executions"\("task_id", "period_key"\) WHERE \(reverted_at IS NULL\);/,
    );
    expect(SCHEMA).toMatch(
      /@@unique\(\[taskId, periodKey\], where: raw\("reverted_at IS NULL"\)\)/,
    );
  });

  it('no borra datos: sin DROP TABLE/COLUMN, sin DELETE, sin CASCADE', () => {
    expect(MIGRATION).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE|ON DELETE CASCADE/i);
  });

  it('agrega los 3 CHECK de coherencia de reversión', () => {
    expect(MIGRATION).toMatch(/CHECK \("completed" = \("reverted_at" IS NULL\)\)/);
    expect(MIGRATION).toMatch(
      /CHECK \(\("reverted_at" IS NULL\) = \("reverted_by_user_id" IS NULL\)\)/,
    );
    expect(MIGRATION).toMatch(
      /CHECK \("completed_at" IS NOT NULL AND "completed_by_employee_id" IS NOT NULL\)/,
    );
  });
});
