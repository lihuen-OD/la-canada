-- Etapa 5M — Mascotas: categoría de foto de ficha, actor real y anulación
-- lógica de registros clínicos, índice por fecha y CHECK del peso.
-- Generada OFFLINE con `prisma migrate diff --from-schema <schema antes> --to-schema <schema ahora>`
-- (comparación pura entre dos archivos de schema, sin base de datos ni shadow DB) y
-- revisada a mano. Solo agrega: un valor de enum, columnas nullable, un índice,
-- dos FK y dos CHECK. No reescribe ni borra datos. Se aplica únicamente a `demo`
-- con `prisma migrate deploy`.

-- AlterEnum
ALTER TYPE "PhotoCategory" ADD VALUE 'ANIMAL_PROFILE';

-- AlterTable
ALTER TABLE "animal_medical_records" ADD COLUMN     "recorded_by_user_id" UUID,
ADD COLUMN     "voided_at" TIMESTAMP(3),
ADD COLUMN     "voided_by_user_id" UUID;

-- CreateIndex
CREATE INDEX "animal_medical_records_animal_id_record_date_idx" ON "animal_medical_records"("animal_id", "record_date");

-- AddForeignKey
ALTER TABLE "animal_medical_records" ADD CONSTRAINT "animal_medical_records_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_medical_records" ADD CONSTRAINT "animal_medical_records_voided_by_user_id_fkey" FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddCheckConstraint (agregados a mano — Prisma no declara CHECK en schema.prisma)
-- El prototipo solo pedía (y mostraba) un valor en kg para el tipo "⚖️ Peso".
-- Defensa en profundidad de la validación del servicio: un peso siempre tiene
-- valor positivo y ningún otro tipo lo tiene. Precondición verificada antes de
-- aplicar: ninguna fila existente las viola.
ALTER TABLE "animal_medical_records" ADD CONSTRAINT "animal_medical_records_weight_value_check" CHECK (("type" = 'WEIGHT') = ("value" IS NOT NULL));
ALTER TABLE "animal_medical_records" ADD CONSTRAINT "animal_medical_records_value_positive_check" CHECK ("value" IS NULL OR "value" > 0);
