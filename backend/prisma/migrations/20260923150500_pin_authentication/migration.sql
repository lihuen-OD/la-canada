-- Reemplaza el modelo de credenciales de contraseña por PIN numérico de 4
-- dígitos (Etapa 3B.2). Rename seguro de la columna existente (nunca
-- drop+recreate: si algún día hubiera datos reales en password_hash, un
-- drop los perdería; un rename los preserva) — Prisma no detecta un rename
-- de campo comparando dos schemas sueltos con `migrate diff`, por eso este
-- archivo se escribió a mano en vez de usar el SQL generado automáticamente.

-- RenameColumn: password_hash -> pin_hash (preserva cualquier valor existente)
ALTER TABLE "users" RENAME COLUMN "password_hash" TO "pin_hash";

-- RenameConstraint: el CHECK ya validaba la columna correcta (Postgres
-- actualiza la definición del constraint automáticamente al renombrar la
-- columna que referencia) — se renombra el constraint en sí solo para que
-- su nombre no quede con terminología de "password" obsoleta.
ALTER TABLE "users" RENAME CONSTRAINT "users_active_requires_password_hash_check" TO "users_active_requires_pin_hash_check";

-- AlterTable: protección persistente contra fuerza bruta sobre el PIN
-- (10.000 combinaciones posibles) — contador de intentos fallidos +
-- bloqueo temporal, sobreviven a un reinicio del proceso backend.
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "locked_until" TIMESTAMP(3);
