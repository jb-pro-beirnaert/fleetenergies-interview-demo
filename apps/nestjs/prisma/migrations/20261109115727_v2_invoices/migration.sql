-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('received', 'extracting', 'extracted', 'matched', 'mismatch', 'needs_review', 'failed');

-- AlterEnum
ALTER TYPE "alert_type" ADD VALUE 'billing_mismatch';

-- AlterEnum
ALTER TYPE "task_type" ADD VALUE 'extract_invoice';

-- AlterTable
ALTER TABLE "refuels" ADD COLUMN     "invoice_id" UUID;

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "invoice_status" NOT NULL DEFAULT 'received',
    "sha256" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "original_filename" TEXT,
    "raw_text" TEXT,
    "extraction" JSONB,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "suspicious_excerpt" TEXT,
    "matched_refuel_id" UUID,
    "match_details" JSONB,
    "alert_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "data_origin" "reading_source" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_sha256_key" ON "invoices"("sha256");

-- CreateIndex
CREATE INDEX "invoices_received_at_idx" ON "invoices"("received_at" DESC);

-- AddForeignKey
ALTER TABLE "refuels" ADD CONSTRAINT "refuels_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_matched_refuel_id_fkey" FOREIGN KEY ("matched_refuel_id") REFERENCES "refuels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
