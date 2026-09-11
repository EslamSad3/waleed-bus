# Tasks: Fleet Owner & Bus Driver Flows

**Input**: Design documents from `/specs/003-fleet-owner-driver-flows/` (plan.md + 2026-09-11 clarification decisions, research.md R-01–R-10, data-model.md, contracts/fleet-owner.md, contracts/driver.md, contracts/errors.md, quickstart.md; no ratified spec.md — user stories derived from PRD §7–§8 + contracts and confirmed by plan.md). Clarify decisions applied: Q2-B independent drivers supported in v1 (new US5); Q3-A disable blocked on DEPARTED only (no task change); Q4-A reports list+summary (no task change); Q5-B `/driver/fleet` adds owner contact (T030 updated); trips lifecycle (departure/start/complete) DEFERRED — `POST .../complete` excluded this round (T028/T031/T033 updated).

**Prerequisites**: plan.md, research.md (R-01–R-10), data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED — constitution principle IV mandates TDD red→green; every story starts with failing unit + e2e specs written first.

**Organization**: Tasks grouped by user story; each story independently implementable and testable after Foundational phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1–US5)
- Exact file paths in every description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Branch, migration shell, module scaffolds

- [X] T001 Create feature branch `003-fleet-owner-driver-flows` from `main` via `git checkout -b`
- [X] T002 [P] Scaffold `src/fleet-owner/` module shell (fleet-owner.module.ts, fleet-owner.controller.ts, fleet-owner.service.ts, bus-lifecycle.service.ts, dto/fleet-owner.dto.ts)
- [X] T003 [P] Scaffold `src/driver-ops/` module shell (driver-ops.module.ts, driver-ops.controller.ts, driver-ops.service.ts, driver-trip.guard.ts, dto/driver-ops.dto.ts)
- [X] T004 Create migration directory `prisma/migrations/<timestamp>_fleet_owner_driver/` with empty `migration.sql` placeholder

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, RLS, RBAC seeds, shared login extension — MUST complete before ANY user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 Add `BusAssignment` + `PassengerReport` models and Booking operational columns to `prisma/schema.prisma` per `specs/003-fleet-owner-driver-flows/data-model.md`
- [X] T006 Generate migration SQL via `pnpm db:migrate:diff`, save to `prisma/migrations/<timestamp>_fleet_owner_driver/migration.sql`, including `fleet_owner`/`driver` role + permission-key seeds
- [X] T007 Extend `prisma/sql/rls/001-tenant-isolation.sql` with `tenant_isolation` policies + least-privilege `app_tenant` grants for `bus_assignments` and `passenger_reports`
- [X] T008 Run `pnpm db:generate` to regenerate Prisma client in `src/generated/prisma/`
- [X] T009 Extend `LoginRequestDto` in `src/auth/dto/auth.dto.ts` to document FLEET_OWNER/DRIVER phone variants
- [X] T010 Implement FLEET_OWNER/DRIVER account-type verification in `src/auth/auth.service.ts` (membership/role check, generic `AUTHENTICATION_FAILED`, dummy-hash timing cover per research R-05)
- [X] T011 Extend `src/common/filters/all-exceptions.filter.ts` with PRD §26 `code`/`details` error body per `specs/003-fleet-owner-driver-flows/contracts/errors.md`
- [X] T012 Verify foundation via `pnpm db:migrate:deploy`, `pnpm db:setup-rls`, `pnpm db:check-rls` against local embedded PG

**Checkpoint**: Foundation ready — `bus_assignments`/`passenger_reports` migrated + RLS-enforced, owner/driver login works, error codes flow. User stories can now begin.

---

## Phase 3: User Story 1 — Fleet Owner Bus & Trip Management (Priority: P1) 🎯 MVP

**Goal**: Owner logs in with phone+password, manages profile, views owned buses/trips, adds/modifies/disables/reactivates buses.

**Independent Test**: Quickstart Scenario A — login, list/get/create/update/disable/reactivate bus, cross-fleet 404s, all via `test/fleet-owner.e2e-spec.ts`.

