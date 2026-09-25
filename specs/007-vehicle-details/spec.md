# Feature Specification: Vehicle Details + Brand Dictionary

**Feature Branch**: `feature/waleed-call-requirements`

**Created**: 2026-09-24

**Status**: Draft

**Input**: Call requirements plan `waleed-bus-implementation-plan.md` §§24–26, 53, 75, 84, 95.

## Decisions

- `VehicleBrand` is an admin-managed dictionary (frozen 2026-09-24).
- Required on create: `plateNumber`, `color`, `imageUrl`. Optional: `brandId`, `isAirConditioned`, `modelYear`.
- DB columns added nullable-first (backfill strategy); required-ness enforced at the create-DTO layer so existing rows stay valid.
- `imageUrl` is a validated absolute HTTPS URL stored on the bus. Canonical source is Supabase Storage: `POST /fleets/:fleetId/uploads/bus-image` (multipart, 5MB, JPEG/PNG/WebP magic-byte, sharp 1600px/q80, service-role upload, public URL) — implemented, with upload e2e/unit coverage. The dashboard create form is upload-only (no external paste field).

## User Scenarios

### Story 1 — Brand dictionary (P1)

Super-admin manages `VehicleBrand` (`name` unique, `isActive`, `sortOrder`): list (ordered), create, rename, activate/deactivate. Inactive brands cannot be assigned to new/updated buses. No destructive delete while buses reference a brand (409).

**Acceptance**:
1. Create brand with unique name → persisted with sortOrder.
2. Duplicate name → 409.
3. Assign inactive/unknown `brandId` to a bus → 422 `INVALID_BRAND`.
4. Delete referenced brand → rejected (no orphan buses).

### Story 2 — Bus create with vehicle details (P1)

**Acceptance**:
1. Create bus with plate + color + imageUrl (+ optional brand/AC/year) → 201.
2. Create bus missing any of plate/color/imageUrl → 400.
3. `imageUrl` non-HTTPS → 400.
4. `modelYear` outside 1980..(currentYear+1) → 400.
5. Update bus without image → existing `imageUrl` retained (no re-upload required).
6. Bus responses include `brand` object when assigned + all new fields.

### Story 3 — Discovery read model (P1, forward-compat)

Bus payloads already carry the new fields; fleet-owner discovery (spec 008) reuses them. No extra work here beyond response DTO completeness.

## Constraints

- Bus is fleet-owned: tenant RLS path via `FleetPathService` (no RLS changes — new columns ride the existing `buses` policies).
- `VehicleBrand` is platform catalog: system path, `@Platform()`, `buses.*` permission keys; catalog-excluded from RLS check + revoked from `app_tenant`.
- `{ statusCode, data }` envelope; no TS enums; audit brand mutations + bus create/update already audited? (verify — bus mutations currently have NO audit; add `bus.create/update` audit entries consistent with stops).
- TDD red → green; e2e against real Postgres.
