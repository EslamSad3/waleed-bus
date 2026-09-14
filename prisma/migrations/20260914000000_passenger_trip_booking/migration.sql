-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "cancellation_reason" VARCHAR(500),
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by" UUID,
ADD COLUMN     "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "passenger_user_id" UUID,
ADD COLUMN     "total_amount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "fare" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "route_id" UUID;

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "fleet_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "origin" VARCHAR(255) NOT NULL,
    "destination" VARCHAR(255) NOT NULL,
    "qr_identifier" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stations" (
    "id" UUID NOT NULL,
    "fleet_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "address" VARCHAR(500),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stations" (
    "id" UUID NOT NULL,
    "fleet_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "stop_order" INTEGER NOT NULL,
    "estimated_stop_minutes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_shares" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "verification_code" VARCHAR(10) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "routes_qr_identifier_key" ON "routes"("qr_identifier");

-- CreateIndex
CREATE INDEX "routes_fleet_id_idx" ON "routes"("fleet_id");

-- CreateIndex
CREATE UNIQUE INDEX "routes_fleet_id_code_key" ON "routes"("fleet_id", "code");

-- CreateIndex
CREATE INDEX "stations_fleet_id_idx" ON "stations"("fleet_id");

-- CreateIndex
CREATE INDEX "route_stations_fleet_id_idx" ON "route_stations"("fleet_id");

-- CreateIndex
CREATE INDEX "route_stations_station_id_idx" ON "route_stations"("station_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_stations_route_id_stop_order_key" ON "route_stations"("route_id", "stop_order");

-- CreateIndex
CREATE UNIQUE INDEX "route_stations_route_id_station_id_key" ON "route_stations"("route_id", "station_id");

-- CreateIndex
CREATE INDEX "trip_shares_booking_id_idx" ON "trip_shares"("booking_id");

-- CreateIndex
CREATE INDEX "trip_shares_expires_at_idx" ON "trip_shares"("expires_at");

-- CreateIndex
CREATE INDEX "bookings_passenger_user_id_idx" ON "bookings"("passenger_user_id");

-- CreateIndex
CREATE INDEX "trips_route_id_idx" ON "trips"("route_id");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_passenger_user_id_fkey" FOREIGN KEY ("passenger_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stations" ADD CONSTRAINT "stations_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stations" ADD CONSTRAINT "route_stations_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stations" ADD CONSTRAINT "route_stations_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stations" ADD CONSTRAINT "route_stations_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_shares" ADD CONSTRAINT "trip_shares_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Update payment_status check constraint to support passenger booking lifecycle
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_payment_status_check";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_payment_status_check" CHECK (payment_status IN ('PENDING', 'PAID', 'CANCELLED', 'REFUND_PENDING', 'UNPAID'));
