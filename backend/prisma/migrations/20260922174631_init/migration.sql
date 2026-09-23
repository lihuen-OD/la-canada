-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('ADMIN', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "TaskFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'URGENT', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "StockArea" AS ENUM ('HOUSE', 'GARDEN', 'BOTH');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING_BALANCE', 'INCOME', 'CONSUMPTION', 'ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE');

-- CreateEnum
CREATE TYPE "DestinationType" AS ENUM ('VEHICLE', 'SECTOR');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('VISIT', 'BIRTHDAY', 'MAINTENANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "MedicalRecordType" AS ENUM ('VACCINE', 'WEIGHT', 'DEWORMING', 'CHECKUP', 'CLINICAL_EVENT');

-- CreateEnum
CREATE TYPE "PhotoCategory" AS ENUM ('TASK_EVIDENCE', 'MEMORY');

-- CreateEnum
CREATE TYPE "FileProvider" AS ENUM ('NEON_OBJECT_STORAGE');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING_UPLOAD', 'AVAILABLE', 'UPLOAD_FAILED', 'PENDING_DELETION', 'DELETED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "role" "SystemRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "password_hash" TEXT,
    "employee_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "color_hex" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_profiles" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "full_legal_name" TEXT,
    "birth_date" DATE,
    "marital_status" TEXT,
    "phone" TEXT,
    "tax_id" TEXT,
    "health_insurance" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_children" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "birth_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_children_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "previous_state" JSONB,
    "new_state" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "employee_id" UUID NOT NULL,
    "frequency" "TaskFrequency" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_executions" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "period_key" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "assigned_employee_id" UUID NOT NULL,
    "completed_by_employee_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "area" "StockArea" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_items" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "area" "StockArea" NOT NULL,
    "category_id" UUID NOT NULL,
    "unit" TEXT NOT NULL,
    "minimum_quantity" DECIMAL(10,2) NOT NULL,
    "current_quantity" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "stock_item_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "effective_date" DATE NOT NULL,
    "employee_id" UUID,
    "destination_id" UUID,
    "reason" TEXT,
    "reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumption_destinations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DestinationType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consumption_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_reports" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "news_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "EventType" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_birthdays" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "person_label" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "relationship" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_birthdays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_assets" (
    "id" UUID NOT NULL,
    "provider" "FileProvider" NOT NULL,
    "bucket" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "etag" TEXT,
    "category" "PhotoCategory" NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "deleted_at" TIMESTAMP(3),
    "uploaded_by_employee_id" UUID,
    "tagged_employee_id" UUID,
    "task_id" UUID,
    "animal_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chicken_coops" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "active_hens_count" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chicken_coops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "egg_collections" (
    "id" UUID NOT NULL,
    "chicken_coop_id" UUID,
    "collection_date" DATE NOT NULL,
    "good_eggs_count" INTEGER NOT NULL,
    "broken_eggs_count" INTEGER NOT NULL,
    "employee_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "egg_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_types" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "animal_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animals" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "animal_type_id" UUID NOT NULL,
    "breed" TEXT,
    "birth_date" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "animals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_medical_records" (
    "id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "type" "MedicalRecordType" NOT NULL,
    "record_date" DATE NOT NULL,
    "description" TEXT,
    "value" DECIMAL(6,2),
    "employee_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "animal_medical_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_locations" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

-- CreateIndex
CREATE INDEX "users_employee_id_idx" ON "users"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_code_key" ON "employees"("code");

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_employee_id_key" ON "employee_profiles"("employee_id");

-- CreateIndex
CREATE INDEX "employee_children_employee_id_idx" ON "employee_children"("employee_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "tasks_employee_id_idx" ON "tasks"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_employee_id_description_key" ON "tasks"("employee_id", "description");

-- CreateIndex
CREATE INDEX "task_executions_task_id_idx" ON "task_executions"("task_id");

-- CreateIndex
CREATE INDEX "task_executions_assigned_employee_id_idx" ON "task_executions"("assigned_employee_id");

-- CreateIndex
CREATE INDEX "task_executions_completed_by_employee_id_idx" ON "task_executions"("completed_by_employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_executions_task_id_period_key_key" ON "task_executions"("task_id", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "stock_categories_name_area_key" ON "stock_categories"("name", "area");

-- CreateIndex
CREATE INDEX "stock_items_category_id_idx" ON "stock_items"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_area_name_key" ON "stock_items"("area", "name");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_reference_key" ON "stock_movements"("reference");

-- CreateIndex
CREATE INDEX "stock_movements_stock_item_id_idx" ON "stock_movements"("stock_item_id");

-- CreateIndex
CREATE INDEX "stock_movements_employee_id_idx" ON "stock_movements"("employee_id");

-- CreateIndex
CREATE INDEX "stock_movements_destination_id_idx" ON "stock_movements"("destination_id");

-- CreateIndex
CREATE UNIQUE INDEX "consumption_destinations_name_key" ON "consumption_destinations"("name");

-- CreateIndex
CREATE INDEX "news_reports_employee_id_idx" ON "news_reports"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "news_reports_employee_id_text_key" ON "news_reports"("employee_id", "text");

-- CreateIndex
CREATE UNIQUE INDEX "events_title_date_type_key" ON "events"("title", "date", "type");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_birthdays_slug_key" ON "recurring_birthdays"("slug");

-- CreateIndex
CREATE INDEX "file_assets_task_id_idx" ON "file_assets"("task_id");

-- CreateIndex
CREATE INDEX "file_assets_animal_id_idx" ON "file_assets"("animal_id");

-- CreateIndex
CREATE INDEX "file_assets_uploaded_by_employee_id_idx" ON "file_assets"("uploaded_by_employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_assets_bucket_object_key_key" ON "file_assets"("bucket", "object_key");

-- CreateIndex
CREATE UNIQUE INDEX "chicken_coops_code_key" ON "chicken_coops"("code");

-- CreateIndex
CREATE INDEX "egg_collections_chicken_coop_id_idx" ON "egg_collections"("chicken_coop_id");

-- CreateIndex
CREATE INDEX "egg_collections_employee_id_idx" ON "egg_collections"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "animal_types_name_key" ON "animal_types"("name");

-- CreateIndex
CREATE INDEX "animals_animal_type_id_idx" ON "animals"("animal_type_id");

-- CreateIndex
CREATE INDEX "animal_medical_records_animal_id_idx" ON "animal_medical_records"("animal_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_locations_code_key" ON "property_locations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "property_locations_label_key" ON "property_locations"("label");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_children" ADD CONSTRAINT "employee_children_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_assigned_employee_id_fkey" FOREIGN KEY ("assigned_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_completed_by_employee_id_fkey" FOREIGN KEY ("completed_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "stock_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "consumption_destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_reports" ADD CONSTRAINT "news_reports_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_uploaded_by_employee_id_fkey" FOREIGN KEY ("uploaded_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_tagged_employee_id_fkey" FOREIGN KEY ("tagged_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "egg_collections" ADD CONSTRAINT "egg_collections_chicken_coop_id_fkey" FOREIGN KEY ("chicken_coop_id") REFERENCES "chicken_coops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "egg_collections" ADD CONSTRAINT "egg_collections_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_animal_type_id_fkey" FOREIGN KEY ("animal_type_id") REFERENCES "animal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_medical_records" ADD CONSTRAINT "animal_medical_records_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_medical_records" ADD CONSTRAINT "animal_medical_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddCheckConstraint
-- Restricciones agregadas a mano, revisadas contra la matriz de invariantes
-- de docs/DATABASE.md — solo las clasificadas ahí como "2. Constraint SQL
-- (futura migración)" (filas 1, 3, 4, 5, 13). Prisma no las declara en
-- schema.prisma; el resto de las filas de la matriz queda a nivel de
-- servicio (cruzan otra tabla o dependen de una operación previa) y
-- deliberadamente no se simulan acá con un CHECK incompleto.

-- Fila 1: StockItem.area nunca BOTH (BOTH solo tiene sentido para StockCategory).
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_area_not_both_check" CHECK ("area" != 'BOTH');

-- Fila 3: User.status = ACTIVE ⇒ password_hash no nulo.
ALTER TABLE "users" ADD CONSTRAINT "users_active_requires_password_hash_check" CHECK ("status" != 'ACTIVE' OR "password_hash" IS NOT NULL);

-- Fila 4: FileAsset no vinculado simultáneamente a task_id y animal_id.
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_not_task_and_animal_check" CHECK (NOT ("task_id" IS NOT NULL AND "animal_id" IS NOT NULL));

-- Fila 5: StockMovement.quantity siempre positiva.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_positive_check" CHECK ("quantity" > 0);

-- Fila 13 (Etapa 2.2): FileAsset.sizeBytes nunca negativo.
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_size_bytes_non_negative_check" CHECK ("size_bytes" >= 0);
