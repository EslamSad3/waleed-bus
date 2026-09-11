-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "boarded_at" TIMESTAMP(3),
ADD COLUMN     "boarded_by" UUID,
ADD COLUMN     "bus_rated_at" TIMESTAMP(3),
ADD COLUMN     "bus_rating" INTEGER,
ADD COLUMN     "driver_rated_at" TIMESTAMP(3),
ADD COLUMN     "driver_rating" INTEGER,
ADD COLUMN     "drop_reason" VARCHAR(500),
ADD COLUMN     "drop_station_id" VARCHAR(100),
ADD COLUMN     "drop_status" VARCHAR(20),
ADD COLUMN     "dropped_at" TIMESTAMP(3),
ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "passenger_rated_at" TIMESTAMP(3),
ADD COLUMN     "passenger_rating" INTEGER,
ADD COLUMN     "payment_marked_by" UUID,
ADD COLUMN     "payment_method" VARCHAR(20),
ADD COLUMN     "payment_status" VARCHAR(20);

-- CreateTable
CREATE TABLE "bus_assignments" (
    "id" UUID NOT NULL,
    "fleet_id" UUID NOT NULL,
    "bus_id" UUID NOT NULL,
    "driver_user_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "assigned_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "bus_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passenger_reports" (
    "id" UUID NOT NULL,
    "fleet_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "passenger_id" UUID,
    "driver_id" UUID NOT NULL,
    "note" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passenger_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bus_assignments_fleet_id_idx" ON "bus_assignments"("fleet_id");

-- CreateIndex
CREATE INDEX "bus_assignments_bus_id_idx" ON "bus_assignments"("bus_id");

-- CreateIndex
CREATE INDEX "bus_assignments_driver_user_id_idx" ON "bus_assignments"("driver_user_id");

-- CreateIndex
CREATE INDEX "passenger_reports_fleet_id_idx" ON "passenger_reports"("fleet_id");

-- CreateIndex
CREATE INDEX "passenger_reports_trip_id_idx" ON "passenger_reports"("trip_id");

-- CreateIndex
CREATE INDEX "passenger_reports_booking_id_idx" ON "passenger_reports"("booking_id");

-- AddForeignKey
ALTER TABLE "bus_assignments" ADD CONSTRAINT "bus_assignments_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_assignments" ADD CONSTRAINT "bus_assignments_bus_id_fkey" FOREIGN KEY ("bus_id") REFERENCES "buses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_assignments" ADD CONSTRAINT "bus_assignments_driver_user_id_fkey" FOREIGN KEY ("driver_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_reports" ADD CONSTRAINT "passenger_reports_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_reports" ADD CONSTRAINT "passenger_reports_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_reports" ADD CONSTRAINT "passenger_reports_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_reports" ADD CONSTRAINT "passenger_reports_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Spec 003: single-active assignment invariants (partial unique indexes —
-- Prisma has no syntax for these, so they live here, not in schema.prisma).
CREATE UNIQUE INDEX "bus_assignments_one_active_per_bus" ON "bus_assignments"("bus_id") WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX "bus_assignments_one_active_per_driver" ON "bus_assignments"("driver_user_id") WHERE status = 'ACTIVE';

-- Spec 003: status domain constraints (application-layer tokens, enforced in DB too).
ALTER TABLE "bus_assignments" ADD CONSTRAINT "bus_assignments_status_check" CHECK (status IN ('ACTIVE', 'ENDED'));
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_drop_status_check" CHECK (drop_status IN ('DROPPED_OFF', 'NOT_DROPPED_OFF'));
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_payment_status_check" CHECK (payment_status IN ('PAID'));

-- Spec 003: fleet_owner / driver / independent_driver roles + permission catalog.
-- Idempotent (safe on DBs seeded by prisma/seed.ts): roles merge by slug,
-- permissions and links are ensured without touching existing rows.
-- Deterministic UUIDs (no pgcrypto dependency).
INSERT INTO "permissions" ("id", "key", "resource", "action", "description", "is_system", "is_active", "created_at", "updated_at")
VALUES
  ('e99561ec-7861-5478-8d41-ad6bd7bf5d7e', 'fleet.buses.read', 'fleet.buses', 'read', 'read owned fleet buses', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a1f55400-d508-5921-9c12-7f53176213bc', 'fleet.buses.create', 'fleet.buses', 'create', 'add buses to the owned fleet', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('9f5ee386-df6e-53e5-b408-638da6160dc7', 'fleet.buses.update', 'fleet.buses', 'update', 'modify/disable/reactivate owned fleet buses', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('d6f69d37-d228-587f-8f40-76d92a80074f', 'fleet.trips.read', 'fleet.trips', 'read', 'read owned fleet trips', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a5bda2c7-3ac7-51a4-bc9e-6125026dc9a3', 'fleet.drivers.read', 'fleet.drivers', 'read', 'read the driver roster', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5e17eb65-89aa-5e00-bb19-2d6b10da40fe', 'fleet.drivers.create', 'fleet.drivers', 'create', 'invite drivers to the fleet', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('acb2aa63-1a78-5d4c-a7b5-648431de4175', 'fleet.drivers.update', 'fleet.drivers', 'update', 'update roster entries and bus assignments', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cf1a23e2-bf75-5870-8bed-94f6005fe671', 'fleet.drivers.delete', 'fleet.drivers', 'delete', 'remove drivers and unassign buses', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('b190b26d-9bb5-5862-a3be-620a207aa618', 'fleet.reports.read', 'fleet.reports', 'read', 'read fleet reports and rating summaries', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('6ffd8c2a-8589-5a07-8eae-7583f559be1c', 'driver.context.read', 'driver.context', 'read', 'read assigned bus/fleet/trips', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('6248dbe6-067e-52bb-a3af-9e65918d7720', 'driver.passengers.read', 'driver.passengers', 'read', 'read the passenger manifest', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5fa9049b-e1d9-523b-b5e2-00afa7a49785', 'driver.trips.operate', 'driver.trips', 'operate', 'board/drop-off/cash-payment/rate/report operations', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "roles" ("id", "name", "slug", "description", "is_system", "is_active", "created_at", "updated_at")
VALUES
  ('2fd1912e-2290-543d-82a7-6ff7d96c9f0f', 'Fleet Owner', 'fleet_owner', 'Owns buses, roster, assignments, and reports of a fleet (spec 003)', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('eeeea002-cb7a-509d-ac29-9842b5d345b0', 'Driver', 'driver', 'Operates assigned-bus trips: manifest, board, drop-off, payment, feedback (spec 003)', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('6c386217-d846-57eb-bb57-3b09d3a3edf4', 'Independent Driver', 'independent_driver', 'Solo driver: union of owner bus/trip reads and driver operations over a personal fleet (spec 003 US5)', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description", "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'fleet.buses.read', 'fleet.buses.create', 'fleet.buses.update', 'fleet.trips.read', 'fleet.drivers.read', 'fleet.drivers.create', 'fleet.drivers.update', 'fleet.drivers.delete', 'fleet.reports.read'
) WHERE r."slug" = 'fleet_owner'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'driver.context.read', 'driver.passengers.read', 'driver.trips.operate'
) WHERE r."slug" = 'driver'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'fleet.buses.read', 'fleet.buses.create', 'fleet.buses.update', 'fleet.trips.read', 'fleet.reports.read', 'driver.context.read', 'driver.passengers.read', 'driver.trips.operate'
) WHERE r."slug" = 'independent_driver'
ON CONFLICT DO NOTHING;
