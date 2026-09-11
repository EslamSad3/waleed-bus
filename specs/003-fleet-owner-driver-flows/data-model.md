# Data Model: Fleet Owner & Bus Driver Flows

**Feature**: `003-fleet-owner-driver-flows` | **Date**: 2026-09-11 | **Source**: research.md R-01–R-10

## New tables

### `bus_assignments` (fleet-owned, RLS `tenant_isolation`)

Binds one driver (a `User`) to one bus as the current operator. History-preserving: rows are never deleted, only ENDED.

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | default `uuid()` |
| `fleet_id` | uuid FK → `fleets`, index | direct ownership column (constitution I); part of every policy |
| `bus_id` | uuid FK → `buses`, index | bus must be in the same fleet — verified in-tx (FK bypasses RLS, so the service loads the bus in the tenant tx; cross-fleet bus → 404) |
| `driver_user_id` | uuid FK → `users`, index | target must be an active user with (or being granted) an ACTIVE driver membership in the fleet |
| `status` | `VARCHAR(20)` | `ACTIVE` \| `ENDED` (DB check constraint, same pattern as `fleet_members_status_check`) |
| `assigned_by` | uuid nullable | actor id (audit join key) |
| `created_at` / `updated_at` | timestamps | |
| `ended_at` | nullable timestamp | set when superseded/removed |

- Partial unique: `UNIQUE (bus_id) WHERE status='ACTIVE'` — one active driver per bus.
- Partial unique: `UNIQUE (driver_user_id) WHERE status='ACTIVE'` — one active bus per driver (PRD §8 one-to-one).
- RLS: added to the `tenant_isolation` loop; `app_tenant` gets `SELECT, INSERT, UPDATE, DELETE` (service only issues INSERT + status/ended updates; DELETE grant keeps the family uniform — no service path deletes).
- Assign (idempotent): in one tenant tx — END active rows for (bus) and (driver), INSERT new ACTIVE row. Repeat with same pair → no-op returning the live row.
- Unassign: `updateMany WHERE bus+driver ACTIVE` → set `ENDED` + `ended_at`. Zero rows → 404 `DRIVER_ASSIGNMENT_NOT_ALLOWED`.

### `passenger_reports` (fleet-owned, RLS `tenant_isolation`)

PRD §15 logical record, verbatim fields plus fleet ownership:

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `fleet_id` | uuid FK → `fleets`, index | from the in-tx trip row, never client input |
| `trip_id` | uuid FK → `trips`, index | in-tx trip; driver must be assigned (R-02) |
| `booking_id` | uuid FK → `bookings`, index | in-tx booking belonging to the trip, else 404 `BOOKING_NOT_ON_TRIP` |
| `passenger_id` | uuid nullable FK → `users` | passenger user when the booking maps to one; nullable (bookings are name+phone rows today) |
| `driver_id` | uuid FK → `users` | reporting driver (= caller) |
| `note` | `VARCHAR(2000)` | required, non-empty, max 2000 |
| `created_at` | timestamp | append-only: no update/delete service path |

- RLS: `tenant_isolation` loop; `app_tenant` gets `INSERT` + `SELECT` (drivers insert; owners read via reports endpoint; no UPDATE/DELETE grants).
- Validation: driver assigned to trip (in-tx) AND booking on trip AND trip not CANCELLED, else `REPORT_NOT_ALLOWED`.

## Extended tables (columns only, no new RLS — already covered)

### `bookings` += operational columns (all nullable; single-row atomic updates)

| Column | Set by | Rule |
|---|---|---|
| `boarded_at`, `boarded_by` | board | set once; repeat → 200 current state |
| `drop_status` (`DROPPED_OFF` \| `NOT_DROPPED_OFF`) | drop-off | terminal per booking; `NOT_DROPPED_OFF` requires `drop_reason` |
| `drop_station_id` (`VARCHAR`) | drop-off | required when `DROPPED_OFF` |
| `drop_reason` (`VARCHAR(500)`) | drop-off | required when `NOT_DROPPED_OFF` (PRD §11 enum e.g. `PASSENGER_DID_NOT_EXIT`, app-layer validated string) |
| `dropped_at` | drop-off | |
| `payment_method` | payment | must equal the booking's authoritative method; driver cannot change amount (PRD §12) |
| `payment_status` (`PAID`) | payment | only from unpaid → `PAID`; amount columns are read from the booking/payment record, never written by the driver |
| `paid_at`, `payment_marked_by` | payment | audit join keys |
| `bus_rating`, `driver_rating` (int 1–5) | passenger `POST /bookings/{id}/rating` | only own booking, trip in ratable state (COMPLETED), bus/driver belong to trip; one write per side (repeat same values → 200; conflicts → 409 `RATING_NOT_ALLOWED`) |
| `passenger_rating` (int 1–5) | driver rating op | same guards mirrored (R-02 anchoring) |
| `rated_at_*` | each rating | per-side timestamp |

No `fleet_id` change: bookings already fleet-owned; new columns inherit the existing policy.

### `users` / `roles` / `fleet_members` — no schema change

- Migration seeds `roles` rows `fleet_owner`, `driver`, `independent_driver` (`isSystem=false`, `isActive=true`) + permission rows/keys (see contracts) + `role_permissions` links.
- Owner authority = ACTIVE membership in a role holding `fleet.*` keys (or `fleets.ownerId = user.id` for bootstrap reads). Driver authority = ACTIVE membership in a role holding `driver.*` keys + live `bus_assignments` row for trip ops.
- Independent drivers (US5, clarify Q2-B, research R-10): NO schema change. A personal fleet row (`ownerId` = driver) + ACTIVE `independent_driver` membership is auto-provisioned at first DRIVER login; the driver's buses/bookings carry that fleet's `fleet_id` like any fleet-owned rows. All RLS/tenant-context rules apply unchanged.
- `nationalId`/`nickname` (PRD §7–§8 data tables): `nickname` maps to existing `users.name` (single display-name column — no new column; confirm in specify); `nationalId` is NOT collected in v1 (no column; PII minimization — confirm in specify).

## State machines (single allow-lists, enforced by guarded writes)

- **Bus lifecycle**: `isActive true ↔ false` via disable/reactivate. Disable guard: no trip with status `DEPARTED` on the bus (409 `BUS_ACTION_NOT_ALLOWED`); SCHEDULED trips → open clarification #3 (plan blocks only DEPARTED). Reactivate always allowed on owned inactive bus.
- **Trip completion (driver)**: `DEPARTED → COMPLETED` via `updateMany WHERE id + status='DEPARTED'`; zero rows → 409 `INVALID_TRIP_STATE`. No other driver-side trip transitions.
- **Booking ops order**: board → (drop-off ∥ payment) → ratings/report. Payment requires boarded; drop-off requires boarded; ratings require COMPLETED trip; report requires booking on an assigned trip.

## Validation summary (every op, same order)

1. Caller authenticated + session live (`JwtAuthGuard`, `authVersion` match).
2. Fleet membership ACTIVE (guard chain) for owner routes; driver routes additionally prove assignment in-tx (R-02).
3. Row ownership re-anchored in-tx (trip → fleet; booking → trip; bus → fleet); cross-fleet → 404, never 403 (no existence oracle).
4. State transition legal (guarded write); repeat → 200 current state; conflict → 409 with PRD §26 code.
5. Audit write (R-08); `authVersion` bump only on authorization-changing mutations.
