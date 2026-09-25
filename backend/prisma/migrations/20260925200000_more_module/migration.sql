-- Etapa 5X — Más: Novedades (actor real, sin unicidad empleado+texto),
-- Eventos (anulación lógica con unicidad parcial) y Fotos (título + índice de
-- galería). Generada OFFLINE con `prisma migrate diff --from-schema <schema antes>
-- --to-schema <schema ahora>` (sin base ni shadow DB) y revisada a mano. No
-- reescribe ni borra filas: solo cambia dos índices únicos, agrega columnas
-- nullable, índices, FK y un CHECK. Se aplica únicamente a `demo` con
-- `prisma migrate deploy`.

-- DropIndex
DROP INDEX "news_reports_employee_id_text_key";

-- DropIndex
DROP INDEX "events_title_date_type_key";

-- AlterTable
ALTER TABLE "news_reports" ADD COLUMN     "recorded_by_user_id" UUID;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "deleted_by_user_id" UUID;

-- AlterTable
ALTER TABLE "file_assets" ADD COLUMN     "title" TEXT;

-- CreateIndex
CREATE INDEX "news_reports_created_at_idx" ON "news_reports"("created_at");

-- CreateIndex
CREATE INDEX "events_date_idx" ON "events"("date");

-- CreateIndex
CREATE UNIQUE INDEX "events_title_date_type_key" ON "events"("title", "date", "type") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "file_assets_category_status_created_at_idx" ON "file_assets"("category", "status", "created_at");

-- AddForeignKey
ALTER TABLE "news_reports" ADD CONSTRAINT "news_reports_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddCheckConstraint (a mano — Prisma no declara CHECK en schema.prisma)
-- Una anulación siempre registra quién la hizo. Precondición: 0 filas anuladas.
ALTER TABLE "events" ADD CONSTRAINT "events_deleted_consistency_check" CHECK (("deleted_at" IS NULL) = ("deleted_by_user_id" IS NULL));
