import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(
  resolve(
    __dirname,
    '../../../prisma/migrations/20261021120000_task_frequency_semi_monthly/migration.sql',
  ),
  'utf-8',
);
const SCHEMA = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf-8');
/** Solo las sentencias (sin los comentarios del encabezado). */
const STATEMENTS = MIGRATION.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .trim();

describe('migración task_frequency_semi_monthly', () => {
  it('solo amplía el enum TaskFrequency con SEMI_MONTHLY', () => {
    expect(STATEMENTS).toBe(`ALTER TYPE "TaskFrequency" ADD VALUE 'SEMI_MONTHLY';`);
    expect(SCHEMA).toMatch(/enum TaskFrequency \{[^}]*\bSEMI_MONTHLY\b[^}]*\}/);
  });

  it('no convierte ni borra datos, no recrea tablas ni agrega columnas', () => {
    expect(STATEMENTS).not.toMatch(
      /UPDATE|DELETE|INSERT|TRUNCATE|DROP|CREATE TABLE|ADD COLUMN|ALTER TABLE/i,
    );
  });
});
