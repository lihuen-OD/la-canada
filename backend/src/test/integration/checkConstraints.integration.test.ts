import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

/**
 * Prueba, contra Neon real (rama `demo`), que los 5 `CHECK` agregados a mano
 * en `backend/prisma/migrations/20260922174631_init/migration.sql` (ver
 * docs/DATABASE.md, matriz de invariantes) realmente rechazan la fila
 * inválida — no solo que el SQL "se ve bien". Cada caso corre dentro de su
 * propia transacción y siempre termina en `ROLLBACK`, incluso cuando el
 * `INSERT` falla como se espera: no debe quedar ninguna fila de prueba en
 * la base.
 *
 * Fuera de la suite normal (`npm test`) a propósito — requiere `DATABASE_URL`
 * real. Se corre explícitamente con `npm run test:integration`. Ver
 * `vitest.config.mts` (excluye `src/test/integration/**`) y
 * `docs/ARCHITECTURE.md`, "Neon — rama demo".
 */

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)(
  'Restricciones CHECK de la migración inicial — Postgres real, siempre con ROLLBACK',
  () => {
    let client: Client;

    beforeAll(async () => {
      client = new Client({ connectionString: DATABASE_URL });
      await client.connect();
    });

    afterAll(async () => {
      await client.end();
    });

    /** Ejecuta `run` dentro de una transacción y SIEMPRE la revierte al final. */
    async function withRollback(run: () => Promise<void>): Promise<void> {
      await client.query('BEGIN');
      try {
        await run();
      } finally {
        await client.query('ROLLBACK');
      }
    }

    it('stock_items_area_not_both_check rechaza area = BOTH', async () => {
      await withRollback(async () => {
        const category = await client.query(
          `INSERT INTO stock_categories (id, name, area, updated_at)
           VALUES (gen_random_uuid(), 'Categoría de prueba (rollback)', 'BOTH', now())
           RETURNING id`,
        );
        const categoryId = category.rows[0].id as string;

        await expect(
          client.query(
            `INSERT INTO stock_items (id, name, area, category_id, unit, minimum_quantity, updated_at)
             VALUES (gen_random_uuid(), 'Ítem de prueba (rollback)', 'BOTH', $1, 'unidades', 1, now())`,
            [categoryId],
          ),
        ).rejects.toThrow(/stock_items_area_not_both_check/);
      });
    });

    it('users_active_requires_pin_hash_check rechaza status=ACTIVE con pin_hash nulo', async () => {
      // Migración `pin_authentication` (Etapa 3B.2): renombró la columna
      // `password_hash` -> `pin_hash` y, con ella, el constraint (rename
      // seguro, no drop+recreate — ver esa migración). Este test ejercita
      // la restricción real ya renombrada, contra Postgres de verdad.
      await withRollback(async () => {
        await expect(
          client.query(
            `INSERT INTO users (id, username, role, status, pin_hash, updated_at)
             VALUES (gen_random_uuid(), 'usuario-de-prueba-rollback', 'EMPLOYEE', 'ACTIVE', NULL, now())`,
          ),
        ).rejects.toThrow(/users_active_requires_pin_hash_check/);
      });
    });

    it('file_assets_not_task_and_animal_check rechaza task_id y animal_id simultáneos', async () => {
      await withRollback(async () => {
        const employee = await client.query(
          `INSERT INTO employees (id, code, display_name, role, color_hex, updated_at)
           VALUES (gen_random_uuid(), 'empleado-prueba-rollback', 'Empleado de prueba', 'Test', '#000000', now())
           RETURNING id`,
        );
        const task = await client.query(
          `INSERT INTO tasks (id, description, employee_id, frequency, updated_at)
           VALUES (gen_random_uuid(), 'Tarea de prueba (rollback)', $1, 'DAILY', now())
           RETURNING id`,
          [employee.rows[0].id],
        );
        const animalType = await client.query(
          `INSERT INTO animal_types (id, name, updated_at)
           VALUES (gen_random_uuid(), 'Tipo de prueba (rollback)', now())
           RETURNING id`,
        );
        const animal = await client.query(
          `INSERT INTO animals (id, name, animal_type_id, updated_at)
           VALUES (gen_random_uuid(), 'Animal de prueba (rollback)', $1, now())
           RETURNING id`,
          [animalType.rows[0].id],
        );

        await expect(
          client.query(
            `INSERT INTO file_assets
               (id, provider, bucket, object_key, original_filename, mime_type, size_bytes, category, task_id, animal_id, updated_at)
             VALUES
               (gen_random_uuid(), 'NEON_OBJECT_STORAGE', 'la-canada-uploads', 'test/rollback-key', 'foto.jpg', 'image/jpeg', 100, 'TASK_EVIDENCE', $1, $2, now())`,
            [task.rows[0].id, animal.rows[0].id],
          ),
        ).rejects.toThrow(/file_assets_not_task_and_animal_check/);
      });
    });

    it('stock_movements_quantity_positive_check rechaza cantidad <= 0', async () => {
      await withRollback(async () => {
        const category = await client.query(
          `INSERT INTO stock_categories (id, name, area, updated_at)
           VALUES (gen_random_uuid(), 'Categoría de prueba (rollback 2)', 'HOUSE', now())
           RETURNING id`,
        );
        const item = await client.query(
          `INSERT INTO stock_items (id, name, area, category_id, unit, minimum_quantity, updated_at)
           VALUES (gen_random_uuid(), 'Ítem de prueba (rollback 2)', 'HOUSE', $1, 'unidades', 1, now())
           RETURNING id`,
          [category.rows[0].id],
        );

        await expect(
          client.query(
            `INSERT INTO stock_movements (id, stock_item_id, type, quantity, effective_date, updated_at)
             VALUES (gen_random_uuid(), $1, 'OPENING_BALANCE', 0, now(), now())`,
            [item.rows[0].id],
          ),
        ).rejects.toThrow(/stock_movements_quantity_positive_check/);
      });
    });

    it('file_assets_size_bytes_non_negative_check rechaza size_bytes negativo', async () => {
      await withRollback(async () => {
        await expect(
          client.query(
            `INSERT INTO file_assets
               (id, provider, bucket, object_key, original_filename, mime_type, size_bytes, category, updated_at)
             VALUES
               (gen_random_uuid(), 'NEON_OBJECT_STORAGE', 'la-canada-uploads', 'test/rollback-key-2', 'foto.jpg', 'image/jpeg', -1, 'MEMORY', now())`,
          ),
        ).rejects.toThrow(/file_assets_size_bytes_non_negative_check/);
      });
    });
  },
);
