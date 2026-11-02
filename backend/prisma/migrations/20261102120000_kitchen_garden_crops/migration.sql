-- 🥬 Huerta — cultivos y registros (2026-11-02): cultivos, tandas (una siembra
-- concreta cada una) y sus hechos (siembra y trasplantes), en tablas
-- `kitchen_garden_*` NUEVAS. Solo AGREGA: tres tipos enum, tres tablas, sus
-- índices, FK RESTRICT y CHECK. No altera ninguna tabla existente (las FK son
-- de las tablas nuevas hacia `users` y `kitchen_garden_participants`), no
-- convierte actividades en cultivos y no inserta filas: el módulo arranca sin
-- cultivos.
-- Generada OFFLINE con `prisma migrate diff --from-schema <antes> --to-schema <ahora> --script`
-- y revisada a mano; los CHECK (que Prisma no declara) se agregan al final.
-- Se aplica PRIMERO a una rama de Neon aislada para este desarrollo; queda
-- pendiente para `demo` y para `production` (con autorización propia).
-- CreateEnum
CREATE TYPE "KitchenGardenSowingMethod" AS ENUM ('DIRECT', 'SEEDBED');

-- CreateEnum
CREATE TYPE "KitchenGardenCropRecordType" AS ENUM ('SOWING', 'TRANSPLANT');

-- CreateEnum
CREATE TYPE "KitchenGardenQuantityUnit" AS ENUM ('SEEDS', 'GRAMS', 'SEEDLINGS');

-- CreateTable
CREATE TABLE "kitchen_garden_crops" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kitchen_garden_crops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_garden_batches" (
    "id" UUID NOT NULL,
    "crop_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "variety" TEXT,
    "notes" TEXT,
    "transplant_pending" BOOLEAN NOT NULL DEFAULT false,
    "expected_transplant_date" DATE,
    "transplants_closed_at" TIMESTAMP(3),
    "transplants_closed_by_user_id" UUID,
    "archived_at" TIMESTAMP(3),
    "archived_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kitchen_garden_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_garden_crop_records" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "type" "KitchenGardenCropRecordType" NOT NULL,
    "performed_on" DATE NOT NULL,
    "performed_by_participant_id" UUID NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "method" "KitchenGardenSowingMethod",
    "location" TEXT NOT NULL,
    "quantity" DECIMAL(10,2),
    "quantity_unit" "KitchenGardenQuantityUnit",
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "voided_at" TIMESTAMP(3),
    "voided_by_user_id" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kitchen_garden_crop_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_garden_crops_name_key_key" ON "kitchen_garden_crops"("name_key");

-- CreateIndex
CREATE INDEX "kitchen_garden_batches_crop_id_idx" ON "kitchen_garden_batches"("crop_id");

-- CreateIndex
CREATE INDEX "kitchen_garden_batches_archived_at_expected_transplant_date_idx" ON "kitchen_garden_batches"("archived_at", "expected_transplant_date");

-- CreateIndex
CREATE INDEX "kitchen_garden_crop_records_batch_id_performed_on_idx" ON "kitchen_garden_crop_records"("batch_id", "performed_on");

-- CreateIndex
CREATE INDEX "kitchen_garden_crop_records_performed_on_created_at_idx" ON "kitchen_garden_crop_records"("performed_on", "created_at");

-- CreateIndex
CREATE INDEX "kitchen_garden_crop_records_performed_by_participant_id_per_idx" ON "kitchen_garden_crop_records"("performed_by_participant_id", "performed_on");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_garden_crop_records_active_sowing_key" ON "kitchen_garden_crop_records"("batch_id") WHERE (type = 'SOWING' AND voided_at IS NULL);

