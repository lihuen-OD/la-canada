-- ✅ Tareas: «Orden de realización» y programación SUGERIDA opcionales.
-- `execution_order` ordena los listados operativos dentro de cada frecuencia
-- (1–9999, repetidos permitidos; NULL = sin orden). Las columnas
-- `suggested_*` guardan cuándo conviene hacer una recurrente dentro de su
-- período (semanal: día de la semana; quincenal: día de cada quincena;
-- mensual: día; bimestral: mes del bimestre + día; anual: mes + día). Son
-- SOLO sugerencias: no cambian períodos, estados, vencimientos ni métricas, y
-- la fecha sugerida se calcula en el backend (`tasks/taskSuggestion.ts`).
-- Generada OFFLINE con `prisma migrate diff --from-schema <antes> --to-schema <ahora>`
-- y revisada a mano. Solo agrega seis columnas SMALLINT NULLABLE sin valor por
-- defecto (metadato, sin reescribir la tabla) y siete CHECK. Sin backfill, sin
-- UPDATE ni DELETE: las tareas existentes quedan sin orden ni sugerencia y se
-- comportan exactamente igual. Compatible con la versión publicada: lee
-- columnas explícitas (nunca las nuevas) y, al crear, las deja en NULL, que
-- cumple los CHECK. Se aplica únicamente a `demo` con `db:migrate:deploy`,
-- después de `20261023120100_task_one_time_scheduled_date`.

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "execution_order" SMALLINT,
ADD COLUMN     "suggested_first_half_day" SMALLINT,
ADD COLUMN     "suggested_month" SMALLINT,
ADD COLUMN     "suggested_month_day" SMALLINT,
ADD COLUMN     "suggested_second_half_day" SMALLINT,
ADD COLUMN     "suggested_weekday" SMALLINT;


-- AddCheckConstraint (a mano: Prisma no declara CHECK en schema.prisma)
-- Defensa en profundidad de la validación del servicio. Precondición: las seis
-- columnas son nuevas y nacen NULL, así que ninguna fila existente las viola.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_execution_order_check" CHECK ("execution_order" IS NULL OR "execution_order" BETWEEN 1 AND 9999);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_suggested_weekday_check" CHECK ("suggested_weekday" IS NULL OR ("frequency" = 'WEEKLY' AND "suggested_weekday" BETWEEN 1 AND 7));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_suggested_first_half_day_check" CHECK ("suggested_first_half_day" IS NULL OR ("frequency" = 'SEMI_MONTHLY' AND "suggested_first_half_day" BETWEEN 1 AND 15));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_suggested_second_half_day_check" CHECK ("suggested_second_half_day" IS NULL OR ("frequency" = 'SEMI_MONTHLY' AND "suggested_second_half_day" BETWEEN 16 AND 31));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_suggested_month_day_check" CHECK ("suggested_month_day" IS NULL OR ("frequency" IN ('MONTHLY', 'BIMONTHLY', 'ANNUAL') AND "suggested_month_day" BETWEEN 1 AND 31));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_suggested_month_check" CHECK ("suggested_month" IS NULL OR ("frequency" = 'BIMONTHLY' AND "suggested_month" BETWEEN 1 AND 2) OR ("frequency" = 'ANNUAL' AND "suggested_month" BETWEEN 1 AND 12));
-- Bimestral y anual: mes y día juntos, o ninguno.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_suggested_month_pair_check" CHECK ("frequency" NOT IN ('BIMONTHLY', 'ANNUAL') OR ("suggested_month" IS NULL) = ("suggested_month_day" IS NULL));
