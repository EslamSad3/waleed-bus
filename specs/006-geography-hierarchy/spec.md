# Feature Specification: Geography Hierarchy (Governorate → Markaz → Locality → Station)

**Feature Branch**: `feature/waleed-call-requirements`

**Created**: 2026-09-24

**Status**: Draft

**Input**: Call requirements plan `waleed-bus-implementation-plan.md` §§4–7, 54–55, 81–82, 93.

## Clarifications (frozen 2026-09-24)

- Favorite scope: FLEET + BUS only (no TRIP).
- Promotion reuse: one-time per user (needs redemption record — spec 008, not this spec).
- VIP ownership: `Fleet.vipTierId` (spec 009, not this spec).
- VehicleBrand: admin-managed dictionary (spec 007, not this spec).
- First slice: all releases sequentially; geography is the foundation.

## User Scenarios

### Story 1 — Manage Markaz/District dictionary (P1)

A super-admin creates a Markaz under exactly one Governorate (code unique, names searchable, isActive flag). Inactive Markaz cannot be selected for new Locality/Station creation. Deleting a Markaz with children is rejected; deactivation is used instead.

**Acceptance**:
1. Given an existing governorate, when creating a Markaz with a unique code + names, then it is persisted with `governorateId` set.
2. Given a `governorateId` that does not exist, when creating a Markaz, then the API rejects with `INVALID_GOVERNORATE` (422).
3. Given a duplicate `code`, when creating a Markaz, then the API rejects with a conflict error.
4. Given a Markaz with localities, when deleting it, then the API rejects with `MARKAZ_IN_USE` (409).

### Story 2 — Manage City/Village localities (P1)

A super-admin creates a Locality (`CITY` | `VILLAGE`) under exactly one Markaz. The locality dropdown is dependent on the selected Markaz.

**Acceptance**:
1. Given an active Markaz, when creating a Locality with `type=CITY|VILLAGE`, then it is persisted.
2. Given a `markazId` that does not exist or is inactive, when creating a Locality, then the API rejects with `INVALID_MARKAZ` (422).
3. Given an invalid `type`, when creating a Locality, then validation rejects (`VALIDATION_FAILED`, 400).
4. Given a Locality with stations, when deleting it, then the API rejects with `LOCALITY_IN_USE` (409).

### Story 3 — Create Station under Locality with coordinates (P1)

A super-admin creates a physical Station via Governorate → Markaz → Locality → name + Google-Maps-derived coordinates. The API enforces hierarchy consistency independently of the UI: the station's governorate must equal the locality's markaz's governorate.

**Acceptance**:
1. Given a consistent chain + `latitude ∈ [-90,90]`, `longitude ∈ [-180,180]`, when creating a Station, then it is persisted with `localityId` set.
2. Given `localityId` whose governorate chain mismatches `governorateId`, when creating a Station, then the API rejects with `INVALID_GEO_HIERARCHY` (422).
3. Given out-of-range coordinates, when creating a Station, then validation rejects (400).
4. Given an inactive locality, when creating a Station, then the API rejects with `INVALID_LOCALITY` (422).
5. Station list/detail responses include the full chain: `locality → markaz → governorate`.

### Story 4 — Dependent selectors (P1)

**Acceptance**:
1. `GET /governorates/:id/markaz` returns only active Markaz of that governorate.
2. `GET /markaz/:id/localities` returns only active localities of that Markaz.
3. Changing the parent resets child selection (dashboard behavior; API guarantees no cross-parent references validate).

## Out of scope

Route stop-type cleanup (`BOTH` → `BOARDING|LANDING`), vehicle fields, discovery/VIP, favorites, booking limits/snapshots, promotions, notifications, customer-service config — separate specs.

## Constraints

- Platform-owned catalog data (like `governorates`/`stations`): system Prisma path, `@Platform()`, `stations.*` permission keys. No RLS policies (matches `001-tenant-isolation.sql` line 249: catalog tables are revoked from `app_tenant`).
- `{ statusCode, data }` envelope, cursor pagination for list endpoints, no TS enums (plain strings validated app-layer).
- TDD red → green; e2e against real Postgres.
