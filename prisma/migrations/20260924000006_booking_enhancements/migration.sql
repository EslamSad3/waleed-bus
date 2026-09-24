-- Spec 010: per-user booking seat override, booking subject, booking note.
-- All additive with safe defaults (existing rows stay valid):
-- max_booking_seats NULL = platform default (5); booking_for defaults SELF.
-- NOTE: the `governorates.id DROP DEFAULT` drift statement reported by
-- `prisma migrate diff` is unrelated and intentionally excluded.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "booking_for" VARCHAR(20) NOT NULL DEFAULT 'SELF',
ADD COLUMN     "note" VARCHAR(1000);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "max_booking_seats" INTEGER;
