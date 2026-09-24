-- Etapa 4A — reversión de finalizaciones de tareas sin perder historia.
--
-- Modelo: cada fila de task_executions es un EVENTO de finalización. Revertir
-- marca la fila (reverted_at / reverted_by_user_id / revert_reason y
-- completed = false) sin borrarla ni tocar completed_at,
-- completed_by_employee_id ni assigned_employee_id; volver a completar el
-- mismo período crea una fila nueva. La unicidad pasa a ser PARCIAL: una sola
-- ejecución vigente (no revertida) por tarea+período — sigue siendo la defensa
-- final contra duplicados bajo concurrencia.
--
-- Generada offline con `prisma migrate diff --from-schema <antes> --to-schema
-- <después> --script` (mismo procedimiento que las migraciones de la Etapa 3B)
-- y completada a mano con los CHECK de coherencia (Prisma no los expresa).
-- Segura sobre datos existentes: al momento de generarla, task_executions
-- tenía 0 filas en demo (el seed nunca crea ejecuciones); las columnas nuevas
-- son todas nullable.

-- DropIndex (unicidad total, reemplazada por la parcial de abajo)
DROP INDEX "task_executions_task_id_period_key_key";

-- AlterTable
ALTER TABLE "task_executions" ADD COLUMN     "recorded_by_user_id" UUID,
ADD COLUMN     "revert_reason" TEXT,
ADD COLUMN     "reverted_at" TIMESTAMP(3),
ADD COLUMN     "reverted_by_user_id" UUID;

-- CreateIndex: una sola ejecución vigente por (tarea, período)
CREATE UNIQUE INDEX "task_executions_task_id_period_key_key" ON "task_executions"("task_id", "period_key") WHERE (reverted_at IS NULL);

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_reverted_by_user_id_fkey" FOREIGN KEY ("reverted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── CHECK de coherencia (agregados a mano) ──────────────────────────────

-- Una ejecución está completada si y solo si no fue revertida.
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_completed_iff_not_reverted_check" CHECK ("completed" = ("reverted_at" IS NULL));

-- Toda reversión registra quién la hizo (y nunca hay actor sin fecha).
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_reverted_by_iff_reverted_at_check" CHECK (("reverted_at" IS NULL) = ("reverted_by_user_id" IS NULL));

-- Cada fila es un evento de finalización: siempre tiene fecha y ejecutor,
-- incluso después de revertida (la reversión no borra esa información).
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_completion_recorded_check" CHECK ("completed_at" IS NOT NULL AND "completed_by_employee_id" IS NOT NULL);
