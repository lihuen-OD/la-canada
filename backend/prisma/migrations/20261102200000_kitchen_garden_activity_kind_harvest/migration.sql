-- 🥬 Huerta — 📝 Registros: nuevo tipo «Cosecha» (`HARVEST`) del enum
-- `KitchenGardenActivityKind`. Generada OFFLINE con `prisma migrate diff
-- --from-schema <antes> --to-schema <ahora>` y revisada a mano. Solo AMPLÍA
-- el enum: no toca tablas ni filas, no reclasifica actividades (ninguna pasa
-- a cosecha) y no modifica la migración anterior del tipo
-- (20261102180000_kitchen_garden_activity_kind_notes, ya aplicada en demo).
-- El código anterior nunca envía ni lee este valor.

-- AlterEnum
ALTER TYPE "KitchenGardenActivityKind" ADD VALUE 'HARVEST';
