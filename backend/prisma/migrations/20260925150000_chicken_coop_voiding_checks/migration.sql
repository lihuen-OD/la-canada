-- Etapa 5G — Gallinero: actor real y anulación lógica de recolecciones, índice
-- por fecha y CHECK de conteos no negativos.
-- Generada OFFLINE con `prisma migrate diff --from-schema <schema antes> --to-schema <schema ahora>`
-- (comparación pura entre dos archivos de schema, sin base de datos ni shadow DB) y
-- revisada a mano. Solo agrega columnas nullable, un índice, dos FK y tres CHECK:
-- no reescribe ni borra datos. Se aplica únicamente a `demo` con `prisma migrate deploy`.

-- AlterTable
ALTER TABLE "egg_collections" ADD COLUMN     "recorded_by_user_id" UUID,
ADD COLUMN     "voided_at" TIMESTAMP(3),
ADD COLUMN     "voided_by_user_id" UUID;

-- CreateIndex
CREATE INDEX "egg_collections_collection_date_idx" ON "egg_collections"("collection_date");

-- AddForeignKey
ALTER TABLE "egg_collections" ADD CONSTRAINT "egg_collections_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "egg_collections" ADD CONSTRAINT "egg_collections_voided_by_user_id_fkey" FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddCheckConstraint (agregados a mano — Prisma no declara CHECK en schema.prisma)
-- Defensa en profundidad de las invariantes que ya valida el servicio
-- (chickenCoopService): la cantidad de gallinas y los conteos de huevos nunca
-- son negativos, y una recolección registra al menos un huevo (el prototipo
-- rechazaba "0 buenos y 0 rotos"). Precondición verificada antes de aplicar:
-- ninguna fila existente las viola.
ALTER TABLE "chicken_coops" ADD CONSTRAINT "chicken_coops_active_hens_count_non_negative_check" CHECK ("active_hens_count" >= 0);
ALTER TABLE "egg_collections" ADD CONSTRAINT "egg_collections_counts_non_negative_check" CHECK ("good_eggs_count" >= 0 AND "broken_eggs_count" >= 0);
ALTER TABLE "egg_collections" ADD CONSTRAINT "egg_collections_at_least_one_egg_check" CHECK ("good_eggs_count" + "broken_eggs_count" > 0);
