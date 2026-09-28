-- Etapa 5Y — Jardín: versiones del plano del jardín.
-- Generada OFFLINE con `prisma migrate diff --from-schema <schema antes> --to-schema <schema ahora>`
-- (comparación pura entre dos archivos de schema, sin base de datos ni shadow DB) y
-- revisada a mano. Solo AGREGA: un valor de enum, una tabla nueva, dos índices únicos
-- y dos FK. No reescribe ni elimina datos, no altera columnas existentes y ninguna FK
-- cascada al borrar (las dos son `RESTRICT`: ni el archivo ni el usuario pueden
-- eliminarse mientras exista una versión publicada). Módulo nuevo: la tabla queda vacía
-- a propósito, sin filas sembradas ni datos que migrar. Se aplica únicamente a `demo`
-- con `prisma migrate deploy`.

-- AlterEnum
ALTER TYPE "PhotoCategory" ADD VALUE 'GARDEN_PLAN';

-- CreateTable
CREATE TABLE "garden_plan_versions" (
    "id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "file_asset_id" UUID NOT NULL,
    "published_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garden_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "garden_plan_versions_version_number_key" ON "garden_plan_versions"("version_number");

-- CreateIndex
CREATE UNIQUE INDEX "garden_plan_versions_file_asset_id_key" ON "garden_plan_versions"("file_asset_id");

-- AddForeignKey
ALTER TABLE "garden_plan_versions" ADD CONSTRAINT "garden_plan_versions_file_asset_id_fkey" FOREIGN KEY ("file_asset_id") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garden_plan_versions" ADD CONSTRAINT "garden_plan_versions_published_by_user_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
