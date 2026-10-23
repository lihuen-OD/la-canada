import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(resolve(__dirname, `../../../prisma/migrations/${name}/migration.sql`), 'utf-8');
/** Solo las sentencias (sin los comentarios del encabezado). */
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('--'))
    .join('\n')
    .trim();

const ENUM = statements(read('20261023120000_task_frequency_bimonthly_annual'));
const DATE = statements(read('20261023120100_task_one_time_scheduled_date'));
const SCHEMA = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf-8');

describe('migración task_frequency_bimonthly_annual', () => {
  it('solo amplía el enum TaskFrequency con BIMONTHLY y ANNUAL', () => {
    expect(ENUM).toBe(
      [
        `ALTER TYPE "TaskFrequency" ADD VALUE 'BIMONTHLY';`,
        `ALTER TYPE "TaskFrequency" ADD VALUE 'ANNUAL';`,
      ].join('\n'),
    );
    expect(SCHEMA).toMatch(/enum TaskFrequency \{[^}]*\bBIMONTHLY\b[^}]*\bANNUAL\b[^}]*\}/);
  });
});

describe('migración task_one_time_scheduled_date', () => {
  it('agrega dos columnas DATE nullable sin valor por defecto y dos CHECK', () => {
    expect(DATE).toBe(
      [
        'ALTER TABLE "tasks" ADD COLUMN     "scheduled_date" DATE;',
        'ALTER TABLE "task_planning_intervals" ADD COLUMN     "scheduled_date" DATE;',
        `ALTER TABLE "tasks" ADD CONSTRAINT "tasks_scheduled_date_one_time_check" CHECK ("scheduled_date" IS NULL OR "frequency" = 'ONE_TIME');`,
        `ALTER TABLE "task_planning_intervals" ADD CONSTRAINT "task_planning_intervals_scheduled_date_one_time_check" CHECK ("scheduled_date" IS NULL OR "frequency" = 'ONE_TIME');`,
      ].join('\n'),
    );
  });

  it('no usa los valores nuevos del enum en la misma migración en que se agregan', () => {
    expect(DATE).not.toMatch(/BIMONTHLY|ANNUAL/);
  });
});

describe('ninguna de las dos convierte, inventa ni borra datos', () => {
  it.each([ENUM, DATE])('sin UPDATE/INSERT/DELETE/DROP/CREATE TABLE ni DEFAULT', (sql) => {
    expect(sql).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b|TRUNCATE|DROP|CREATE TABLE|DEFAULT/i);
  });
});
