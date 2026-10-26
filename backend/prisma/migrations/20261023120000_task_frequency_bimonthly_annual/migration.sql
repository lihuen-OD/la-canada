-- ✅ Tareas bimestrales y anuales: nuevos valores `BIMONTHLY` y `ANNUAL` del
-- enum `TaskFrequency`.
-- Bimestral = seis períodos de calendario por año (ene–feb, mar–abr, may–jun,
-- jul–ago, sep–oct y nov–dic); anual = del 1 de enero al 31 de diciembre. Ambos
-- se calculan en el backend con `BUSINESS_TIME_ZONE`; no son "dos meses / un
-- año desde la última ejecución" ni necesitan fecha inicial.
-- Generada OFFLINE con `prisma migrate diff --from-schema <antes> --to-schema <ahora>`
-- y revisada a mano. Solo AMPLÍA el enum: no recrea tablas, no agrega columnas
-- y no convierte tareas ni ejecuciones existentes (ninguna fila pasa a
-- bimestral ni a anual). Va separada de la fecha de las «Una vez» para que
-- ningún valor nuevo se use en la misma transacción en que se agrega.
-- Compatible con la versión publicada, que nunca envía ni lee estos valores.
-- Se aplica únicamente a `demo` con `db:migrate:deploy`.

-- AlterEnum
ALTER TYPE "TaskFrequency" ADD VALUE 'BIMONTHLY';
ALTER TYPE "TaskFrequency" ADD VALUE 'ANNUAL';
