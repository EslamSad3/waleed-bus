-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "payment_notes" VARCHAR(500),
ADD COLUMN     "payment_reference" VARCHAR(100),
ADD COLUMN     "refund_reference" VARCHAR(100),
ADD COLUMN     "refunded_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "passenger_reports" ADD COLUMN     "resolution_note" VARCHAR(2000),
ADD COLUMN     "resolved_at" TIMESTAMP(3),
ADD COLUMN     "resolved_by" UUID,
ADD COLUMN     "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "bookings_payment_status_idx" ON "bookings"("payment_status");

-- CreateIndex
CREATE INDEX "passenger_reports_status_idx" ON "passenger_reports"("status");

-- Update payment_status check constraint to include FAILED, PARTIALLY_REFUNDED, REFUNDED
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_payment_status_check";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_payment_status_check" CHECK (payment_status IS NULL OR payment_status IN ('PENDING', 'PAID', 'CANCELLED', 'REFUND_PENDING', 'UNPAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED'));

-- Add status check constraint on passenger_reports
ALTER TABLE "passenger_reports" DROP CONSTRAINT IF EXISTS "passenger_reports_status_check";
ALTER TABLE "passenger_reports" ADD CONSTRAINT "passenger_reports_status_check" CHECK (status IN ('PENDING', 'RESOLVED', 'DISMISSED'));
