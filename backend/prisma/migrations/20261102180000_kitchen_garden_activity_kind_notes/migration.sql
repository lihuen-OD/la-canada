-- 🥬 Huerta — 📝 Registros (2026-11-02): tipo, observaciones y versión de
-- las actividades existentes. Solo AGREGA: un tipo enumerado y tres columnas
-- en "kitchen_garden_activities". No convierte, completa ni borra nada:
--   * "kind" y "notes" quedan NULL en las filas existentes («Sin clasificar»,
--     sin observaciones; el tipo nunca se deduce de la descripción).
--   * "version" toma el DEFAULT 1 (agregar una columna con un DEFAULT
--     constante no reescribe filas ni ejecuta UPDATE).
-- Ids, responsables, frecuencias, fechas, planificación (versiones) y
-- ejecuciones no se tocan. Las tablas de cultivos de la migración
-- 20261102120000_kitchen_garden_crops siguen existiendo, sin uso.

-- CreateEnum
CREATE TYPE "KitchenGardenActivityKind" AS ENUM ('SOWING', 'TRANSPLANT', 'OTHER');

-- AlterTable
ALTER TABLE "kitchen_garden_activities" ADD COLUMN     "kind" "KitchenGardenActivityKind",
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- Coherencia (Prisma no modela CHECK): observaciones normalizadas por el
-- backend (1–500 caracteres o NULL) y versión positiva.
ALTER TABLE "kitchen_garden_activities" ADD CONSTRAINT "kitchen_garden_activities_notes_check" CHECK ("notes" IS NULL OR char_length("notes") BETWEEN 1 AND 500);
ALTER TABLE "kitchen_garden_activities" ADD CONSTRAINT "kitchen_garden_activities_version_check" CHECK ("version" >= 1);