### Tests for User Story 1 (write FIRST, ensure FAIL before implementation) ⚠️

- [X] T013 [P] [US1] Unit spec for bus lifecycle guards in `src/fleet-owner/bus-lifecycle.service.spec.ts` (disable blocked on DEPARTED trip, reactivate rules)
- [X] T014 [P] [US1] E2E spec for owner bus/trip matrix in `test/fleet-owner.e2e-spec.ts` (login genericity, CRUD, disable/reactivate, cross-fleet 404s)

### Implementation for User Story 1

- [X] T015 [P] [US1] Implement `FleetOwnerService` profile + bus orchestration in `src/fleet-owner/fleet-owner.service.ts` via `FleetPathService` (never Prisma directly; `FleetChangeApplier` seam per contracts/fleet-owner.md)
- [X] T016 [P] [US1] Implement disable/reactivate guards in `src/fleet-owner/bus-lifecycle.service.ts` (DEPARTED-trip check in-tenant-tx, 409 `BUS_ACTION_NOT_ALLOWED`)
- [X] T017 [US1] Implement owner endpoints (`GET/PATCH /me`, `/fleet/buses*`, `/fleet/trips*`) in `src/fleet-owner/fleet-owner.controller.ts` with `@RequirePermission('fleet.buses.*'/'fleet.trips.read')`, cursor pagination, envelope DTOs (depends on T015, T016)
- [X] T018 [US1] Add owner DTOs + validation in `src/fleet-owner/dto/fleet-owner.dto.ts` (CreateBus/UpdateBus reuse `src/buses/dto/bus.dto.ts` shapes)
- [X] T019 [US1] Wire `FleetOwnerModule` into `src/app.module.ts` and register controller/guards
- [X] T020 [US1] Audit `fleet.bus.*` actions via `AuditService` in `src/fleet-owner/fleet-owner.service.ts` (ids only, no secrets)

**Checkpoint**: US1 fully functional — owner manages buses/trips end-to-end; `pnpm test:e2e` Scenario A green.

---

## Phase 4: User Story 2 — Owner Driver Roster & Bus Assignment (Priority: P2)

**Goal**: Owner manages driver roster (add/list/get/update/remove) and assigns/changes/removes the driver on each bus with history-preserving semantics.

**Independent Test**: Assign → reassign (prior row ENDED) → unassign → roster CRUD; `authVersion` bump + session revocation on authorization changes; cross-fleet 404s.

### Tests for User Story 2 (write FIRST, ensure FAIL before implementation) ⚠️

- [X] T021 [P] [US2] Unit spec for assignment service in `src/fleet-owner/driver-roster.service.spec.ts` (single-active invariants, idempotent re-assign, ENDED history)
- [X] T022 [P] [US2] E2E roster + assignment cases appended in `test/fleet-owner.e2e-spec.ts` (roster CRUD, assign/change/unassign, `CONFLICTING_ASSIGNMENT`, session revocation)

### Implementation for User Story 2

- [X] T023 [P] [US2] Implement `DriverRosterService` in `src/fleet-owner/driver-roster.service.ts` (user invite + ACTIVE membership, role/status update, removal ending active assignment, `authVersion` bump via system path)
- [X] T024 [P] [US2] Implement assignment operations (assign/unassign with partial-unique-safe END+INSERT in one tenant tx) in `src/fleet-owner/driver-assignment.service.ts`
- [X] T025 [US2] Implement roster + assignment endpoints (`/fleet/drivers*`, `/fleet/buses/{busId}/driver` aliases) in `src/fleet-owner/fleet-owner.controller.ts` with `fleet.drivers.*` permissions (depends on T023, T024)
- [X] T026 [US2] Audit `fleet.driver.*` actions via `AuditService` in `src/fleet-owner/driver-roster.service.ts` and `src/fleet-owner/driver-assignment.service.ts`

**Checkpoint**: US1 + US2 work independently — full owner surface (buses, trips, roster, assignment) green.

---

## Phase 5: User Story 3 — Driver Trip Operations (Priority: P1)