-- AddForeignKey
ALTER TABLE "kitchen_garden_crops" ADD CONSTRAINT "kitchen_garden_crops_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_batches" ADD CONSTRAINT "kitchen_garden_batches_crop_id_fkey" FOREIGN KEY ("crop_id") REFERENCES "kitchen_garden_crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_batches" ADD CONSTRAINT "kitchen_garden_batches_transplants_closed_by_user_id_fkey" FOREIGN KEY ("transplants_closed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_batches" ADD CONSTRAINT "kitchen_garden_batches_archived_by_user_id_fkey" FOREIGN KEY ("archived_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_batches" ADD CONSTRAINT "kitchen_garden_batches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_crop_records" ADD CONSTRAINT "kitchen_garden_crop_records_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "kitchen_garden_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_crop_records" ADD CONSTRAINT "kitchen_garden_crop_records_performed_by_participant_id_fkey" FOREIGN KEY ("performed_by_participant_id") REFERENCES "kitchen_garden_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_crop_records" ADD CONSTRAINT "kitchen_garden_crop_records_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_crop_records" ADD CONSTRAINT "kitchen_garden_crop_records_voided_by_user_id_fkey" FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── CHECK de coherencia (agregados a mano: Prisma no los declara) ─────────

-- Cultivos
ALTER TABLE "kitchen_garden_crops" ADD CONSTRAINT "kitchen_garden_crops_name_length_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 60);
ALTER TABLE "kitchen_garden_crops" ADD CONSTRAINT "kitchen_garden_crops_name_key_check" CHECK ("name_key" = lower("name_key") AND char_length("name_key") BETWEEN 1 AND 60);

-- Tandas
ALTER TABLE "kitchen_garden_batches" ADD CONSTRAINT "kitchen_garden_batches_name_length_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 80);
ALTER TABLE "kitchen_garden_batches" ADD CONSTRAINT "kitchen_garden_batches_variety_length_check" CHECK ("variety" IS NULL OR char_length(btrim("variety")) BETWEEN 1 AND 80);
ALTER TABLE "kitchen_garden_batches" ADD CONSTRAINT "kitchen_garden_batches_notes_length_check" CHECK ("notes" IS NULL OR char_length(btrim("notes")) BETWEEN 1 AND 500);
ALTER TABLE "kitchen_garden_batches" ADD CONSTRAINT "kitchen_garden_batches_version_check" CHECK ("version" >= 1);
-- La fecha prevista solo existe mientras quedan trasplantes pendientes.
ALTER TABLE "kitchen_garden_batches" ADD CONSTRAINT "kitchen_garden_batches_expected_date_pending_check" CHECK ("expected_transplant_date" IS NULL OR "transplant_pending");
-- «No quedan trasplantes pendientes»: quién y cuándo, siempre juntos y nunca con pendientes.
ALTER TABLE "kitchen_garden_batches" ADD CONSTRAINT "kitchen_garden_batches_closed_by_iff_closed_at_check" CHECK (("transplants_closed_at" IS NULL) = ("transplants_closed_by_user_id" IS NULL));
ALTER TABLE "kitchen_garden_batches" ADD CONSTRAINT "kitchen_garden_batches_closed_not_pending_check" CHECK ("transplants_closed_at" IS NULL OR NOT "transplant_pending");
ALTER TABLE "kitchen_garden_batches" ADD CONSTRAINT "kitchen_garden_batches_archived_by_iff_archived_at_check" CHECK (("archived_at" IS NULL) = ("archived_by_user_id" IS NULL));

-- Registros (siembra y trasplantes)
ALTER TABLE "kitchen_garden_crop_records" ADD CONSTRAINT "kitchen_garden_crop_records_method_sowing_check" CHECK (("type" = 'SOWING') = ("method" IS NOT NULL));
ALTER TABLE "kitchen_garden_crop_records" ADD CONSTRAINT "kitchen_garden_crop_records_location_length_check" CHECK (char_length(btrim("location")) BETWEEN 1 AND 120);
ALTER TABLE "kitchen_garden_crop_records" ADD CONSTRAINT "kitchen_garden_crop_records_notes_length_check" CHECK ("notes" IS NULL OR char_length(btrim("notes")) BETWEEN 1 AND 500);
-- Cantidad opcional, siempre con su unidad explícita y positiva.
ALTER TABLE "kitchen_garden_crop_records" ADD CONSTRAINT "kitchen_garden_crop_records_quantity_unit_pair_check" CHECK (("quantity" IS NULL) = ("quantity_unit" IS NULL));
ALTER TABLE "kitchen_garden_crop_records" ADD CONSTRAINT "kitchen_garden_crop_records_quantity_positive_check" CHECK ("quantity" IS NULL OR "quantity" > 0);
-- Semillas o gramos en la siembra; plantines en el trasplante: nunca se mezclan.
ALTER TABLE "kitchen_garden_crop_records" ADD CONSTRAINT "kitchen_garden_crop_records_quantity_unit_type_check" CHECK ("quantity_unit" IS NULL OR ("type" = 'SOWING' AND "quantity_unit" IN ('SEEDS', 'GRAMS')) OR ("type" = 'TRANSPLANT' AND "quantity_unit" = 'SEEDLINGS'));
-- Semillas y plantines se cuentan enteros.
ALTER TABLE "kitchen_garden_crop_records" ADD CONSTRAINT "kitchen_garden_crop_records_quantity_whole_check" CHECK ("quantity_unit" IS NULL OR "quantity_unit" = 'GRAMS' OR "quantity" = trunc("quantity"));
ALTER TABLE "kitchen_garden_crop_records" ADD CONSTRAINT "kitchen_garden_crop_records_version_check" CHECK ("version" >= 1);
-- Anulación lógica: quién, cuándo y por qué, siempre juntos.
ALTER TABLE "kitchen_garden_crop_records" ADD CONSTRAINT "kitchen_garden_crop_records_voided_by_iff_voided_at_check" CHECK (("voided_at" IS NULL) = ("voided_by_user_id" IS NULL));
ALTER TABLE "kitchen_garden_crop_records" ADD CONSTRAINT "kitchen_garden_crop_records_void_reason_iff_voided_at_check" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL));
ALTER TABLE "kitchen_garden_crop_records" ADD CONSTRAINT "kitchen_garden_crop_records_void_reason_length_check" CHECK ("void_reason" IS NULL OR char_length(btrim("void_reason")) BETWEEN 3 AND 300);
