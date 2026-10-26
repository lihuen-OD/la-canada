-- 🥬 Huerta: módulo propio con participantes, actividades, planificación
-- histórica y ejecuciones, en tablas `kitchen_garden_*` NUEVAS.
-- Independiente de ✅ Tareas: no altera `tasks`, `task_executions` ni
-- `task_planning_intervals` (ni ninguna otra tabla existente) y no copia,
-- mueve ni clasifica tareas. Solo reutiliza el TIPO enum `TaskFrequency`
-- (mismas frecuencias y períodos) y referencia `users` por FK RESTRICT, sin
-- cambiar usuarios, empleados ni roles.
-- Generada OFFLINE con `prisma migrate diff --from-schema <antes> --to-schema <ahora> --script`
-- y revisada a mano; los CHECK (que Prisma no declara) se agregan al final y
-- replican las garantías de Tareas. Sin datos iniciales: no crea
-- participantes, actividades ni historial (el módulo arranca vacío).
-- Se aplica únicamente a `demo` con `db:migrate:deploy` (guarda
-- `DATABASE_TARGET=demo`); queda pendiente para `production`.

-- CreateTable
CREATE TABLE "kitchen_garden_participants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kitchen_garden_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_garden_activities" (
    "id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "participant_id" UUID NOT NULL,
    "frequency" "TaskFrequency" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "scheduled_date" DATE,
    "execution_order" SMALLINT,
    "suggested_weekday" SMALLINT,
    "suggested_first_half_day" SMALLINT,
    "suggested_second_half_day" SMALLINT,
    "suggested_month_day" SMALLINT,
    "suggested_month" SMALLINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kitchen_garden_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_garden_planning_intervals" (
    "id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "frequency" "TaskFrequency" NOT NULL,
    "scheduled_date" DATE,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kitchen_garden_planning_intervals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_garden_executions" (
    "id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "period_key" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT true,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "assigned_participant_id" UUID NOT NULL,
    "completed_by_participant_id" UUID NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "reverted_at" TIMESTAMP(3),
    "reverted_by_user_id" UUID,
    "revert_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kitchen_garden_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_garden_participants_user_id_key" ON "kitchen_garden_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_garden_activities_participant_id_description_key" ON "kitchen_garden_activities"("participant_id", "description");

-- CreateIndex
CREATE INDEX "kitchen_garden_planning_intervals_activity_id_valid_from_idx" ON "kitchen_garden_planning_intervals"("activity_id", "valid_from");

-- CreateIndex
CREATE INDEX "kitchen_garden_planning_intervals_participant_id_valid_from_idx" ON "kitchen_garden_planning_intervals"("participant_id", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_garden_planning_intervals_one_open_per_activity" ON "kitchen_garden_planning_intervals"("activity_id") WHERE (valid_to IS NULL);

-- CreateIndex
CREATE INDEX "kitchen_garden_executions_assigned_participant_id_idx" ON "kitchen_garden_executions"("assigned_participant_id");

-- CreateIndex
CREATE INDEX "kitchen_garden_executions_completed_by_participant_id_idx" ON "kitchen_garden_executions"("completed_by_participant_id");

-- CreateIndex
CREATE INDEX "kitchen_garden_executions_completed_at_idx" ON "kitchen_garden_executions"("completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_garden_executions_activity_id_period_key_key" ON "kitchen_garden_executions"("activity_id", "period_key") WHERE (reverted_at IS NULL);

-- AddForeignKey
ALTER TABLE "kitchen_garden_participants" ADD CONSTRAINT "kitchen_garden_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_activities" ADD CONSTRAINT "kitchen_garden_activities_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "kitchen_garden_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_planning_intervals" ADD CONSTRAINT "kitchen_garden_planning_intervals_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "kitchen_garden_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_planning_intervals" ADD CONSTRAINT "kitchen_garden_planning_intervals_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "kitchen_garden_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_executions" ADD CONSTRAINT "kitchen_garden_executions_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "kitchen_garden_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_executions" ADD CONSTRAINT "kitchen_garden_executions_assigned_participant_id_fkey" FOREIGN KEY ("assigned_participant_id") REFERENCES "kitchen_garden_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_executions" ADD CONSTRAINT "kitchen_garden_executions_completed_by_participant_id_fkey" FOREIGN KEY ("completed_by_participant_id") REFERENCES "kitchen_garden_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_executions" ADD CONSTRAINT "kitchen_garden_executions_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_garden_executions" ADD CONSTRAINT "kitchen_garden_executions_reverted_by_user_id_fkey" FOREIGN KEY ("reverted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── CHECK de coherencia (agregados a mano: Prisma no los declara) ─────────
-- Tablas nuevas y vacías: ninguna fila existente puede violarlos.

-- Actividades: mismas reglas que `tasks` (fecha solo en «Una vez»; orden
-- 1–9999; cada dato de la sugerencia solo en su frecuencia y rango;
-- bimestral y anual con mes y día juntos o ninguno).
ALTER TABLE "kitchen_garden_activities" ADD CONSTRAINT "kitchen_garden_activities_scheduled_date_one_time_check" CHECK ("scheduled_date" IS NULL OR "frequency" = 'ONE_TIME');
ALTER TABLE "kitchen_garden_activities" ADD CONSTRAINT "kitchen_garden_activities_execution_order_check" CHECK ("execution_order" IS NULL OR "execution_order" BETWEEN 1 AND 9999);
ALTER TABLE "kitchen_garden_activities" ADD CONSTRAINT "kitchen_garden_activities_suggested_weekday_check" CHECK ("suggested_weekday" IS NULL OR ("frequency" = 'WEEKLY' AND "suggested_weekday" BETWEEN 1 AND 7));
ALTER TABLE "kitchen_garden_activities" ADD CONSTRAINT "kitchen_garden_activities_suggested_first_half_day_check" CHECK ("suggested_first_half_day" IS NULL OR ("frequency" = 'SEMI_MONTHLY' AND "suggested_first_half_day" BETWEEN 1 AND 15));
ALTER TABLE "kitchen_garden_activities" ADD CONSTRAINT "kitchen_garden_activities_suggested_second_half_day_check" CHECK ("suggested_second_half_day" IS NULL OR ("frequency" = 'SEMI_MONTHLY' AND "suggested_second_half_day" BETWEEN 16 AND 31));
ALTER TABLE "kitchen_garden_activities" ADD CONSTRAINT "kitchen_garden_activities_suggested_month_day_check" CHECK ("suggested_month_day" IS NULL OR ("frequency" IN ('MONTHLY', 'BIMONTHLY', 'ANNUAL') AND "suggested_month_day" BETWEEN 1 AND 31));
ALTER TABLE "kitchen_garden_activities" ADD CONSTRAINT "kitchen_garden_activities_suggested_month_check" CHECK ("suggested_month" IS NULL OR ("frequency" = 'BIMONTHLY' AND "suggested_month" BETWEEN 1 AND 2) OR ("frequency" = 'ANNUAL' AND "suggested_month" BETWEEN 1 AND 12));
ALTER TABLE "kitchen_garden_activities" ADD CONSTRAINT "kitchen_garden_activities_suggested_month_pair_check" CHECK ("frequency" NOT IN ('BIMONTHLY', 'ANNUAL') OR ("suggested_month" IS NULL) = ("suggested_month_day" IS NULL));

-- Planificación: rango válido y fecha solo en una versión «Una vez».
ALTER TABLE "kitchen_garden_planning_intervals" ADD CONSTRAINT "kitchen_garden_planning_intervals_valid_range_check" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from");
ALTER TABLE "kitchen_garden_planning_intervals" ADD CONSTRAINT "kitchen_garden_planning_intervals_scheduled_date_one_time_check" CHECK ("scheduled_date" IS NULL OR "frequency" = 'ONE_TIME');

-- Ejecuciones: completada si y solo si no fue revertida, y toda reversión
-- registra quién la hizo (mismas reglas que `task_executions`).
ALTER TABLE "kitchen_garden_executions" ADD CONSTRAINT "kitchen_garden_executions_completed_iff_not_reverted_check" CHECK ("completed" = ("reverted_at" IS NULL));
ALTER TABLE "kitchen_garden_executions" ADD CONSTRAINT "kitchen_garden_executions_reverted_by_iff_reverted_at_check" CHECK (("reverted_at" IS NULL) = ("reverted_by_user_id" IS NULL));
