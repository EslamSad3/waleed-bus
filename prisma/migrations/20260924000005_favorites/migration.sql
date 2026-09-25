-- Spec 009: passenger favorites (FLEET | BUS) with optional stop prefs.
-- Per-type dedup via (user_id, fleet_id) / (user_id, bus_id) uniques
-- (Postgres NULL-distinct semantics). RLS self-policy + grants land in
-- 001-tenant-isolation.sql via db:setup-rls.
-- NOTE: the `governorates.id DROP DEFAULT` drift statement reported by
-- `prisma migrate diff` is unrelated and intentionally excluded.

-- CreateTable
CREATE TABLE "favorites" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "fleet_id" UUID,
    "bus_id" UUID,
    "boarding_station_id" UUID,
    "landing_station_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "favorites_user_id_idx" ON "favorites"("user_id");

-- CreateIndex
CREATE INDEX "favorites_user_id_type_idx" ON "favorites"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_user_id_fleet_id_key" ON "favorites"("user_id", "fleet_id");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_user_id_bus_id_key" ON "favorites"("user_id", "bus_id");

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
