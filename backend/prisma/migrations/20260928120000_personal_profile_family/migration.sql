-- Etapa 5F — Perfil personal y familia de un usuario sin Employee (el ADMIN).
-- Generada OFFLINE con `prisma migrate diff --from-schema <schema antes>
-- --to-schema <schema ahora> --script` (sin base ni shadow DB) y revisada a mano.
-- Solo estructura: no lee ni escribe filas, no contiene identificadores de
-- usuarios ni nombres de personas. La asociación de Vicky y Felicitas al ADMIN
-- es un backfill operativo aparte (`npm run family:backfill-admin`). Sin DROP de
-- tablas/columnas ni ON DELETE CASCADE. Se aplica únicamente a `demo` con
-- `prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "FamilyRelation" AS ENUM ('PARTNER', 'CHILD', 'FAMILY', 'OTHER');

-- AlterTable
-- `slug` pasa a ser opcional: los familiares cargados desde la app no tienen
-- clave natural de seed (la unicidad se conserva; Postgres admite varios NULL).
ALTER TABLE "recurring_birthdays" ADD COLUMN     "birth_year" INTEGER,
ADD COLUMN     "owner_user_id" UUID,
ADD COLUMN     "relation" "FamilyRelation",
ALTER COLUMN "slug" DROP NOT NULL;

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" TEXT,
    "birth_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE INDEX "recurring_birthdays_owner_user_id_created_at_idx" ON "recurring_birthdays"("owner_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_birthdays" ADD CONSTRAINT "recurring_birthdays_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint (a mano — Prisma no declara CHECK en schema.prisma)
-- Un familiar siempre tiene propietario Y relación; un cumpleaños global, ninguno.
-- Precondición: todas las filas existentes tienen ambos NULL (columnas nuevas).
ALTER TABLE "recurring_birthdays" ADD CONSTRAINT "recurring_birthdays_owner_relation_check" CHECK (("owner_user_id" IS NULL) = ("relation" IS NULL));

-- Día y mes de calendario reales (29/02 admitido: se festeja el 01/03 en años no bisiestos).
-- Precondición: las 2 filas del seed (10/03 y 01/06) cumplen.
ALTER TABLE "recurring_birthdays" ADD CONSTRAINT "recurring_birthdays_month_day_check" CHECK ("month" BETWEEN 1 AND 12 AND "day" BETWEEN 1 AND (CASE WHEN "month" = 2 THEN 29 WHEN "month" IN (4, 6, 9, 11) THEN 30 ELSE 31 END));

-- Año real opcional (nunca uno de relleno): rango razonable y 29/02 solo en años bisiestos.
ALTER TABLE "recurring_birthdays" ADD CONSTRAINT "recurring_birthdays_birth_year_check" CHECK ("birth_year" IS NULL OR ("birth_year" BETWEEN 1900 AND 2100 AND NOT ("month" = 2 AND "day" = 29 AND NOT (("birth_year" % 4 = 0 AND "birth_year" % 100 <> 0) OR "birth_year" % 400 = 0))));
