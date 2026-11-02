-- AlterTable
ALTER TABLE "file_assets" ADD COLUMN     "folder_id" UUID;

-- CreateTable
CREATE TABLE "photo_folders" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_user_id" UUID,

    CONSTRAINT "photo_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "photo_folders_active_name_key" ON "photo_folders"("name_key") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "file_assets_folder_id_status_created_at_idx" ON "file_assets"("folder_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "photo_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_folders" ADD CONSTRAINT "photo_folders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_folders" ADD CONSTRAINT "photo_folders_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Manual: Prisma no modela CHECK.
-- Carpeta: nombre visible de 1 a 80 caracteres (el backend lo normaliza antes),
-- clave no vacía, versión que nunca baja de 1 y, como en "events"/"news_*",
-- quién eliminó existe si y solo si hay fecha de eliminación.
ALTER TABLE "photo_folders" ADD CONSTRAINT "photo_folders_name_length_check" CHECK (char_length("name") BETWEEN 1 AND 80 AND char_length("name_key") >= 1);
ALTER TABLE "photo_folders" ADD CONSTRAINT "photo_folders_version_check" CHECK ("version" >= 1);
ALTER TABLE "photo_folders" ADD CONSTRAINT "photo_folders_deleted_consistency_check" CHECK (("deleted_at" IS NULL) = ("deleted_by_user_id" IS NULL));

-- Solo fotos de la galería pertenecen a una carpeta (nunca la foto de ficha de
-- una mascota ni el plano del jardín) y solo confirmadas: una subida pendiente
-- o fallida nunca es una foto de la carpeta; una eliminada conserva la suya.
-- Las filas existentes cumplen ambas: "folder_id" nace nulo para todas.
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_folder_gallery_check" CHECK ("folder_id" IS NULL OR "category" IN ('TASK_EVIDENCE', 'MEMORY'));
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_folder_confirmed_check" CHECK ("folder_id" IS NULL OR "status" IN ('AVAILABLE', 'PENDING_DELETION', 'DELETED'));
