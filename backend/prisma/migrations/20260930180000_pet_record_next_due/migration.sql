-- 🐾 Mascotas: próxima aplicación o control de un registro clínico y su
-- cumplimiento explícito. `next_due_date` es la fecha programada (cargada a
-- mano; nunca calculada) y `fulfills_record_id` vincula la atención que cumple
-- ese pendiente. El estado (vigente/próxima/vence hoy/vencida/cumplida) se
-- calcula en el backend y no se persiste.
-- Generada OFFLINE con `prisma migrate diff --from-schema <antes> --to-schema <ahora>`
-- y revisada a mano. Solo agrega dos columnas NULLABLE, dos índices, un índice
-- único parcial, una FK RESTRICT y tres CHECK. No reescribe ni borra datos y
-- no inventa fechas: los registros existentes quedan sin fecha programada (no
-- generan pendientes ni se consideran vencidos). Se aplica únicamente a `demo`
-- con `db:migrate:deploy`.
-- AlterTable
ALTER TABLE "animal_medical_records" ADD COLUMN     "fulfills_record_id" UUID,
ADD COLUMN     "next_due_date" DATE;

-- CreateIndex
CREATE INDEX "animal_medical_records_next_due_date_idx" ON "animal_medical_records"("next_due_date");

-- CreateIndex
CREATE INDEX "animal_medical_records_animal_id_next_due_date_idx" ON "animal_medical_records"("animal_id", "next_due_date");

-- CreateIndex
CREATE UNIQUE INDEX "animal_medical_records_active_fulfillment_key" ON "animal_medical_records"("fulfills_record_id") WHERE (voided_at IS NULL);

-- AddForeignKey
ALTER TABLE "animal_medical_records" ADD CONSTRAINT "animal_medical_records_fulfills_record_id_fkey" FOREIGN KEY ("fulfills_record_id") REFERENCES "animal_medical_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddCheckConstraint (a mano: Prisma no declara CHECK en schema.prisma)
-- Defensa en profundidad de las validaciones del servicio. Precondición: las
-- dos columnas son nuevas y nacen NULL, así que ninguna fila existente las viola.
-- La próxima fecha es posterior a la atención realizada.
ALTER TABLE "animal_medical_records" ADD CONSTRAINT "animal_medical_records_next_due_after_record_check" CHECK ("next_due_date" IS NULL OR "next_due_date" > "record_date");
-- ⚖️ Peso no programa una próxima aplicación o control.
ALTER TABLE "animal_medical_records" ADD CONSTRAINT "animal_medical_records_next_due_not_weight_check" CHECK ("next_due_date" IS NULL OR "type" <> 'WEIGHT');
-- Un registro no cumple su propio pendiente.
ALTER TABLE "animal_medical_records" ADD CONSTRAINT "animal_medical_records_fulfills_other_check" CHECK ("fulfills_record_id" IS NULL OR "fulfills_record_id" <> "id");
