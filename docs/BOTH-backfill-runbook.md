# BOTH stop-type backfill runbook (spec 006 follow-up, call §11)

## Status: NOT YET EXECUTED — requires production access + maintenance window

Application writes already accept `BOARDING | LANDING` only (`BOTH` → 400).
What remains: convert existing `BOTH` rows, then flip the DB default.

## Product rule (decided)

`BOTH` = the bus stops for boarding AND landing → split into an adjacent
`BOARDING` + `LANDING` pair at the same station, preserving semantics.

## Schema blocker (read before writing the migration)

`route_stations` currently enforces:

- `@@unique([routeId, stopOrder])`
- `@@unique([routeId, stationId])`

A same-station pair violates the second constraint, and there is no
fractional `stopOrder` room. The migration must therefore:

1. Drop `@@unique([routeId, stationId])` (pair rows share a station).
2. Rescale `stop_order` (`stop_order * 10`) to open gaps.
3. For each `BOTH` row: set original to `BOARDING`, insert twin `LANDING`
   row at `stop_order + 5` for the same station.
4. Change the column default `BOTH` → `BOARDING` (Prisma schema +
   `stopType @default("BOARDING")`).
5. Keep application read-tolerance for `BOTH` one release, then remove.

## Step 0 — inspect production FIRST (call §11 steps 1–2)

```sql
SELECT r.code AS route, s.name AS station, rs.stop_order, rs.stop_type
FROM route_stations rs
JOIN routes r ON r.id = rs.route_id
JOIN stations s ON s.id = rs.station_id
WHERE rs.stop_type = 'BOTH'
ORDER BY r.code, rs.stop_order;
```

- If zero rows: skip the split, ship only the default flip
  (`ALTER TABLE route_stations ALTER COLUMN stop_type SET DEFAULT 'BOARDING'`
  + Prisma schema default change).
- If rows exist: confirm the split rule with the business owner, then run
  the draft below inside a transaction on a production snapshot first.

## Draft migration (DO NOT place under prisma/migrations/ until Step 0 passes)

```sql
-- 1. Allow same-station pairs.
ALTER TABLE "route_stations" DROP CONSTRAINT IF EXISTS "route_stations_route_id_station_id_key";

-- 2. Open ordering gaps.
UPDATE "route_stations" SET "stop_order" = "stop_order" * 10;

-- 3. Split every BOTH row into BOARDING (+5 LANDING twin).
INSERT INTO "route_stations"
  ("id", "route_id", "station_id", "stop_order", "estimated_stop_minutes", "stop_type", "created_at", "updated_at")
SELECT gen_random_uuid(), "route_id", "station_id", "stop_order" + 5,
       "estimated_stop_minutes", 'LANDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "route_stations" WHERE "stop_type" = 'BOTH';

UPDATE "route_stations" SET "stop_type" = 'BOARDING' WHERE "stop_type" = 'BOTH';

-- 4. Flip the default for all future rows.
ALTER TABLE "route_stations" ALTER COLUMN "stop_type" SET DEFAULT 'BOARDING';
```

(`gen_random_uuid()` requires `pgcrypto`; Supabase provides it. Verify
`SELECT * FROM pg_extension WHERE extname = 'pgcrypto';` first — else
generate UUIDs client-side.)

## Verification after deploy

```sql
SELECT count(*) FROM route_stations WHERE stop_type = 'BOTH'; -- must be 0
SELECT code FROM routes r WHERE EXISTS (
  SELECT 1 FROM route_stations a JOIN route_stations b
    ON a.route_id = b.route_id AND a.station_id = b.station_id
   WHERE a.route_id = r.id AND a.stop_type = 'BOARDING' AND b.stop_type = 'LANDING'
); -- every converted route keeps both directions
```

Then: update `prisma/schema.prisma` (`stopType @default("BOARDING")`),
`pnpm db:migrate:diff` → new migration → deploy → `db:check-rls`.
