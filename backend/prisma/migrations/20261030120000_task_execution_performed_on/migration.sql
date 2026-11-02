-- ✅ Tareas: «Marcar como realizada» desde Desempeño → Detalle (carga olvidada).
-- `performed_on` guarda la fecha REAL en que se hizo una obligación pasada,
-- separada del momento real en que se registró (`completed_at`, sin cambios de
-- significado). Es una fecha de calendario sin hora en `BUSINESS_TIME_ZONE`:
-- de una carga olvidada solo se conoce el día, así que nunca se inventa una hora.
-- NULL = finalización del flujo normal (se realizó cuando se registró).
-- Generada OFFLINE con `prisma migrate diff --from-schema <antes> --to-schema <ahora>`
-- y revisada a mano. Solo agrega una columna DATE NULLABLE sin valor por defecto
-- (metadato, sin reescribir la tabla) y un CHECK. Sin backfill, sin UPDATE ni
-- DELETE: las ejecuciones existentes quedan con NULL y conservan exactamente su
-- significado y sus valores. Compatible con la versión publicada: lee columnas
-- explícitas (nunca la nueva) y, al crear, la deja en NULL, que cumple el CHECK.
-- Se aplica únicamente a `demo` con `db:migrate:deploy`, después de
-- `20261027120000_kitchen_garden_module`.

-- AlterTable
ALTER TABLE "task_executions" ADD COLUMN     "performed_on" DATE;

-- AddCheckConstraint (a mano: Prisma no declara CHECK en schema.prisma)
-- Defensa en profundidad de la validación del servicio: la fecha real de
-- realización nunca es posterior al día en que se registró. `completed_at` se
-- guarda en UTC; sumar 14 horas (el mayor adelanto horario que existe) hace que
-- la comparación valga para cualquier zona de negocio sin fijarla acá. La
-- columna nace NULL, así que ninguna fila existente lo viola.
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_performed_on_not_after_completion_check" CHECK ("performed_on" IS NULL OR "performed_on" <= ("completed_at" + INTERVAL '14 hours')::date);
