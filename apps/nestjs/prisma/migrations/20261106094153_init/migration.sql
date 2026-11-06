-- CreateEnum
CREATE TYPE "place_type" AS ENUM ('fuel_station', 'depot', 'workshop', 'rest_area', 'customer', 'other');

-- CreateEnum
CREATE TYPE "energy" AS ENUM ('diesel', 'b100', 'hvo');

-- CreateEnum
CREATE TYPE "reading_source" AS ENUM ('history', 'live');

-- CreateEnum
CREATE TYPE "refuel_source" AS ENUM ('fuel_card', 'invoice');

-- CreateEnum
CREATE TYPE "alert_type" AS ENUM ('fuel_drop');

-- CreateEnum
CREATE TYPE "alert_status" AS ENUM ('detected', 'investigating', 'closed', 'escalated', 'confirmed', 'dismissed');

-- CreateEnum
CREATE TYPE "alert_decision" AS ENUM ('auto_closed', 'escalated');

-- CreateEnum
CREATE TYPE "investigation_status" AS ENUM ('running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "verdict_category" AS ENUM ('theft_suspected', 'sensor_fault', 'equipment_transfer', 'legitimate_operation', 'billing_discrepancy', 'inconclusive');

-- CreateEnum
CREATE TYPE "step_kind" AS ENUM ('reasoning', 'tool_call', 'tool_result', 'retry', 'error', 'verdict');

-- CreateEnum
CREATE TYPE "review_decision" AS ENUM ('confirm', 'dismiss');

-- CreateEnum
CREATE TYPE "task_type" AS ENUM ('investigate_alert');

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('pending', 'in_progress', 'done', 'failed');

-- CreateTable
CREATE TABLE "carriers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,

    CONSTRAINT "carriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "places" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "type" "place_type" NOT NULL,
    "brand" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "radius_m" INTEGER NOT NULL DEFAULT 150,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trucks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "carrier_id" UUID NOT NULL,
    "plate" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "energy" "energy" NOT NULL,
    "tank_capacity_l" INTEGER NOT NULL,
    "has_reefer" BOOLEAN NOT NULL,
    "baseline_l_per_100km" DECIMAL(4,1) NOT NULL,
    "idle_l_per_hour" DECIMAL(3,1) NOT NULL,
    "home_depot_id" UUID NOT NULL,
    "sensor_notes" TEXT,

    CONSTRAINT "trucks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "carrier_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "pseudonym" TEXT NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "truck_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "driver_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_readings" (
    "id" BIGSERIAL NOT NULL,
    "truck_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "speed_kmh" DECIMAL(5,1) NOT NULL,
    "ignition" BOOLEAN NOT NULL,
    "fuel_level_l" DECIMAL(6,1) NOT NULL,
    "odometer_km" DECIMAL(9,1) NOT NULL,
    "source" "reading_source" NOT NULL,

    CONSTRAINT "telemetry_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refuels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "truck_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "place_id" UUID,
    "liters" DECIMAL(6,1) NOT NULL,
    "unit_price_eur" DECIMAL(5,3),
    "total_eur" DECIMAL(8,2),
    "source" "refuel_source" NOT NULL,
    "data_origin" "reading_source" NOT NULL,

    CONSTRAINT "refuels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "driver_id" UUID NOT NULL,
    "truck_id" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL,
    "body" TEXT NOT NULL,
    "data_origin" "reading_source" NOT NULL,

    CONSTRAINT "driver_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "truck_id" UUID NOT NULL,
    "type" "alert_type" NOT NULL,
    "status" "alert_status" NOT NULL DEFAULT 'detected',
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "window_end" TIMESTAMPTZ(3) NOT NULL,
    "drop_l" DECIMAL(6,1),
    "details" JSONB NOT NULL DEFAULT '{}',
    "detected_at" TIMESTAMPTZ(3) NOT NULL,
    "decision" "alert_decision",

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "alert_id" UUID NOT NULL,
    "status" "investigation_status" NOT NULL,
    "model" TEXT,
    "prompt_version" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "category" "verdict_category",
    "confidence" DECIMAL(3,2),
    "summary" TEXT,
    "verdict" JSONB,
    "tool_calls_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "investigations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "investigation_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "seq" INTEGER NOT NULL,
    "kind" "step_kind" NOT NULL,
    "tool_name" TEXT,
    "tool_call_id" TEXT,
    "payload" JSONB NOT NULL,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigation_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "human_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "alert_id" UUID NOT NULL,
    "decision" "review_decision" NOT NULL,
    "comment" TEXT,
    "reviewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "human_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "task_type" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "task_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trucks_plate_key" ON "trucks"("plate");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_pseudonym_key" ON "drivers"("pseudonym");

-- CreateIndex
CREATE INDEX "telemetry_readings_truck_id_recorded_at_idx" ON "telemetry_readings"("truck_id", "recorded_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "telemetry_readings_truck_id_recorded_at_key" ON "telemetry_readings"("truck_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "refuels_truck_id_occurred_at_key" ON "refuels"("truck_id", "occurred_at");

-- CreateIndex
CREATE INDEX "driver_messages_truck_id_sent_at_idx" ON "driver_messages"("truck_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "driver_messages_driver_id_sent_at_key" ON "driver_messages"("driver_id", "sent_at");

-- CreateIndex
CREATE INDEX "alerts_truck_id_type_window_end_idx" ON "alerts"("truck_id", "type", "window_end");

-- CreateIndex
CREATE INDEX "alerts_detected_at_idx" ON "alerts"("detected_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "investigations_alert_id_key" ON "investigations"("alert_id");

-- CreateIndex
CREATE UNIQUE INDEX "investigation_steps_investigation_id_attempt_seq_key" ON "investigation_steps"("investigation_id", "attempt", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "human_reviews_alert_id_key" ON "human_reviews"("alert_id");

-- AddForeignKey
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "carriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_home_depot_id_fkey" FOREIGN KEY ("home_depot_id") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "carriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_truck_id_fkey" FOREIGN KEY ("truck_id") REFERENCES "trucks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_readings" ADD CONSTRAINT "telemetry_readings_truck_id_fkey" FOREIGN KEY ("truck_id") REFERENCES "trucks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refuels" ADD CONSTRAINT "refuels_truck_id_fkey" FOREIGN KEY ("truck_id") REFERENCES "trucks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refuels" ADD CONSTRAINT "refuels_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_messages" ADD CONSTRAINT "driver_messages_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_messages" ADD CONSTRAINT "driver_messages_truck_id_fkey" FOREIGN KEY ("truck_id") REFERENCES "trucks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_truck_id_fkey" FOREIGN KEY ("truck_id") REFERENCES "trucks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_steps" ADD CONSTRAINT "investigation_steps_investigation_id_fkey" FOREIGN KEY ("investigation_id") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_reviews" ADD CONSTRAINT "human_reviews_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Manual additions (not expressible in schema.prisma)

-- Partial index of the task queue (spec 01)
CREATE INDEX "tasks_type_created_at_open_idx" ON "tasks"("type", "created_at") WHERE "status" IN ('pending', 'in_progress');

-- Lookup of an alert's task (payload ->> 'alertId')
CREATE INDEX "tasks_payload_alert_id_idx" ON "tasks"(("payload" ->> 'alertId'));
