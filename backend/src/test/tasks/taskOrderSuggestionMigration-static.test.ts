import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(
  resolve(
    __dirname,
    '../../../prisma/migrations/20261024120000_task_execution_order_suggested_schedule/migration.sql',
  ),
  'utf-8',
);
/** Solo las sentencias (sin comentarios). */
const STATEMENTS = MIGRATION.split('\n')
  .filter((line) => line.trim() && !line.trim().startsWith('--'))
  .join('\n');

describe('migración task_execution_order_suggested_schedule', () => {
  it('agrega seis columnas SMALLINT nullable a tasks, sin valor por defecto', () => {
    for (const column of [
      'execution_order',
      'suggested_weekday',
      'suggested_first_half_day',
      'suggested_second_half_day',
      'suggested_month_day',
      'suggested_month',
    ]) {
      expect(STATEMENTS).toContain(`ADD COLUMN     "${column}" SMALLINT`);
    }
    expect(STATEMENTS).not.toMatch(/NOT NULL|DEFAULT/i);
  });

  it('siete CHECK: rango del orden, campos por frecuencia y mes+día juntos', () => {
    expect(STATEMENTS.match(/ADD CONSTRAINT/g)).toHaveLength(7);
    expect(STATEMENTS).toContain(`"execution_order" BETWEEN 1 AND 9999`);
    expect(STATEMENTS).toContain(`("suggested_month" IS NULL) = ("suggested_month_day" IS NULL)`);
  });

  it('no convierte, inventa ni borra datos; no toca otras tablas', () => {
    expect(STATEMENTS).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b|TRUNCATE|DROP|CREATE TABLE/i);
    expect(STATEMENTS.match(/ALTER TABLE "(\w+)"/g)?.every((s) => s.includes('"tasks"'))).toBe(
      true,
    );
  });
});
