# Research: Fleet Owner & Bus Driver Flows

**Feature**: `003-fleet-owner-driver-flows` | **Date**: 2026-09-11
**Method**: Codebase inspection (`src/fleets|buses|trips|bookings|auth|authorization`, `prisma/schema.prisma`, `prisma/sql/rls/*.sql`, `specs/002` plan/research) + Context7 MCP (NestJS `/nestjs/docs.nestjs.com`, Prisma `/prisma/skills`, Supabase `/supabase/supabase` — see Sources) + web best-practice searches (RLS multi-tenancy, NestJS clean controller-service-repository boundaries, OWASP business-logic/state-machine + idempotency). Zero NEEDS CLARIFICATION carry into Phase 1 — the five product-level open points are listed in plan.md, not here.

## R-01 — New fleet-owned tables join the existing `tenant_isolation` policy family

- **Decision**: `bus_assignments` and `passenger_reports` both carry a direct `fleet_id` column and are added to the `FOREACH` policy loop in `prisma/sql/rls/001-tenant-isolation.sql` (same USING + WITH CHECK: `fleet_id` = tx setting AND `app.is_fleet_member`), with least-privilege `app_tenant` grants (`SELECT, INSERT, UPDATE, DELETE` on assignments; `SELECT, INSERT` + owner-side `SELECT` on reports) in section 7 of the same script. `db:check-rls` then enforces them automatically.
- **Rationale**: Constitution I + repo convention (every fleet-owned table has direct `fleet_id`; policies fail closed on missing context). The Supabase/Postgres RLS guidance (Supabase agent-skills RLS basics; oneuptime 2026 RLS guide; quantlabusa 2026 multi-tenant SaaS) converges on exactly this shape: session/transaction setting + `USING`/`WITH CHECK` equality + fail-closed default. `FORCE RLS` stays off per the deliberate owner-path deviation documented in `docs/ARCHITECTURE.md`.
- **Alternatives considered**: (a) Deriving assignment visibility via join to `buses` without own `fleet_id` — rejected (breaks the "direct `fleet_id`, checkable by script" invariant; joins in policies also complicate `WITH CHECK`). (b) `FORCE RLS` — rejected (breaks the privileged owner path; already decided repo-wide).

## R-02 — Driver's fleet context is resolved from the trip row, never from client input

- **Decision**: Every driver operation loads the trip (and booking, where relevant) inside the same `withFleetContext`/tenant transaction, takes `fleetId` from `trip.fleetId`, verifies an ACTIVE `bus_assignments` row (driver = caller, bus = trip.busId, fleet = trip.fleetId) in that same tx, and only then mutates. The `TenantContextGuard` fleet selector (`:fleetId` param / `x-fleet-id` header) is still required for guard-chain membership proof; the service re-anchors on the row.
- **Rationale**: Mirrors `BookingsService.create` (trip loaded in-tx so cross-fleet trips 404 because RLS hides them — FK checks alone would not, they run as owner). Kills the confused-deputy variant where a driver passes their own fleet id with another fleet's trip id. This is the standard "verify ownership inside the transaction" pattern from the Postgres RLS literature (FK bypasses RLS — tentative reads must be tenant-scoped).
- **Alternatives considered**: Trusting guard-resolved `fleetContext.fleetId` alone — rejected (guard proves membership in *a* fleet, not that the trip belongs to it).

## R-03 — Driver↔bus assignment is a history-preserving table, not a column

