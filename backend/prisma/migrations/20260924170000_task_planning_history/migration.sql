CREATE TABLE "task_planning_intervals" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "frequency" "TaskFrequency" NOT NULL,
  "valid_from" TIMESTAMP(3) NOT NULL,
  "valid_to" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_planning_intervals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_planning_intervals_valid_range_check" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT "task_planning_intervals_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "task_planning_intervals_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "task_planning_intervals_task_id_valid_from_idx" ON "task_planning_intervals"("task_id", "valid_from");
CREATE INDEX "task_planning_intervals_employee_id_valid_from_idx" ON "task_planning_intervals"("employee_id", "valid_from");
CREATE UNIQUE INDEX "task_planning_intervals_one_open_per_task" ON "task_planning_intervals"("task_id") WHERE "valid_to" IS NULL;

INSERT INTO "task_planning_intervals" ("id", "task_id", "employee_id", "frequency", "valid_from", "valid_to")
SELECT gen_random_uuid(), "id", "employee_id", "frequency", "created_at",
       CASE WHEN "active" THEN NULL ELSE GREATEST("updated_at", "created_at" + INTERVAL '1 millisecond') END
FROM "tasks";
