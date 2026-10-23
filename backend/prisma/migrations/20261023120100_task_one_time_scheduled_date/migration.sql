-- ✅ «Fecha para realizar» opcional de las tareas «Una vez» (`ONE_TIME`).
-- `tasks.scheduled_date` es la fecha vigente (de calendario, sin hora, en
-- `BUSINESS_TIME_ZONE`) y `task_planning_intervals.scheduled_date` la versiona
-- junto con responsable y frecuencia: reprogramar cierra el intervalo vigente y
-- abre otro, así que lo esperado en períodos anteriores no se reescribe.
-- Generada OFFLINE con `prisma migrate diff --from-schema <antes> --to-schema <ahora>`
-- y revisada a mano. Solo agrega dos columnas NULLABLE sin valor por defecto
-- (sin reescribir las tablas) y dos CHECK. No hay backfill ni fechas
-- inventadas: las tareas y planificaciones existentes quedan sin fecha y se
-- comportan exactamente igual. Compatible con la versión publicada: lee
-- columnas explícitas (nunca las nuevas) y, al crear o editar, las deja en NULL,
-- que cumple los CHECK. Se aplica únicamente a `demo` con `db:migrate:deploy`,
-- después de `20261023120000_task_frequency_bimonthly_annual`.

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "scheduled_date" DATE;

-- AlterTable
ALTER TABLE "task_planning_intervals" ADD COLUMN     "scheduled_date" DATE;


-- AddCheckConstraint (a mano: Prisma no declara CHECK en schema.prisma)
-- Defensa en profundidad del servicio: solo una «Una vez» lleva fecha, tanto en
-- la tarea como en cada versión de su planificación. Precondición: las dos
-- columnas son nuevas y nacen NULL, así que ninguna fila existente las viola.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_scheduled_date_one_time_check" CHECK ("scheduled_date" IS NULL OR "frequency" = 'ONE_TIME');
ALTER TABLE "task_planning_intervals" ADD CONSTRAINT "task_planning_intervals_scheduled_date_one_time_check" CHECK ("scheduled_date" IS NULL OR "frequency" = 'ONE_TIME');
