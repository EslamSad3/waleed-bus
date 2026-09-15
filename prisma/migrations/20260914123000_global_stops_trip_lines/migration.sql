-- Make stops and trip lines platform-wide catalog data. Existing rows are
-- preserved; only their obsolete fleet ownership is removed.
ALTER TABLE "route_stations" DROP CONSTRAINT IF EXISTS "route_stations_fleet_id_fkey";
ALTER TABLE "routes" DROP CONSTRAINT IF EXISTS "routes_fleet_id_fkey";
ALTER TABLE "stations" DROP CONSTRAINT IF EXISTS "stations_fleet_id_fkey";

ALTER TABLE public.routes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_stations DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.routes;
DROP POLICY IF EXISTS tenant_isolation ON public.stations;
DROP POLICY IF EXISTS tenant_isolation ON public.route_stations;

DROP INDEX IF EXISTS "routes_fleet_id_idx";
DROP INDEX IF EXISTS "stations_fleet_id_idx";
DROP INDEX IF EXISTS "route_stations_fleet_id_idx";
DROP INDEX IF EXISTS "routes_fleet_id_code_key";

ALTER TABLE "routes" DROP COLUMN "fleet_id";
ALTER TABLE "stations" DROP COLUMN "fleet_id";
ALTER TABLE "route_stations" DROP COLUMN "fleet_id";
ALTER TABLE "routes" ADD CONSTRAINT "routes_code_key" UNIQUE ("code");

ALTER TABLE "buses" ADD COLUMN "route_id" UUID;
CREATE INDEX "buses_route_id_idx" ON "buses"("route_id");
ALTER TABLE "buses" ADD CONSTRAINT "buses_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

REVOKE ALL ON public.routes, public.stations, public.route_stations FROM app_tenant;
