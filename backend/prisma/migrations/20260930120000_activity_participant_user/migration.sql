-- Administradores como participantes de una actividad: quien consumió en
-- Stock y quien juntó en el Gallinero puede ser un ADMIN sin `Employee`. El
-- participante se guarda en `participant_user_id`. El autor sigue aparte: la
-- auditoría `stock.movement.created` y `egg_collections.recorded_by_user_id`.
-- Generada OFFLINE con `prisma migrate diff --from-schema <antes> --to-schema <ahora>`
-- y revisada a mano. Solo agrega dos columnas nullable, dos índices, dos FK
-- RESTRICT y dos CHECK de exclusión. No reescribe ni borra datos: las filas
-- existentes quedan con `participant_user_id` NULL (el participante anterior
-- se conserva en `employee_id`, y nunca se deduce del autor). Se aplica
-- únicamente a `demo` con `db:migrate:deploy`.

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "participant_user_id" UUID;

-- AlterTable
ALTER TABLE "egg_collections" ADD COLUMN     "participant_user_id" UUID;

-- CreateIndex
CREATE INDEX "stock_movements_participant_user_id_idx" ON "stock_movements"("participant_user_id");

-- CreateIndex
CREATE INDEX "egg_collections_participant_user_id_idx" ON "egg_collections"("participant_user_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_participant_user_id_fkey" FOREIGN KEY ("participant_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "egg_collections" ADD CONSTRAINT "egg_collections_participant_user_id_fkey" FOREIGN KEY ("participant_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddCheckConstraint (a mano: Prisma no declara CHECK en schema.prisma)
-- Un participante por actividad: empleado O administrador sin ficha, nunca
-- ambos. Los dos pueden faltar (aperturas del seed, movimientos anteriores de
-- un ADMIN con «Administrador», recolecciones sin persona). Precondición: la
-- columna es nueva y nace NULL, así que ninguna fila existente la viola.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_single_participant_check" CHECK ("employee_id" IS NULL OR "participant_user_id" IS NULL);
ALTER TABLE "egg_collections" ADD CONSTRAINT "egg_collections_single_participant_check" CHECK ("employee_id" IS NULL OR "participant_user_id" IS NULL);
