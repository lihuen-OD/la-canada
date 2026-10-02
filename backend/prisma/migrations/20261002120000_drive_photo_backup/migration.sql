-- Etapa 5Z — Copia adicional de fotografías en Google Drive (cola durable).
-- Generada OFFLINE con `prisma migrate diff --from-schema <schema antes> --to-schema <schema ahora>`
-- (comparación pura entre dos archivos de schema, sin base ni shadow DB) y revisada a mano.
-- Solo AGREGA: dos enums, dos tablas vacías, sus índices, una FK `RESTRICT` y CHECK.
-- No toca tablas existentes ni datos: compatible con la versión publicada (que ignora
-- estas tablas). Sin carga histórica: la cola arranca vacía a propósito.
-- Se aplica únicamente a `demo` con `db:migrate:deploy`.

-- CreateEnum
CREATE TYPE "DriveBackupStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'SOURCE_MISSING');

-- CreateEnum
CREATE TYPE "DriveBackupEnvironment" AS ENUM ('DEMO', 'PRODUCTION');

-- CreateTable
CREATE TABLE "drive_backup_jobs" (
    "id" UUID NOT NULL,
    "file_asset_id" UUID NOT NULL,
    "environment" "DriveBackupEnvironment" NOT NULL,
    "module" TEXT NOT NULL,
    "status" "DriveBackupStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claim_token" UUID,
    "claim_expires_at" TIMESTAMP(3),
    "remote_file_id" TEXT,
    "remote_folder_id" TEXT,
    "last_error_kind" TEXT,
    "last_error_message" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drive_backup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drive_backup_folders" (
    "path" TEXT NOT NULL,
    "remote_folder_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drive_backup_folders_pkey" PRIMARY KEY ("path")
);

-- CreateIndex
CREATE UNIQUE INDEX "drive_backup_jobs_file_asset_id_key" ON "drive_backup_jobs"("file_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "drive_backup_jobs_remote_file_id_key" ON "drive_backup_jobs"("remote_file_id");

-- CreateIndex
CREATE INDEX "drive_backup_jobs_status_next_attempt_at_idx" ON "drive_backup_jobs"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "drive_backup_folders_remote_folder_id_key" ON "drive_backup_folders"("remote_folder_id");

-- AddForeignKey
ALTER TABLE "drive_backup_jobs" ADD CONSTRAINT "drive_backup_jobs_file_asset_id_fkey" FOREIGN KEY ("file_asset_id") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddCheckConstraint (a mano: Prisma no declara CHECK en schema.prisma)
ALTER TABLE "drive_backup_jobs" ADD CONSTRAINT "drive_backup_jobs_attempts_check" CHECK ("attempts" >= 0);
ALTER TABLE "drive_backup_jobs" ADD CONSTRAINT "drive_backup_jobs_module_check" CHECK ("module" IN ('fotos', 'mascotas'));
ALTER TABLE "drive_backup_jobs" ADD CONSTRAINT "drive_backup_jobs_claim_check" CHECK ("status" <> 'IN_PROGRESS' OR ("claim_token" IS NOT NULL AND "claim_expires_at" IS NOT NULL));
ALTER TABLE "drive_backup_jobs" ADD CONSTRAINT "drive_backup_jobs_completed_check" CHECK ("status" <> 'COMPLETED' OR ("remote_file_id" IS NOT NULL AND "completed_at" IS NOT NULL));
