-- AlterTable
ALTER TABLE "news_reports" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "deleted_by_user_id" UUID,
ADD COLUMN     "edited_at" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "news_replies" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "deleted_by_user_id" UUID,
ADD COLUMN     "edited_at" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AddForeignKey
ALTER TABLE "news_reports" ADD CONSTRAINT "news_reports_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_replies" ADD CONSTRAINT "news_replies_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Manual: Prisma no modela CHECK. Mismo criterio que "events": quién eliminó
-- existe si y solo si hay fecha de eliminación; la versión nunca baja de 1.
-- Las filas existentes cumplen ambas (columnas nuevas vacías y DEFAULT 1).
ALTER TABLE "news_reports" ADD CONSTRAINT "news_reports_deleted_consistency_check" CHECK (("deleted_at" IS NULL) = ("deleted_by_user_id" IS NULL));
ALTER TABLE "news_reports" ADD CONSTRAINT "news_reports_version_check" CHECK ("version" >= 1);
ALTER TABLE "news_replies" ADD CONSTRAINT "news_replies_deleted_consistency_check" CHECK (("deleted_at" IS NULL) = ("deleted_by_user_id" IS NULL));
ALTER TABLE "news_replies" ADD CONSTRAINT "news_replies_version_check" CHECK ("version" >= 1);
