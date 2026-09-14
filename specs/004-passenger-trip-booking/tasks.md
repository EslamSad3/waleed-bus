# Tasks: Passenger Trip Booking Flow

**Input**: Design documents from `/specs/004-passenger-trip-booking/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`).
**Prerequisites**: All design artifacts present and ratified. Constitution mandates TDD (red → green, e2e on real PostgreSQL, unit coverage \(\ge 80\%\)).
**Organization**: Grouped by user story (US1–US8 from `spec.md`) for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description with exact file path`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task belongs to (US1–US8)
- Exact file paths in every description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify baseline test suite health and establish module boundaries.

- [X] T001 Record green baseline: run `pnpm test` and `pnpm test:e2e` to ensure all existing suites pass before changes
- [X] T002 [P] Create `src/routes/routes.module.ts` shell and register it in `src/app.module.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema extensions, migration, RLS policies, DTOs, and seed data that all stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Extend `prisma/schema.prisma` with `Route`, `Station`, `RouteStation`, `TripShare` models, extend `Trip` (`routeId`, `fare`), and extend `Booking` (`passengerUserId`, `totalAmount`, `confirmedAt`, `cancelledAt`, `cancelledBy`, `cancellationReason`)
- [X] T004 Generate and deploy Prisma migration in `prisma/migrations/` and regenerate client via `pnpm db:generate`
- [X] T005 Update RLS policies and grants in `prisma/sql/rls/001-tenant-isolation.sql` for `routes`, `stations`, `route_stations`, `trip_shares`, then apply with `pnpm db:setup-rls` and verify with `pnpm db:check-rls`
- [X] T006 [P] Create Route, Station, and RouteStation DTOs with validation rules in `src/routes/dto/route.dto.ts`
- [X] T007 [P] Extend Trip DTOs and create search criteria DTO in `src/trips/dto/trip-search.dto.ts`
- [X] T008 [P] Create Passenger Booking and Cancellation DTOs with `seatsToCancel` in `src/bookings/dto/passenger-booking.dto.ts`
- [X] T009 [P] Create Trip Share DTOs in `src/bookings/dto/trip-share.dto.ts`
- [X] T010 [P] Update baseline seed data in `prisma/seed.ts` to include sample routes, ordered stations, and scheduled trips

**Checkpoint**: Foundation ready — database schema migrated, RLS verified, DTOs defined; user story implementation can begin.

---

## Phase 3: User Story 1 - Search Available Trips and View Trip Details (Priority: P1)

**Goal**: Commuters and passengers search scheduled trips by origin, destination, and strict calendar date with available seat counts, and view comprehensive trip details.

**Independent Test**: `quickstart.md` Scenario 1 — query `GET /trips/search?origin=Cairo&destination=Alexandria&date=2026-09-15` and `GET /trips/:id`; assert bookable trips returned with `availableSeats`, fare, bus plate, or `[]` if none match.

### Tests for User Story 1 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T011 [P] [US1] Unit spec for trip search filtering, strict calendar date matching, and seat availability calculation in `src/trips/trips.service.spec.ts`
- [X] T012 [P] [US1] E2E test suite for public trip search, date filtering, and single trip details in `test/passenger-booking.e2e-spec.ts`

### Implementation for User Story 1

- [X] T013 [US1] Implement `searchTrips` and `findTripDetails` with remaining seat aggregation (`capacity - confirmedBookings`) in `src/trips/trips.service.ts`
- [X] T014 [US1] Implement `GET /trips/search` and `GET /trips/:id` endpoints with Swagger docs and envelope response in `src/trips/trips-search.controller.ts`

**Checkpoint**: User Story 1 fully functional and testable independently.

---

## Phase 4: User Story 2 - Book Seats on a Scheduled Trip with Concurrency Protection (Priority: P1) 🎯 MVP

**Goal**: Authenticated passenger with verified phone reserves 1 to \(N\) seats atomically on a scheduled trip; concurrent requests for remaining seats never exceed capacity.

**Independent Test**: `quickstart.md` Scenario 2 — create booking on scheduled trip; concurrent requests for the last remaining seat result in exactly one 201 and one 409 `SEATS_UNAVAILABLE`.

### Tests for User Story 2 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T015 [P] [US2] Unit spec for atomic seat reservation, row-level locking, and capacity enforcement in `src/bookings/bookings.service.spec.ts`
- [X] T016 [P] [US2] E2E test suite for passenger booking creation and concurrency contention in `test/passenger-booking.e2e-spec.ts`

### Implementation for User Story 2

- [X] T017 [US2] Implement atomic seat reservation `createPassengerBooking` with PostgreSQL row lock (`SELECT ... FOR UPDATE` on `trips`) inside interactive transaction in `src/bookings/bookings.service.ts`
- [X] T018 [US2] Implement `POST /bookings` endpoint with passenger JWT guard, verified-phone requirement, and audit logging (`booking.create`) in `src/bookings/passenger-bookings.controller.ts`

**Checkpoint**: Core transactional booking MVP functional and verified under concurrency.

---

