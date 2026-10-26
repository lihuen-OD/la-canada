import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf-8');
const MIGRATION = read('prisma/migrations/20261027120000_kitchen_garden_module/migration.sql');
/** Solo las sentencias (sin comentarios). */
const STATEMENTS = MIGRATION.split('\n')
  .filter((line) => line.trim() && !line.trim().startsWith('--'))
  .join('\n');
const TABLES = [
  'kitchen_garden_participants',
  'kitchen_garden_activities',
  'kitchen_garden_planning_intervals',
  'kitchen_garden_executions',
];

describe('migración kitchen_garden_module (🥬 Huerta)', () => {
  it('crea solo las cuatro tablas propias de la Huerta', () => {
    const created = [...STATEMENTS.matchAll(/CREATE TABLE "(\w+)"/g)].map((match) => match[1]);
    expect(created.sort()).toEqual([...TABLES].sort());
  });

  it('no altera, convierte ni siembra datos de otras tablas (Tareas, usuarios, empleados)', () => {
    expect(STATEMENTS).not.toMatch(/^\s*(UPDATE|INSERT|DELETE|TRUNCATE|DROP)\b|ALTER TYPE/im);
    const altered = [...STATEMENTS.matchAll(/ALTER TABLE "(\w+)"/g)].map((match) => match[1]);
    expect(altered.length).toBeGreaterThan(0);
    expect(altered.every((table) => TABLES.includes(table!))).toBe(true);
    expect(STATEMENTS).not.toMatch(/"tasks"\s*\(|"task_executions"\s*\(|"task_planning_intervals"/);
  });

  it('una sola ejecución vigente por actividad y período, y una planificación abierta por actividad', () => {
    expect(STATEMENTS).toContain(
      'CREATE UNIQUE INDEX "kitchen_garden_executions_activity_id_period_key_key" ON "kitchen_garden_executions"("activity_id", "period_key") WHERE (reverted_at IS NULL);',
    );
    expect(STATEMENTS).toContain(
      'CREATE UNIQUE INDEX "kitchen_garden_planning_intervals_one_open_per_activity" ON "kitchen_garden_planning_intervals"("activity_id") WHERE (valid_to IS NULL);',
    );
    expect(STATEMENTS).toContain(
      'CREATE UNIQUE INDEX "kitchen_garden_participants_user_id_key" ON "kitchen_garden_participants"("user_id");',
    );
  });

  it('claves foráneas RESTRICT (nada se borra en cascada) y los CHECK de Tareas', () => {
    const foreignKeys = STATEMENTS.match(/FOREIGN KEY[^;]+;/g) ?? [];
    expect(foreignKeys).toHaveLength(9);
    expect(foreignKeys.every((fk) => fk.includes('ON DELETE RESTRICT'))).toBe(true);
    expect(STATEMENTS.match(/ADD CONSTRAINT "\w+_check"/g)).toHaveLength(12);
    expect(STATEMENTS).toContain(`CHECK ("completed" = ("reverted_at" IS NULL))`);
    expect(STATEMENTS).toContain(`CHECK ("scheduled_date" IS NULL OR "frequency" = 'ONE_TIME')`);
    expect(STATEMENTS).toContain(`"execution_order" BETWEEN 1 AND 9999`);
  });
});

describe('aislamiento estático: Tareas, Desempeño general e Inicio no leen la Huerta', () => {
  it.each([
    'src/tasks/tasksService.ts',
    'src/performance/performanceService.ts',
    'src/dashboard/dashboardService.ts',
    'src/controllers/tasksController.ts',
    'src/controllers/performanceController.ts',
    'src/controllers/dashboardController.ts',
  ])('%s no menciona kitchenGarden', (path) => {
    expect(read(path)).not.toMatch(/kitchenGarden|kitchen_garden/i);
  });
});
