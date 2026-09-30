-- Stock objetivo de cada producto: la cantidad a la que se busca llegar al
-- reponer. Define los niveles (crítico <= mínimo; bajo hasta el punto medio
-- entre mínimo y objetivo; normal por encima) y la cantidad sugerida de Compras
-- (objetivo - actual). No es un máximo: un ingreso puede superarlo.
-- Generada OFFLINE con `prisma migrate diff --from-schema <antes> --to-schema <ahora>`
-- y revisada a mano. Solo agrega una columna NULLABLE y un CHECK: no reescribe
-- ni borra datos. Los productos existentes quedan con `target_quantity` NULL
-- («Stock objetivo pendiente») hasta que un ADMIN lo complete: nunca se inventa
-- un objetivo. Se aplica únicamente a `demo` con `db:migrate:deploy`.

-- AlterTable
ALTER TABLE "stock_items" ADD COLUMN     "target_quantity" DECIMAL(10,2);

-- AddCheckConstraint (a mano: Prisma no declara CHECK en schema.prisma)
-- Defensa en profundidad de la validación del servicio: un objetivo cargado es
-- no negativo y estrictamente mayor que el mínimo. Precondición: la columna es
-- nueva y nace NULL, así que ninguna fila existente la viola.
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_target_quantity_check" CHECK ("target_quantity" IS NULL OR ("target_quantity" >= 0 AND "target_quantity" > "minimum_quantity"));
