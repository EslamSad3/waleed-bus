ALTER TABLE "route_stations"
  ADD COLUMN IF NOT EXISTS "stop_type" VARCHAR(20) NOT NULL DEFAULT 'BOTH';

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "boarding_station_id" UUID,
  ADD COLUMN IF NOT EXISTS "landing_station_id" UUID,
  ADD COLUMN IF NOT EXISTS "pickup_address" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "pickup_latitude" DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS "pickup_longitude" DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS "pickup_location_confirmed" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS "bookings_boarding_station_id_idx" ON "bookings"("boarding_station_id");
CREATE INDEX IF NOT EXISTS "bookings_landing_station_id_idx" ON "bookings"("landing_station_id");
