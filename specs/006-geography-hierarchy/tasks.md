# Tasks: 006 Geography Hierarchy

- [x] Spec 006 written + frozen decisions recorded
- [x] RED: `src/routes/geography.service.spec.ts` failing tests (markaz/locality/station hierarchy rules)
- [x] Schema: `Markaz`, `Locality` models; `Station.localityId?` (nullable, backfill phase); relations
- [x] Migration SQL: `prisma/migrations/20260924000000_geography_hierarchy/migration.sql` via `db:migrate:diff` (deployed dev + test)
- [x] GREEN: `GeographyService` (CRUD + hierarchy validation + audit) + DTOs
- [x] Controller: platform endpoints in `TripLinesController` (`stations.*` permissions)
- [x] Extend stop list/detail includes: `locality → markaz → governorate`
- [x] `Create/UpdateStopDto` accept `localityId` with `INVALID_GEO_HIERARCHY` check
- [x] E2E: geography hierarchy matrix (12 tests, `test/geography.e2e-spec.ts`)
- [x] `pnpm typecheck && pnpm lint && pnpm test` green (238 unit)
- [x] `pnpm docs:generate` + `docs/openapi.json` regenerated
- [x] RLS: `markazes`/`localities` catalog-excluded + REVOKE, `db:check-rls` green
- [x] Boundary: `routes/geography.service.ts` allowlisted + justified (§7)
- [ ] Dashboard: Markaz/Locality/Stations pages with dependent dropdowns (bus_dashboard branch)

Backfill follow-up (before making `localityId` NOT NULL):
- Map every existing station: governorate → create/default markaz → create/default locality → set `station.localityId`
- Then: enforce NOT NULL + drop legacy direct-governorate write path (keep read compat)

BOTH follow-up (done: writes restricted, reads tolerant):
- [x] `TripLineStopDto.stopType` required BOARDING|LANDING (BOTH → 400)
- [x] Dashboard writers default BOARDING, no BOTH option; legacy BOTH rows display-only, save blocked with guidance
- [x] DB default stays BOTH (reverted ...000001 via ...000002) — system-path rows without explicit type keep legacy semantics; passenger-booking canary green
- [ ] Production: inspect BOTH rows, convert per product rule, then consider tightening further
- [x] E2E `test/trip-lines-stop-type.e2e-spec.ts` (3 tests)
- [x] Test hygiene: `resetDatabase` now truncates markazes/localities/lines/routes/stations/route_stations (governorates stay seeded)

Pre-existing failures (verified on pristine base via stash, unrelated to this work):
- tenant-isolation (2): 500 on fleet bus reads
- fleet-owner (1): bus lifecycle — same area
