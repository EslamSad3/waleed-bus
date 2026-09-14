# Tasks: Super Admin Booking Review Flow

**Input**: Design documents from `/specs/005-super-admin-booking-review/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`).  
**Prerequisites**: All design artifacts present and ratified. Constitution mandates TDD (red → green, e2e on real PostgreSQL, unit coverage $\ge 80\%$).  
**Organization**: Grouped by user story (US1–US6 from `spec.md`) for independent implementation and testing.  

## Format: `[ID] [P?] [Story] Description with exact file path`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task belongs to (US1–US6)
- Exact file paths in every description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify baseline test suite health and establish module structure.

- [X] T001 Record green baseline: run `pnpm test` to ensure existing suites pass before changes
- [X] T002 [P] Register `AdminBookingsController` and `AdminBookingsService` in `src/bookings/bookings.module.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema enhancements, Prisma migration, and DTO definitions that all stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Extend `prisma/schema.prisma` with payment reconciliation columns on `Booking` (`refundedAmount`, `paymentReference`, `refundReference`, `paymentNotes`) and resolution columns on `PassengerReport` (`status`, `resolutionNote`, `resolvedAt`, `resolvedBy`, `updatedAt`)
- [X] T004 Generate and deploy Prisma migration in `prisma/migrations/` and regenerate client via `pnpm db:generate`
- [X] T005 Verify RLS compatibility using `pnpm db:check-rls` to ensure tenant isolation policies remain intact
- [X] T006 [P] Create Admin Booking DTOs (query filters, list item, single booking detail response) in `src/bookings/dto/admin-booking.dto.ts`
- [X] T007 [P] Create Admin Payment DTOs (verify, refund, fail) in `src/bookings/dto/admin-payment.dto.ts`
- [X] T008 [P] Create Admin Report DTOs (resolution status, resolution note) in `src/bookings/dto/admin-report.dto.ts`

**Checkpoint**: Foundation ready — database schema migrated, RLS verified, DTOs defined; user story implementation can begin.

---

## Phase 3: User Story 1 - Global Booking Retrieval and Multi-Criteria Filtering (Priority: P1) 🎯 MVP

**Goal**: Super Admin retrieves and searches all bookings across all fleets with cursor-based pagination and multi-criteria filters (`fleetId`, `tripId`, `passengerUserId`, `passengerPhone`, `passengerName`, `status`, `paymentStatus`, `paymentMethod`, `createdFrom`/`createdTo`, `departureFrom`/`departureTo`, `hasReports`).

**Independent Test**: `quickstart.md` Scenario 1 — query `GET /admin/bookings` with various filter combinations; assert matching items returned with cursor pagination envelope, and assert non-super-admin access is rejected with 403.

### Tests for User Story 1 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T009 [P] [US1] Unit spec for multi-criteria filtering, cursor pagination, and system Prisma query construction in `src/bookings/admin-bookings.service.spec.ts`
- [X] T010 [P] [US1] E2E test suite for `GET /admin/bookings` with filter permutations and `@Platform()` super_admin guard verification in `test/admin-bookings.e2e-spec.ts`

### Implementation for User Story 1

- [X] T011 [US1] Implement `findAllBookings` with cursor pagination using `SystemPrismaService` in `src/bookings/admin-bookings.service.ts`
- [X] T012 [US1] Implement `GET /admin/bookings` endpoint with `@Platform()` decorator, Swagger docs, and `{ statusCode, data }` envelope in `src/bookings/admin-bookings.controller.ts`

**Checkpoint**: User Story 1 fully functional and testable independently.

---

## Phase 4: User Story 2 - Comprehensive Booking Details Inspection (Priority: P1)

**Goal**: Super Admin inspects complete relational graph for a single booking (passenger, trip, bus, driver, route stations, ratings, incident reports) including up to 20 recent administrative audit events inline.

**Independent Test**: `quickstart.md` Scenario 2 — query `GET /admin/bookings/:id`; assert full entity hierarchy and `auditTrail` array returned; assert foreign/nonexistent booking returns 404.

### Tests for User Story 2 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T013 [P] [US2] Unit spec for single booking detail retrieval, relation inclusion, and inline audit trail assembly in `src/bookings/admin-bookings.service.spec.ts`
- [X] T014 [P] [US2] E2E test suite for `GET /admin/bookings/:id` asserting full entity relations and inline audit events in `test/admin-bookings.e2e-spec.ts`

### Implementation for User Story 2

- [X] T015 [US2] Implement `findBookingById` loading relational hierarchy and parallel audit log query in `src/bookings/admin-bookings.service.ts`
- [X] T016 [US2] Implement `GET /admin/bookings/:id` endpoint with UUID validation pipe in `src/bookings/admin-bookings.controller.ts`

**Checkpoint**: User Story 2 fully functional and testable independently.

---

## Phase 5: User Story 3 - Payment Verification and Reconciliation for Offline/Wallet Payments (Priority: P1)

**Goal**: Super Admin verifies offline/wallet payments (`VODAFONE_CASH`, manual wallets) enforcing strict exact-match against `totalAmount` (`PENDING` → `PAID`), or records failed transfers (`PENDING` → `FAILED`), logging audit trail.

**Independent Test**: `quickstart.md` Scenario 3 — submit payment verification with matching amount, assert 200 `PAID`; submit mismatched amount, assert 400 `PAYMENT_AMOUNT_MISMATCH`; submit fail action, assert 200 `FAILED`.

### Tests for User Story 3 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T017 [P] [US3] Unit spec for payment verification exact-match rule, duplicate settlement conflict, and fail transitions in `src/bookings/admin-bookings.service.spec.ts`
- [X] T018 [P] [US3] E2E test suite for `POST /admin/bookings/:id/payment/verify` and `fail` endpoints in `test/admin-bookings.e2e-spec.ts`

### Implementation for User Story 3

- [X] T019 [US3] Implement `verifyPayment` and `failPayment` with exact-match validation and `AuditService.log(...)` in `src/bookings/admin-bookings.service.ts`
- [X] T020 [US3] Implement `POST /admin/bookings/:id/payment/verify` and `POST /admin/bookings/:id/payment/fail` endpoints in `src/bookings/admin-bookings.controller.ts`

**Checkpoint**: User Story 3 fully functional and testable independently.

---

## Phase 6: User Story 4 - Refund Processing for Cancelled or Disputed Bookings (Priority: P2)

**Goal**: Super Admin processes full or partial refunds for bookings with cumulative balance tracking (`refundedAmount`), transitioning payment status to `PARTIALLY_REFUNDED` or `REFUNDED`.

**Independent Test**: `quickstart.md` Scenario 4 — submit partial refund, assert `PARTIALLY_REFUNDED` with updated `refundedAmount`; submit remaining balance refund, assert `REFUNDED`; submit refund exceeding total, assert 400 `REFUND_EXCEEDS_BALANCE`.

### Tests for User Story 4 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T021 [P] [US4] Unit spec for cumulative refund calculations, balance validation, and status transitions in `src/bookings/admin-bookings.service.spec.ts`
- [X] T022 [P] [US4] E2E test suite for `POST /admin/bookings/:id/payment/refund` in `test/admin-bookings.e2e-spec.ts`

### Implementation for User Story 4

- [X] T023 [US4] Implement `processRefund` with cumulative balance check, status transition, and audit logging in `src/bookings/admin-bookings.service.ts`
- [X] T024 [US4] Implement `POST /admin/bookings/:id/payment/refund` endpoint in `src/bookings/admin-bookings.controller.ts`

**Checkpoint**: User Story 4 fully functional and testable independently.

---

## Phase 7: User Story 5 - Administrative Booking Status Modification and Force Cancellation (Priority: P2)

**Goal**: Super Admin force-cancels active bookings with seat inventory release option (`releaseSeats: boolean`), and reinstates cancelled bookings verifying trip capacity against overbooking (`SEATS_UNAVAILABLE`).

**Independent Test**: `quickstart.md` Scenario 5 — force-cancel booking with `releaseSeats: true`, assert trip available seats incremented; reinstate booking when capacity available, assert confirmed; reinstate on full trip, assert 409 `SEATS_UNAVAILABLE`.

### Tests for User Story 5 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T025 [P] [US5] Unit spec for force-cancellation seat inventory restoration and row-locked capacity check on reinstatement in `src/bookings/admin-bookings.service.spec.ts`
- [X] T026 [P] [US5] E2E test suite for `POST /admin/bookings/:id/cancel` and `POST /admin/bookings/:id/reinstate` in `test/admin-bookings.e2e-spec.ts`

### Implementation for User Story 5

- [X] T027 [US5] Implement `forceCancelBooking` (row-locked trip seat increment) and `reinstateBooking` (row-locked capacity validation) in `src/bookings/admin-bookings.service.ts`
- [X] T028 [US5] Implement `POST /admin/bookings/:id/cancel` and `POST /admin/bookings/:id/reinstate` endpoints in `src/bookings/admin-bookings.controller.ts`

**Checkpoint**: User Story 5 fully functional and testable independently.

---

## Phase 8: User Story 6 - Driver Operational Status Administrative Override and Incident Review (Priority: P3)

**Goal**: Super Admin overrides operational boarding/drop-off status during driver device failure, and resolves or dismisses driver incident reports (`PassengerReport`) with mandatory resolution notes.

**Independent Test**: `quickstart.md` Scenario 6 — submit operational override, assert `boardedAt` and `dropStatus` updated; submit report resolution, assert report status `RESOLVED` with `resolvedBy` and `resolutionNote`.

### Tests for User Story 6 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T029 [P] [US6] Unit spec for operational driver overrides and incident report resolution in `src/bookings/admin-bookings.service.spec.ts`
- [X] T030 [P] [US6] E2E test suite for `PATCH /admin/bookings/:id/operational` and `PATCH /admin/bookings/:id/reports/:reportId` in `test/admin-bookings.e2e-spec.ts`

### Implementation for User Story 6

- [X] T031 [US6] Implement `overrideOperationalStatus` and `resolveIncidentReport` with audit logging in `src/bookings/admin-bookings.service.ts`
- [X] T032 [US6] Implement `PATCH /admin/bookings/:id/operational` and `PATCH /admin/bookings/:id/reports/:reportId` endpoints in `src/bookings/admin-bookings.controller.ts`

**Checkpoint**: User Story 6 fully functional and testable independently.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Documentation generation, linting, formatting, and full verification suite gates.

- [X] T033 Rebuild OpenAPI documentation and verify Swagger schema via `pnpm docs:generate`
- [X] T034 Run typecheck, linter, and formatting verification: `pnpm typecheck`, `pnpm lint`, `pnpm format`
- [X] T035 Run full test coverage gate: `pnpm test:cov` (lines $\ge 80\%$, branches $\ge 70\%$, functions $\ge 70\%$)
- [X] T036 Run end-to-end test suite across all features: `pnpm test:e2e`

---

## Dependencies & Execution Order

```text
Phase 1: Setup (T001-T002)
  ↓
