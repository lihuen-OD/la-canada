import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(
  resolve(
    __dirname,
    '../../../prisma/migrations/20261030120000_task_execution_performed_on/migration.sql',
  ),
  'utf-8',
);
const SCHEMA = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf-8');
/** Solo las sentencias (sin comentarios). */
const STATEMENTS = MIGRATION.split('\n')
  .filter((line) => line.trim() && !line.trim().startsWith('--'))
  .join('\n');

describe('migración task_execution_performed_on (carga olvidada)', () => {
  it('agrega una sola columna DATE nullable, sin valor por defecto', () => {
    expect(STATEMENTS).toContain(
      'ALTER TABLE "task_executions" ADD COLUMN     "performed_on" DATE;',
    );
    expect(STATEMENTS).not.toMatch(/NOT NULL|DEFAULT/i);
    expect(SCHEMA).toMatch(/performedOn DateTime\? @map\("performed_on"\) @db\.Date/);
  });

  it('un CHECK independiente de la zona: la fecha real nunca es posterior al registro', () => {
    expect(STATEMENTS.match(/ADD CONSTRAINT/g)).toHaveLength(1);
    expect(STATEMENTS).toContain(
      `CHECK ("performed_on" IS NULL OR "performed_on" <= ("completed_at" + INTERVAL '14 hours')::date)`,
    );
  });

  it('no inventa, convierte ni borra datos; solo toca task_executions', () => {
    expect(STATEMENTS).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b|TRUNCATE|DROP|CREATE TABLE/i);
    expect(
      STATEMENTS.match(/ALTER TABLE "(\w+)"/g)?.every((s) => s.includes('"task_executions"')),
    ).toBe(true);
  });
});
