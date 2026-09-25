-- Pair model (review round 6): a converted BOTH station lives as an adjacent
-- BOARDING + LANDING pair on the same station, so the (route_id, station_id)
-- uniqueness has to go now (the application already validates the pair rule
-- in TripLinesService.resolveStops and matches stop capability in booking /
-- favorite validation). Ordering stays unique per route via
-- (route_id, stop_order). Idempotent guard — the BOTH runbook draft repeats
-- it with IF EXISTS.

DROP INDEX IF EXISTS "route_stations_route_id_station_id_key";