## Phase 5: User Story 3 - Duplicate-Time Booking Detection and Conflict Handling (Priority: P2)

**Goal**: Detect when a passenger already holds an active booking in the \(\pm 2\)-hour departure window; return `DUPLICATE_TIME_BOOKING` conflict or proceed if `confirmTimeConflict: true`.

**Independent Test**: `quickstart.md` Scenario 3 — attempt conflicting booking, assert 409 with details; resubmit with `confirmTimeConflict: true`, assert 201.

### Tests for User Story 3 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T019 [P] [US3] Unit spec for departure time conflict detection window (\(\pm 2\) hours) and override bypass in `src/bookings/bookings.service.spec.ts`
- [X] T020 [P] [US3] E2E test suite for duplicate-time booking conflict and `confirmTimeConflict` override in `test/passenger-booking.e2e-spec.ts`

### Implementation for User Story 3

- [X] T021 [US3] Add duplicate-time overlap query and `confirmTimeConflict` validation check to `createPassengerBooking` in `src/bookings/bookings.service.ts`

**Checkpoint**: Duplicate-time conflict handling and user override confirmed.

---

## Phase 6: User Story 4 - View and Filter Passenger Bookings (Priority: P2)

**Goal**: Passengers retrieve their personal booking history and upcoming trips with cursor pagination and status/time filters, ensuring strict OWASP BOLA isolation.

**Independent Test**: `quickstart.md` Scenario 4 — retrieve booking list with `timeFilter=upcoming`; retrieve single booking; assert foreign passenger booking returns 404.

### Tests for User Story 4 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T022 [P] [US4] Unit spec for passenger booking list filtering, cursor pagination, and BOLA isolation in `src/bookings/bookings.service.spec.ts`
- [X] T023 [P] [US4] E2E test suite for passenger booking list, filters, cursor pagination, and foreign booking 404 in `test/passenger-booking.e2e-spec.ts`

### Implementation for User Story 4

- [X] T024 [US4] Implement `findPassengerBookings` and `findPassengerBookingById` scoped strictly to `passengerUserId: actor.id` in `src/bookings/bookings.service.ts`
- [X] T025 [US4] Implement `GET /bookings` and `GET /bookings/:id` endpoints in `src/bookings/passenger-bookings.controller.ts`

**Checkpoint**: Booking history and details accessible with strict tenant and passenger isolation.

---

## Phase 7: User Story 5 - Cancel an Active Booking (Full or Partial) Before Departure (Priority: P2)

**Goal**: Passenger cancels an active booking in full or partially (via `seatsToCancel`) before departure; releases seats atomically, transitions digital payments to `REFUND_PENDING` (or cash to `CANCELLED`), and rejects post-departure cancellations.

**Independent Test**: `quickstart.md` Scenario 4 — cancel 1 seat from 3-seat booking; verify booking retains 2 seats and released seat returns to capacity; cancel remaining seats; verify replay 409.

### Tests for User Story 5 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T026 [P] [US5] Unit spec for full and partial booking cancellation, capacity restoration, and payment status transitions in `src/bookings/bookings.service.spec.ts`
- [X] T027 [P] [US5] E2E test suite for full/partial cancellation, post-departure rejection (`TRIP_ALREADY_STARTED`), and boarded rejection in `test/passenger-booking.e2e-spec.ts`

### Implementation for User Story 5

- [X] T028 [US5] Implement `cancelPassengerBooking` supporting partial `seatsToCancel`, capacity restoration, and payment status transitions in `src/bookings/bookings.service.ts`
- [X] T029 [US5] Implement `POST /bookings/:id/cancel` endpoint in `src/bookings/passenger-bookings.controller.ts` with audit logging (`booking.cancel`)

**Checkpoint**: Full and partial cancellation operational with real-time seat inventory recovery.

---

## Phase 8: User Story 6 - Active Trip Status and Real-time Tracking Access (Priority: P3)

**Goal**: Passenger queries current active trip (`GET /me/active-trip`), retrieving vehicle info, assigned driver contact, boarding status, and Firebase Realtime Database channel.

**Independent Test**: `quickstart.md` Scenario 5 — query `GET /me/active-trip` for passenger with active booking; assert driver, bus, and tracking channel returned; return `null` when no trip active.

### Tests for User Story 6 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T030 [P] [US6] Unit spec for active trip resolution and tracking channel mapping in `src/bookings/bookings.service.spec.ts`
- [X] T031 [P] [US6] E2E test suite for `GET /me/active-trip` in `test/passenger-booking.e2e-spec.ts`

### Implementation for User Story 6

- [X] T032 [US6] Implement `findActivePassengerTrip` querying imminent/in-transit confirmed bookings with active driver assignment in `src/bookings/bookings.service.ts`
- [X] T033 [US6] Implement `GET /me/active-trip` endpoint in `src/bookings/me.controller.ts`

**Checkpoint**: Real-time day-of-travel trip context available for mobile clients.

---

## Phase 9: User Story 7 - Secure Trip Sharing with Public Verification (Priority: P3)