**Goal**: Driver logs in, views assigned bus/fleet/trips/manifest, and executes idempotent board / drop-off / cash-payment operations anchored on in-transaction assignment checks (`complete-trip` deferred to the trips-lifecycle round).

**Independent Test**: Quickstart Scenario B (minus ratings, minus complete) — context reads incl. fleet owner contact (Q5-B), manifest PII scoping, convergent retries (repeat → 200 same), guarded conflicts (→ 409), unassigned-driver 404s.

### Tests for User Story 3 (write FIRST, ensure FAIL before implementation) ⚠️

- [X] T027 [P] [US3] Unit spec for driver-trip guard + transition guards in `src/driver-ops/driver-ops.service.spec.ts` (assignment anchoring, DEPARTED→COMPLETED guarded write, payment preconditions)
- [X] T028 [P] [US3] E2E driver operations matrix in `test/driver-ops.e2e-spec.ts` (login, context reads incl. owner contact, manifest, board/repeat, drop-off variants, payment, cross-fleet 404s; complete-trip excluded — deferred)

### Implementation for User Story 3

- [X] T029 [P] [US3] Implement `DriverTripGuard` in `src/driver-ops/driver-trip.guard.ts` (in-tx trip load → fleetId anchoring → active `bus_assignments` match, research R-02)
- [X] T030 [P] [US3] Implement context reads (`/me`, `/driver/bus`, `/driver/fleet` name+phone+owner contact per clarify Q5-B, `/driver/trips*`, manifest with PRD §9 fields only) in `src/driver-ops/driver-ops.service.ts`
- [X] T031 [US3] Implement board / drop-off / cash-payment operations in `src/driver-ops/driver-ops.service.ts` (convergent SET-state updates, guarded writes, amount read-only; complete-trip excluded — deferred to trips-lifecycle round) (depends on T029, T030)
- [X] T032 [US3] Implement driver endpoints in `src/driver-ops/driver-ops.controller.ts` with `driver.*` permissions + cursor pagination (depends on T031)
- [X] T033 [US3] Audit `driver.passenger.board/dropoff/payment` via `AuditService` in `src/driver-ops/driver-ops.service.ts` (no operational-write session revocation per research R-08)

**Checkpoint**: US3 independently functional — driver shift flow (minus trip completion) green without touching owner code.

---

## Phase 6: User Story 4 — Ratings & Reports (Priority: P2)

**Goal**: Passengers rate bus+driver, drivers rate passengers, drivers file passenger reports, owners read fleet reports + rating summaries.

**Independent Test**: Rate → repeat-same (200) → conflicting re-rate (409); report → owner-visible; foreign bus/driver rating rejected; ratings require COMPLETED trip.

### Tests for User Story 4 (write FIRST, ensure FAIL before implementation) ⚠️

- [X] T034 [P] [US4] Unit spec for rating/report guards in `src/driver-ops/passenger-feedback.service.spec.ts` (eligibility, range, single-write-per-side)
- [X] T035 [P] [US4] E2E rating/report cases in `test/driver-ops.e2e-spec.ts` + owner reports cases in `test/fleet-owner.e2e-spec.ts`

### Implementation for User Story 4

- [X] T036 [P] [US4] Implement passenger rating endpoint `POST /bookings/{bookingId}/rating` in `src/bookings/bookings.controller.ts` + service guards in `src/bookings/bookings.service.ts` (own booking, COMPLETED trip, bus/driver on trip)
- [X] T037 [P] [US4] Implement driver rating + report operations in `src/driver-ops/passenger-feedback.service.ts` (in-tx anchoring, note 1–2000 chars, `REPORT_NOT_ALLOWED` guards)
- [X] T038 [US4] Implement `GET /fleet/reports` (report list + rating aggregates) in `src/fleet-owner/fleet-owner.controller.ts` with `fleet.reports.read` (depends on T036, T037)
- [X] T039 [US4] Audit `driver.passenger.rate/report` via `AuditService` in `src/driver-ops/passenger-feedback.service.ts`