- **Decision**: New `bus_assignments` (`fleet_id`, `bus_id`, `driver_user_id`, `status ACTIVE|ENDED`, `assigned_by`, timestamps) with partial unique indexes (`one active driver per bus`, `one active bus per driver`). Assign = close any active row for that bus/driver + insert; remove = mark ENDED (rows retained for audit/history). `POST /fleet/buses/{busId}/driver` and `DELETE .../driver` are thin controller aliases over the same service used by `POST /fleet/drivers` roster flows.
- **Rationale**: PRD needs assign/change/remove + "Reports one-to-many" per driver/bus; a column (`bus.driverUserId`) destroys history and cannot express ENDED vs ACTIVE cleanly. Partial unique indexes give race-free single-active guarantees at the DB level (same reasoning as 002's global phone uniqueness). Trip state-machine literature (Uber dispatch analyses, ride-matching design) treats driver↔vehicle binding as an explicit lease/assignment record, not a mutable pointer.
- **Alternatives considered**: Nullable `driver_user_id` column on `buses` — rejected (no history, awkward "change driver" audit, nullable-FK RLS subtleties).

## R-04 — Booking operational state lives on the booking row; reports are their own table

- **Decision**: Extend `bookings` with nullable operational columns (boarded_at/boarded_by, drop_status/drop_station_id/drop_reason/dropped_at, payment_method/payment_status/paid_at/payment_marked_by, bus/driver/passenger ratings + rated_at trio). New `passenger_reports` table follows the PRD §15 logical record verbatim (trip, booking, passenger, driver, note, createdAt).
- **Rationale**: Boarding/drop-off/payment/rating are convergent per-booking state with exactly one writer path (the assigned driver; ratings one row per rater side) — columns keep each op a single-row atomic update, naturally idempotent (R-06). Reports are append-only events with their own readership (owner/admin workflows), so a separate table with its own grants is cleaner and matches the PRD record.
- **Alternatives considered**: Generic `booking_events` ledger — rejected (no event-sourcing consumers exist; plain columns are the simplicity-VI choice). Ratings as separate table — rejected (1:1 with booking per rater side; columns suffice).

## R-05 — Owner/driver login reuses shared login with server-side account-type check

- **Decision**: Extend `AuthService` login: `loginType FLEET_OWNER` requires a live phone+password user who owns ≥1 fleet OR holds an ACTIVE membership in a `fleet_owner`-role; `DRIVER` requires an ACTIVE membership in a `driver`-role. Any mismatch → generic `AUTHENTICATION_FAILED` with the existing dummy-hash timing cover. Token shape, refresh rotation, and `authVersion` semantics unchanged; fleet authority continues to come from per-request membership resolution, not the JWT.
- **Rationale**: PRD §3 ("backend validates the actual account type; `loginType` must not itself grant authorization") + generic-error catalog. Matches the multi-tenant auth-starter pattern (membership-scoped RBAC, rotation with replay detection) found in the NestJS RBAC survey, while honoring constitution II (JWT unchanged) and 002's dummy-hash decision (R-07 there).
- **Alternatives considered**: Separate `/fleet/login`, `/driver/login` routes — rejected (PRD mandates one shared `/auth/login`). Encoding fleet role in `app_role` — rejected (fleet authority is per-membership; JWT is global).

## R-06 — Driver mutations are convergent (naturally idempotent), no idempotency keys

- **Decision**: Board, drop-off, cash-payment, complete, and ratings all `SET desired_state` (not deltas): repeat calls with the same values return the current state 200; conflicting values on a terminal state return 409 with the PRD code (e.g. `INVALID_DROPOFF_STATE`). No `Idempotency-Key` header.
- **Rationale**: Mobile clients retry on flaky networks; the idempotency literature (system-design-patterns idempotency guide: "prefer setting a desired state over applying an unbounded delta") and trip-lifecycle analyses (conditional state-machine updates `WHERE status = …`) both converge on state-setting + guarded transitions. Server-side key stores would be new infra for zero benefit here since no operation is a non-repeatable delta (payment amount is read-only from the booking record per PRD §12).
- **Alternatives considered**: `Idempotency-Key` header store — rejected (new table + retention/fencing machinery for operations that are already convergent).

## R-07 — Explicit transition tables for trip completion and drop-off

- **Decision**: Trip `complete` allowed only from `DEPARTED` → `COMPLETED` (guarded `updateMany WHERE status='DEPARTED'`, zero rows → 409 `INVALID_TRIP_STATE`); departure itself stays with the existing platform flow (open clarification in plan.md). Drop-off writes `DROPPED_OFF` (+station) or `NOT_DROPPED_OFF` (+required reason); both terminal for that booking. Cash payment allowed only on boarded, un-cancelled bookings and never changes the amount.
- **Rationale**: State-machine-as-dictionary (Bailador/Uber trip-lifecycle analyses): one allow-list, illegal transitions fail loudly instead of corrupting data. Guarded conditional writes make concurrent board+cancel/complete races safe without serializable isolation.
- **Alternatives considered**: Application-only `if` checks before update — rejected (TOCTOU under concurrency; the `WHERE`-guarded write is the atomic boundary).

## R-08 — Audit catalog + selective `authVersion` bumps

- **Decision**: Audit `fleet.bus.create/update/disable/reactivate`, `fleet.driver.add/update/remove/assign/unassign`, `driver.trip.complete`, `driver.passenger.board/dropoff/payment/rate/report` (actor, fleet, target ids; never notes content beyond id refs, passwords, or tokens). Bump `authVersion` + revoke sessions only on authorization-changing mutations (driver add/remove/role/status change, assignment change); operational writes (board/drop-off/payment/ratings/complete) do not revoke.
- **Rationale**: Constitution VII (every privileged op audited, no secrets; security-sensitive mutations transactional) + `MembersService.invalidateUserSessions` precedent. Revoking on every boarding event would log drivers out mid-shift; revoking on assignment change closes the stale-driver window.
- **Alternatives considered**: Audit everything including reads — rejected (log volume; reads stay unaudited as today). Bump on all writes — rejected (session churn with no security gain).

## R-09 — Zero new runtime dependencies

- **Decision**: Implement with the existing stack (NestJS guards/decorators, Prisma, `class-validator`, existing `translatePrismaError`, `buildCursorArgs`/`toCursorPage`). No CASL/accesscontrol lib (DB-row permissions + the three existing guards already cover it), no `@nestjs/throttler` (no new throttles beyond login's existing budgets), no Firebase Admin SDK (R-10).
- **Rationale**: Constitution VI; the 002 plan proved the same "no new deps" approach. The NestJS RBAC survey's Guard + Decorator pattern is exactly what `PermissionGuard`/`TenantContextGuard` already implement.
- **Alternatives considered**: CASL/AccessControl — rejected (second authorization model alongside DB-row permissions).

## R-10 — Independent drivers are auto-provisioned personal fleets (clarify Q2-B, decided 2026-09-11)

- **Decision**: A driver with no fleet membership who passes the DRIVER
  credential check gets a personal fleet auto-provisioned at first login
  (system path, same transaction): `fleets` row (`ownerId` = driver),
  ACTIVE membership in the migration-seeded `independent_driver` role
  (union of `fleet.buses.*` + `fleet.trips.read` + `fleet.reports.read` +
  `driver.*` keys), and an audit `driver.fleet.provision` entry. From then
  on the driver is an ordinary fleet member of a one-member fleet: every
  existing RLS policy, the unchanged `TenantContextService`, login,
  assignment, manifest, and report flows apply verbatim.
- **Rationale**: The three candidate designs were (a) nullable-`fleet_id`
  with driver-id-scoped policies, (b) driver-scoped tenant context without
  `fleet_id`, (c) auto-provisioned single-driver fleet. (a) and (b) fork
  the RLS model and every in-tx anchor (R-02) into fleet/fleet-less
  variants — a second authorization model alongside the tenant boundary
  (constitution I/V risk). (c) reuses the entire isolation machinery with
  zero policy/context/data-model changes; the personal fleet is born empty
  so provisioning has no cross-tenant blast radius. Driver-owned buses are
  ordinary `buses` rows in the personal fleet, manageable through the owner
  endpoints the role already grants.
- **Security notes**: provisioning runs only AFTER password verification
  (argon2) inside the login transaction; a verified phone is required
  (junk accounts cannot mint fleets); FLEET_OWNER logins never provision
  (owners are platform-onboarded); the provision is audited with actor +
  fleet ids; personal-fleet trips still come from the platform flow
  (read-only in v1 — independent drivers cannot self-create trips, same
  limitation as owners).
- **Alternatives considered**: (a)/(b) above — rejected (RLS fork).
  Explicit onboarding endpoint (`POST /driver/onboarding`) — rejected
  (extra route for what lazy provisioning does atomically at login).

## Out of scope (unchanged)

- **Decision**: (a) Live location stays client→Firebase RTDB (~15 s cadence per PRD §22); backend ships no Firebase rules/SDK — assignment + trip reads are the backend's contribution. (b) Notifications: device registration/center endpoints are not in §7–§8 scope; driver/owner notification triggers are recorded as future audit-log consumers.
- **Rationale**: No Firebase infra exists in this repo (`package.json`, `src/` have none); adding it would violate VI and expand scope beyond §7–§8.
- **Alternatives considered**: Pulling notifications/tracking into this slice — rejected (separate PRD sections, separate infra).

## Resolved status

All Technical Context unknowns resolved — **zero NEEDS CLARIFICATION** carry into Phase 1. Product-level open points (departure trigger, independent drivers, disable-with-future-trips, reports shape, fleet PII scope) are recorded in plan.md for `/speckit-specify`.

## Sources (fetched 2026-09-11 for this plan refresh)

Context7 MCP:
- `/nestjs/docs.nestjs.com` — "Guards authorization RBAC custom decorators best practices": basic RBAC = custom decorator attaches required roles as metadata + guard checks via `Reflector`; deny via `false` (→ 403) or throw a specific exception for a custom body; `applyDecorators` composes `SetMetadata + UseGuards + ApiBearerAuth` into one reusable decorator; global guard via `APP_GUARD` with `@Public()` metadata bypass. Applied: keep existing `PermissionGuard`/`TenantContextGuard` chain, add `@RequirePermission('fleet.buses.*' | 'driver.trips.operate' | …)` keys + `DriverTripGuard` — no new guard framework.
- `/prisma/skills` — "interactive transactions / transaction options": complex dependent logic runs in `prisma.$transaction(async (tx) => …)` with the `tx`-scoped client; options `maxWait/timeout/isolationLevel` (`Serializable` for atomic check-then-act). Applied: every driver/owner mutation runs inside `TenantContextService.withFleetContext` (which is `$transaction` + `set_config(..., true)` first), guarded writes use `updateMany WHERE <expected-state>` and check affected rows.
- `/supabase/supabase` — "RLS USING/WITH CHECK": if no `WITH CHECK` is defined, `USING` alone also gates new rows — so an explicit `WITH CHECK` is required to bracket writes; multi-tenant pattern = membership-check function (`is_project_member`) referenced from `USING` (reads) and `WITH CHECK` (writes) per command. Applied: new tables join the `tenant_isolation` `FOR ALL … USING (…) WITH CHECK (…)` family keyed on `fleet_id = tx setting AND app.is_fleet_member(...)`.

Web (best practices, clean code, RLS, security):
- RLS fail-closed multi-tenancy (Chaysen Rathert 2026; Palma 2026; multi-tenant-saas.com; AverageDevs 2026; McClarence 2026): `tenant_id`/`fleet_id` column on every tenant table + transaction-local `set_config('app.tenant_id', …, true)` / `SET LOCAL` per request (never session `SET` under PgBouncer transaction pooling) + policy `USING` + identical `WITH CHECK` + `current_setting(..., true)` NULL → zero rows + non-BYPASSRLS app role + `(tenant_id, …)` composite indexes + negative CI tests. This repo already implements the pattern (`TenantContextService`, `tenant_isolation` policy, `app_tenant` role); the plan extends it unchanged to the two new tables.
- NestJS clean boundaries (dev.to franciscuo 2026; NestJS Ninja 2026; Encore 2026 project-structure guide): thin controllers (DTO → service input mapping only), services own business rules and throw domain errors, repositories own persistence; feature-based modules (`src/fleet-owner/`, `src/driver-ops/`) over layered folders; DTO↔service-input mapping at the boundary; one orchestrator owns the transaction. Applied: `fleet-owner.service.ts` / `driver-ops.service.ts` orchestrate inside one tenant tx; controllers never touch Prisma (implements the PRD §7 request/approval seam as a narrow `FleetChangeApplier` interface).
- State machines + idempotency + OWASP business-logic cheat sheet: enforce workflows as explicit server-side state machines (never UI-gated); convergent `SET desired_state` transitions (repeat → 200 current, conflict → 409 with current state + allowed actions); check-then-act must be atomic (conditional `UPDATE … WHERE status=…`, `SELECT … FOR UPDATE`, or optimistic version); derive security values (price/amount, ownership, identity) server-side, never from client input; scope idempotency keys per tenant. Applied: R-06/R-07 (guarded `DEPARTED→COMPLETED`, terminal drop-off, read-only payment amount, 404-not-403 cross-fleet).
