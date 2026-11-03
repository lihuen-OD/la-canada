import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf-8');
const NAME = '20261102120000_kitchen_garden_crops';
const MIGRATION = read(`prisma/migrations/${NAME}/migration.sql`);
/** Solo las sentencias (sin comentarios). */
const STATEMENTS = MIGRATION.split('\n')
  .filter((line) => line.trim() && !line.trim().startsWith('--'))
  .join('\n');
const TABLES = ['kitchen_garden_crops', 'kitchen_garden_batches', 'kitchen_garden_crop_records'];

/**
 * Aplicada en `demo` el 2026-11-02 y sin modificar desde entonces (su checksum
 * tiene que seguir coincidiendo). El diseño de Cultivos y tandas se reemplazó
 * por 📝 Registros (`20261102180000_kitchen_garden_activity_kind_notes`): sus
 * tablas siguen existiendo, sin uso desde la aplicación.
 */
describe('migración kitchen_garden_crops (tablas de cultivos, hoy sin uso)', () => {
  it('existe, es la única que crea esas tablas y solo agrega: tres tipos y tres tablas nuevas', () => {
    const migrations = readdirSync(resolve(ROOT, 'prisma/migrations')).filter((entry) =>
      /^\d{14}_/.test(entry),
    );
    expect(migrations).toContain(NAME);
    const creators = migrations.filter((entry) =>
      read(`prisma/migrations/${entry}/migration.sql`).includes(
        'CREATE TABLE "kitchen_garden_crops"',
      ),
    );
    expect(creators).toEqual([NAME]);
    const created = [...STATEMENTS.matchAll(/CREATE TABLE "(\w+)"/g)].map((match) => match[1]);
    expect(created.sort()).toEqual([...TABLES].sort());
    const types = [...STATEMENTS.matchAll(/CREATE TYPE "(\w+)"/g)].map((match) => match[1]);
    expect(types.sort()).toEqual([
      'KitchenGardenCropRecordType',
      'KitchenGardenQuantityUnit',
      'KitchenGardenSowingMethod',
    ]);
  });

  it('no altera, convierte ni siembra datos existentes (ni actividades de la Huerta)', () => {
    expect(STATEMENTS).not.toMatch(/^\s*(UPDATE|INSERT|DELETE|TRUNCATE|DROP)\b|ALTER TYPE/im);
    const altered = [...STATEMENTS.matchAll(/ALTER TABLE "(\w+)"/g)].map((match) => match[1]);
    expect(altered.length).toBeGreaterThan(0);
    expect(altered.every((table) => TABLES.includes(table!))).toBe(true);
    expect(STATEMENTS).not.toMatch(/"kitchen_garden_activities"|"kitchen_garden_executions"/);
  });

  it('una sola siembra vigente por tanda y un cultivo por nombre normalizado', () => {
    expect(STATEMENTS).toContain(
      `CREATE UNIQUE INDEX "kitchen_garden_crop_records_active_sowing_key" ON "kitchen_garden_crop_records"("batch_id") WHERE (type = 'SOWING' AND voided_at IS NULL);`,
    );
    expect(STATEMENTS).toContain(
      'CREATE UNIQUE INDEX "kitchen_garden_crops_name_key_key" ON "kitchen_garden_crops"("name_key");',
    );
    expect(STATEMENTS).toContain('ON "kitchen_garden_crop_records"("performed_on", "created_at")');
  });

  it('claves foráneas RESTRICT (nada se borra en cascada) y los CHECK de coherencia', () => {
    const foreignKeys = STATEMENTS.match(/FOREIGN KEY[^;]+;/g) ?? [];
    expect(foreignKeys).toHaveLength(9);
    expect(foreignKeys.every((fk) => fk.includes('ON DELETE RESTRICT'))).toBe(true);
    expect(STATEMENTS.match(/ADD CONSTRAINT "\w+_check"/g)).toHaveLength(21);
    // Semillas o gramos en la siembra, plantines en el trasplante: nunca se mezclan.
    expect(STATEMENTS).toContain(
      `("type" = 'SOWING' AND "quantity_unit" IN ('SEEDS', 'GRAMS')) OR ("type" = 'TRANSPLANT' AND "quantity_unit" = 'SEEDLINGS')`,
    );
    expect(STATEMENTS).toContain(`CHECK (("type" = 'SOWING') = ("method" IS NOT NULL))`);
    expect(STATEMENTS).toContain(
      `CHECK ("expected_transplant_date" IS NULL OR "transplant_pending")`,
    );
    expect(STATEMENTS).toContain(`CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL))`);
  });
});

describe('aislamiento: nada de la aplicación lee ni escribe las tablas de cultivos', () => {
  it.each([
    'src/tasks/tasksService.ts',
    'src/performance/performanceService.ts',
    'src/dashboard/dashboardService.ts',
    'src/kitchenGarden/gardenActivitiesService.ts',
    'src/kitchenGarden/gardenPerformanceService.ts',
    'src/kitchenGarden/gardenParticipants.ts',
    'src/controllers/kitchenGardenController.ts',
  ])('%s no usa las tablas de cultivos', (path) => {
    expect(read(path)).not.toMatch(/kitchenGardenBatch|kitchenGardenCrop|gardenCrops/);
  });
});