**Checkpoint**: All four stories independently functional — full PRD §7–§8 + §13–§15 surface complete.

---

## Phase 7: User Story 5 — Independent Driver Mode (Priority: P2)

**Goal**: Drivers with no fleet membership operate in v1 with a fleet-less tenant context + separate RLS policies (clarify Q2-B): membership-free login, owned-bus context, and board / drop-off / payment on own trips.

**Prerequisite**: T045 design decision first — it resolves the open data-model question (nullable `fleet_id` vs driver-id-scoped policies vs auto-provisioned single-driver fleet) and updates research R-10 + data-model.md. Implementation tasks follow that decision.

**Independent Test**: Independent driver logs in with no membership, sees owned bus, operates board/drop-off/payment on own trip; fleet members cannot see these rows and vice versa (RLS both directions → 404).

### Design + Tests for User Story 5 (design FIRST, then tests, ensure FAIL before implementation) ⚠️

- [X] T045 [US5] Resolve fleet-less isolation design in `specs/003-fleet-owner-driver-flows/research.md` (replace R-10 deferral) and `specs/003-fleet-owner-driver-flows/data-model.md` (Bus/Booking ownership for driver-owned rows, tenant-context shape)
- [X] T046 [P] [US5] Unit spec for fleet-less context + login in `src/fleets/fleets.service.spec.ts` (provisioning idempotency, audit, fail-closed without role; path differs from task text — provisioning lives in `FleetsService.ensurePersonalFleet`, not a new driver-ops service)
- [X] T047 [P] [US5] E2E independent-driver cases in `test/driver-ops.e2e-spec.ts` (login without membership, context reads, ops on own trip, cross-visibility 404s)

### Implementation for User Story 5

- [X] T048 [US5] Fleet-less RLS policies: NOT NEEDED per T045 decision (auto-provisioned personal fleets reuse the existing `tenant_isolation` family unchanged; verified by T047 cross-visibility cases) (depends on T045)
- [X] T049 [US5] Driver-scoped context method: NOT NEEDED per T045 decision (`TenantContextService` unchanged; independent drivers are ordinary members of their personal fleet) (depends on T045)
- [X] T050 [US5] Implement membership-free DRIVER login in `src/auth/auth.service.ts` (personal-fleet provisioning after password verification, owners-with-fleets still fail closed) + self-claim + owned-bus ops in `src/driver-ops/driver-ops.service.ts` (`POST /driver/bus/claim`, owner-only) (depends on T048, T049)
- [X] T051 [US5] Audit independent-driver operations via `AuditService` (`driver.fleet.provision` in `src/fleets/fleets.service.ts`, `fleet.driver.assign` with `selfClaim` in `src/driver-ops/driver-ops.service.ts`) (depends on T050)

**Checkpoint**: US5 independently functional — fleet-less drivers operate end-to-end; fleet-member flows unaffected.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Isolation hardening, docs, gates

- [X] T040 Extend `test/tenant-isolation.e2e-spec.ts` with owner/driver cross-fleet matrix per quickstart Scenario C (plus fleet-less cross-visibility once US5 lands)
- [X] T041 [P] Rebuild API contract via `pnpm docs:generate` and commit refreshed `docs/openapi.json`
- [X] T042 [P] Add OpenAPI decorators (`ApiTags`, envelope helpers, error codes) audit for all new routes in `src/fleet-owner/fleet-owner.controller.ts` and `src/driver-ops/driver-ops.controller.ts`
- [X] T043 Run full gate `pnpm typecheck`, `pnpm lint`, `pnpm test:cov`, `pnpm build` and fix regressions
- [X] T044 Run `specs/003-fleet-owner-driver-flows/quickstart.md` validation — execute Scenarios A–C end-to-end
- [X] T052 [P] Refresh `specs/003-fleet-owner-driver-flows/contracts/driver.md` (fleet response = name+phone+owner contact; complete-trip marked deferred) and `specs/003-fleet-owner-driver-flows/quickstart.md` Scenario B (minus complete) to match clarify decisions

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phase 3–7)**: All depend on Foundational completion
  - US1 (P1) and US3 (P1) first, in that order (driver ops segments rely on assignment semantics proven by US2 tests only at e2e level; unit-level independent)
  - US2 (P2) → US4 (P2) after; stories can parallelize across developers once Foundation is done
  - US5 (P2) after T045 design decision; implementation independent of US1–US4 code