Phase 2: Foundational (T003-T008)
  ↓
  ├── Phase 3: User Story 1 (T009-T012) 🎯 MVP
  ↓
  ├── Phase 4: User Story 2 (T013-T016)
  ↓
  ├── Phase 5: User Story 3 (T017-T020)
  ↓
  ├── Phase 6: User Story 4 (T021-T024)
  ↓
  ├── Phase 7: User Story 5 (T025-T028)
  ↓
  ├── Phase 8: User Story 6 (T029-T032)
  ↓
Phase 9: Polish & Verification (T033-T036)
```

### Parallel Opportunities

- **Foundational**: T006, T007, T008 can be written concurrently once migration T004 is deployed.
- **Per User Story**: Within each story phase, the Unit Spec task and E2E test task can run in parallel before implementation.
- **Stories**: US1, US2, and US3 all share the foundational schema and DTOs and can be developed in rapid sequence or parallelized across developers.

---

## Implementation Strategy

1. **MVP First (Phases 1–3)**: Deliver global booking list retrieval with cursor pagination and multi-criteria filters (`GET /admin/bookings`). This immediately unlocks platform visibility.
2. **Context Enrichment (Phase 4)**: Add full hierarchy inspection and inline audit history (`GET /admin/bookings/:id`).
3. **Financial Operations (Phases 5–6)**: Implement offline payment verification (exact match) and refund lifecycle handling (`REFUND_PENDING` → `REFUNDED` / `PARTIALLY_REFUNDED`).
4. **Administrative Control & Safety (Phases 7–8)**: Add force-cancellation with seat inventory restoration, reinstatement with capacity checking, operational overrides, and incident report resolution.
5. **Quality & Deployment Gate (Phase 9)**: Validate OpenAPI spec generation, strict typing, linting, and coverage thresholds ($\ge 80\%$).
