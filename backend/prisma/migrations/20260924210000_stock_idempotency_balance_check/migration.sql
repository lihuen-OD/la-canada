-- Etapa 5C.1A — idempotencia de movimientos de Stock + CHECK de saldo no negativo.
-- Generada OFFLINE con `prisma migrate diff --from-schema <schema antes> --to-schema <schema ahora>`
-- (comparación pura entre dos archivos de schema, sin base de datos ni shadow DB) y
-- revisada a mano. NO fue aplicada todavía: la aplicación real (solo a `demo`, con
-- `prisma migrate deploy`) corresponde a la Etapa 5C.1C, con autorización humana.

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idempotency_records_created_at_idx" ON "idempotency_records"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_actor_user_id_endpoint_key_key" ON "idempotency_records"("actor_user_id", "endpoint", "key");

-- AddForeignKey
-- actor_user_id obligatorio → Prisma infiere ON DELETE RESTRICT (el actor
-- nunca se convierte en null ni desaparece con su registro).
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint (agregado a mano — Prisma no declara CHECK en schema.prisma)
-- Piso final de defensa en profundidad para la invariante "el saldo nunca
-- queda negativo" (docs/DATABASE.md, matriz de invariantes, fila 6). No
-- reemplaza la actualización condicional atómica de stockService (esa sigue
-- siendo la garantía frente a concurrencia); solo garantiza que ninguna otra
-- vía pueda escribir un saldo negativo en la fila. Precondición verificada
-- antes de aplicar (Etapa 5C.1C): ningún stock_items existente tiene
-- current_quantity < 0.
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_current_quantity_non_negative_check" CHECK ("current_quantity" >= 0);