**Goal**: Passenger generates a 6-digit share code (`POST /bookings/:id/share`); unauthenticated recipients verify code (`POST /public/trip-shares/:shareId/verify`) with 5-guess throttle.

**Independent Test**: `quickstart.md` Scenario 5 — generate share code; public verify returns read-only tracking; 5 invalid guesses triggers 429 `SHARE_RATE_LIMITED`.

### Tests for User Story 7 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T034 [P] [US7] Unit spec for trip share generation, expiration calculation, and rate-limited verification in `src/bookings/trip-shares.service.spec.ts`
- [X] T035 [P] [US7] E2E test suite for share creation, public verification, wrong code 400, and 429 rate limiting in `test/passenger-booking.e2e-spec.ts`

### Implementation for User Story 7

- [X] T036 [US7] Implement `createTripShare` and `verifyTripShare` with `ThrottleService` rate limiting in `src/bookings/trip-shares.service.ts`
- [X] T037 [US7] Implement `POST /bookings/:id/share` in `src/bookings/passenger-bookings.controller.ts` and `POST /public/trip-shares/:shareId/verify` in `src/bookings/public-shares.controller.ts`

**Checkpoint**: Secure public trip sharing operational and hardened against brute-force enumeration.

---

## Phase 10: User Story 8 - Public QR Route and Station Resolution (Priority: P3)

**Goal**: Scan a QR code (`GET /public/routes/:identifier`) to resolve route, ordered stations, and upcoming scheduled trips with live seat counts without logging in.

**Independent Test**: `quickstart.md` Scenario 1 — fetch route by `qrIdentifier`; assert ordered stations and upcoming scheduled trips returned; invalid QR returns 404.

### Tests for User Story 8 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T038 [P] [US8] Unit spec for QR route resolution and ordered station sorting in `src/routes/routes.service.spec.ts`
- [X] T039 [P] [US8] E2E test suite for `GET /public/routes/:identifier` in `test/passenger-booking.e2e-spec.ts`

### Implementation for User Story 8

- [X] T040 [US8] Implement `resolvePublicRoute` querying route, ordered stations, and upcoming trips with remaining capacity in `src/routes/routes.service.ts`
- [X] T041 [US8] Implement `GET /public/routes/:identifier` in `src/routes/routes.controller.ts`

**Checkpoint**: Public QR route and station discovery ready for commuters.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Documentation synchronization, code quality verification, and coverage gate enforcement.

- [X] T042 [P] Rebuild and commit OpenAPI specification via `pnpm docs:generate` updating `docs/openapi.json`
- [X] T043 [P] Run full test suite with coverage gate `pnpm test:cov` (lines 80 / functions 70 / statements 75 / branches 70)
- [X] T044 Run full e2e test suite `pnpm test:e2e` and verify RLS via `pnpm db:check-rls`
- [X] T045 Run code quality checks: `pnpm typecheck`, `pnpm lint`, and `pnpm format`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Story 1 & 2 (Phases 3 & 4)**: Depend on Foundational completion. US1 (Discovery) and US2 (Booking) form the foundational MVP.
- **User Stories 3–5 (Phases 5–7)**: Depend on US2 (Booking creation).
- **User Story 6 & 7 (Phases 8 & 9)**: Depend on US2 (Booking creation).
- **User Story 8 (Phase 10)**: Depends on Foundational routes/stations schema.
- **Polish (Phase 11)**: Depends on completion of all desired user stories.

### Parallel Opportunities

- Within Phase 2 (Foundational): T006, T007, T008, T009, T010 can all be developed in parallel once schema migration (T003–T005) completes.
- In each User Story phase: Test tasks marked `[P]` can be written in parallel before implementation.
- User Story 1 (Discovery) and User Story 8 (QR Route) can proceed in parallel with User Story 2 (Booking).
- Polish tasks T042 and T043 can run in parallel.

---

## Implementation Strategy

### MVP First (User Stories 1 & 2)

1. Complete Phase 1: Setup (`T001`–`T002`)
2. Complete Phase 2: Foundational (`T003`–`T010`)
3. Complete Phase 3: User Story 1 — Discovery (`T011`–`T014`)
4. Complete Phase 4: User Story 2 — Concurrency-safe Booking (`T015`–`T018`)
5. **STOP and VALIDATE**: Test trip search and atomic seat reservation independently via `test/passenger-booking.e2e-spec.ts`. This delivers the usable MVP.

### Incremental Delivery

1. Foundation + US1 + US2 \(\rightarrow\) MVP bookable API.
2. Add US3 (Duplicate conflict) + US4 (History & BOLA) \(\rightarrow\) Commuter self-service.
3. Add US5 (Full/Partial cancellation) \(\rightarrow\) Flexible seat adjustment & refund reconciliation.
4. Add US6 (Active trip) + US7 (Sharing) \(\rightarrow\) Real-time travel day experience.
5. Add US8 (QR Resolution) \(\rightarrow\) Physical bus stop onboarding.
6. Run Phase 11 Polish \(\rightarrow\) CI green, OpenAPI committed.
