-- ✅ Tareas quincenales: nuevo valor `SEMI_MONTHLY` del enum `TaskFrequency`.
-- Quincenal = dos períodos por mes calendario (del 1 al 15 y del 16 al último
-- día), calculados en el backend con `BUSINESS_TIME_ZONE`; no es una
-- recurrencia de 14 días ni necesita fecha inicial.
-- Generada OFFLINE con `prisma migrate diff --from-schema <antes> --to-schema <ahora>`
-- y revisada a mano. Solo AMPLÍA el enum: no recrea tablas, no agrega columnas
-- y no convierte tareas ni ejecuciones existentes (ninguna fila pasa a
-- quincenal). Compatible con la versión publicada, que nunca envía ni lee este
-- valor. Se aplica únicamente a `demo` con `db:migrate:deploy`.

-- AlterEnum
ALTER TYPE "TaskFrequency" ADD VALUE 'SEMI_MONTHLY';