- **Polish (Phase 8)**: Depends on all stories being complete

### User Story Dependencies

- **US1 (P1)**: After Foundational only — no story dependencies 🎯 MVP
- **US2 (P2)**: After Foundational — integrates with US1 buses (assignment targets) but independently testable with seeded buses
- **US3 (P1)**: After Foundational — needs assignment rows (seeded in tests via US2 service or fixtures); no code dependency on US2
- **US4 (P2)**: After Foundational — ratings require COMPLETED trips (seeded via fixtures/system path while driver-side complete is deferred) and US1 fleet scope; testable with fixtures
- **US5 (P2)**: After Foundational + T045 design — fleet-less path independent of US1–US4 code; isolation-matrix extension (T040) covers it

### Within Each User Story

- Spec/unit + e2e tests written FIRST and FAIL before implementation (constitution IV)
- Services before controllers; guards before operations using them
- Core implementation before audit wiring
- Story checkpoint green before next story

### Parallel Opportunities

- T002, T003, T004 (different files, no dependencies)
- T009, T010, T011 can parallelize after T005–T008 land (different files; T010 conceptually independent of migration but e2e-verified together at T012)
- Per story: unit spec + e2e spec tasks ([P]) run together; service files ([P]) written together before the controller task that depends on them
- Across developers: US1 + US3 can be built in parallel after Foundational; US2 + US4 likewise

---

## Parallel Example: User Story 3

```bash
# Launch tests for US3 together (different files, TDD-first):
Task: "Unit spec for driver-trip guard + transition guards in src/driver-ops/driver-ops.service.spec.ts" (T027)
Task: "E2E driver operations matrix in test/driver-ops.e2e-spec.ts" (T028)

# Launch service slices together (different files):
Task: "Implement DriverTripGuard in src/driver-ops/driver-trip.guard.ts" (T029)
Task: "Implement context reads in src/driver-ops/driver-ops.service.ts" (T030)
# Then: T031 operations (depends on T029, T030) → T032 controller → T033 audit
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T004)
2. Complete Phase 2: Foundational (T005–T012) — migration + RLS + login extension
3. Complete Phase 3: US1 (T013–T020)
4. **STOP and VALIDATE**: quickstart Scenario A + `pnpm test:e2e` for `test/fleet-owner.e2e-spec.ts`
5. Deploy/demo if ready — owner manages fleet; drivers/ops come next

### Incremental Delivery

1. Setup + Foundational → login + RLS + error codes ready
2. + US1 → owner bus/trip management (MVP!)
3. + US2 → roster + assignment (assignment history auditable)
4. + US3 → driver shift operations (board/drop-off/payment; second P1 increment)
5. + US4 → ratings + reports (engagement loop closed)
6. + US5 → independent drivers (needs T045 design first)
7. + Polish → isolation matrix extended, OpenAPI refreshed, gates green

### Parallel Team Strategy

1. Team completes Setup + Foundational together (T012 checkpoint)
2. Developer A: US1 (owner) → US2 (roster/assignment)
3. Developer B: US3 (driver ops) → US4 (ratings/reports)
4. US5 after T045 design decision (either developer; fleet-less path is code-independent)
5. Joint: Phase 8 polish + full gate

---

## Notes

- [P] tasks = different files, no dependencies — safe to parallelize
- [USn] labels (US1–US5) trace every story task to its user story
- Commit after each task or logical group; stop at any checkpoint to validate
- Never append `?schema=public` to PG URLs; migration order `db:migrate:deploy` → `db:setup-rls` → `db:check-rls`
- `pnpm docs:generate` + commit whenever routes/DTOs change (T041)
