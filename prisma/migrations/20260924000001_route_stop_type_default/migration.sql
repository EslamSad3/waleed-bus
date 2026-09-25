-- Spec 006 follow-up: new RouteStation writes are BOARDING|LANDING only
-- (BOTH rejected at the DTO layer). Default moves to BOARDING; legacy BOTH
-- rows are untouched and remain readable as both boarding and landing.
-- NOTE: the `governorates.id DROP DEFAULT` drift statement reported by
-- `prisma migrate diff` is unrelated and intentionally excluded.

-- AlterTable
ALTER TABLE "route_stations" ALTER COLUMN "stop_type" SET DEFAULT 'BOARDING';
