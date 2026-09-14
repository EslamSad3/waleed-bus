# Implementation Plan: Super Admin Booking Review Flow

**Branch**: `main` (suggested: `005-super-admin-booking-review`) | **Date**: 2026-09-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-super-admin-booking-review/spec.md` (based on `WalledBus_Mobile_Users_Backend_PRD.md` §12, §15, §16, §20, §21, §26).

---

## Summary

Deliver the platform Super Admin booking review flow:
1. **Global Retrieval & Multi-Criteria Filtering**: Global cross-fleet booking retrieval (`GET /admin/bookings`) with multi-criteria filtering (`fleetId`, `tripId`, `passengerUserId`, `passengerPhone`, `passengerName`, `status`, `paymentStatus`, `paymentMethod`, `createdFrom`/`createdTo`, `departureFrom`/`departureTo`, `hasReports`) and cursor-based pagination.
2. **Comprehensive Booking Details Inspection**: Detailed single-booking inspection (`GET /admin/bookings/:id`) returning full entity relations (passenger profile, trip, bus, driver, route stations, incident reports) and up to 20 recent administrative audit events inline.
3. **Payment Reconciliation & Handling**: Offline wallet payment verification (`POST /admin/bookings/:id/payment/verify`) with strict exact-match validation against `totalAmount`; full and partial refund processing (`POST /admin/bookings/:id/payment/refund`) with cumulative balance tracking (`refundedAmount`, `PARTIALLY_REFUNDED`); payment failure recording (`POST /admin/bookings/:id/payment/fail`).
4. **Administrative Booking Status Overrides**: Force-cancellation (`POST /admin/bookings/:id/cancel`) with controlled seat inventory release (`releaseSeats`); booking reinstatement (`POST /admin/bookings/:id/reinstate`) with real-time capacity validation against overbooking (`SEATS_UNAVAILABLE`).
5. **Operational Overrides & Incident Management**: Manual driver operational state overrides (`PATCH /admin/bookings/:id/operational`) for boarding and drop-off; closed-loop driver incident report resolution (`PATCH /admin/bookings/:id/reports/:reportId`) with `RESOLVED` / `DISMISSED` statuses and resolution notes.
6. **Platform Auditing & Security Governance**: Strictly guarded by `@Platform()` and restricted to the `super_admin` global role; mutations executed via privileged system connection (`SystemPrismaService`) and audited via `AuditService.log(...)` with sanitized metadata (zero credentials).

---

## Technical Context

**Language/Version**: TypeScript strict (ESM, `"type": "module"`, `module/moduleResolution: nodenext` — relative imports carry `.js` suffix), Node.js 24, NestJS 12.

**Primary Dependencies**: `@nestjs/common|core|jwt|platform-express|swagger`, Prisma 7 (`prisma-client` generator ESM, `@prisma/adapter-pg`), `class-validator`/`class-transformer`, `pg`, `argon2`. Zero new runtime dependencies.

**Storage**: PostgreSQL (Supabase host / local embedded PG on port 5433 / test embedded PG on port 5434).
- Database client: `SystemPrismaService` for all platform review operations (bypasses RLS tenant context).
- Schema extensions:
  - `bookings`: add `refunded_amount` (Decimal 10,2 @default(0)), `payment_reference` (VarChar 100), `refund_reference` (VarChar 100), `payment_notes` (VarChar 500).
  - `passenger_reports`: add `status` (VarChar 20 @default("PENDING")), `resolution_note` (VarChar 2000), `resolved_at` (DateTime), `resolved_by` (UUID), `updated_at` (DateTime).

**Testing**: Vitest — unit `*.spec.ts` colocated in `src/bookings/`, e2e `*.e2e-spec.ts` in `test/` (`pnpm test:e2e`, `fileParallelism: false`). Gates: `pnpm typecheck` -> `pnpm lint` -> `pnpm test:cov` (lines 80 / functions 70 / statements 75 / branches 70) -> `pnpm build`. New suite: `test/admin-bookings.e2e-spec.ts`.

**Target Platform**: Linux server / Vercel serverless (`server.js` imports `dist/app.bootstrap.js`, never `listen()`). All state is DB-backed; no in-memory state.

**Project Type**: web-service (NestJS REST API for platform administration dashboard).

**Performance Goals**: Global list query with filters p95 < 200ms; single booking inspection with inline audit trail < 100ms; atomic cancellation/reinstatement critical section < 20ms.

**Constraints**:
- Constitution hard principles I–VII (RLS boundaries, NestJS HS256 JWT, DB-driven RBAC, TDD red→green, least-privilege `app_tenant` for tenant path vs `SystemPrismaService` for platform path, `{ statusCode, data }` envelope, cursor pagination only, audit without secrets).
- PRD §12, §15, §16, §20, §21, §26 error codes and validation rules.

**Scale/Scope**: 7 new endpoints under `/admin/bookings`; 2 schema model enhancements; 1 Prisma migration.

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked post Phase 1 design.*

| # | Principle | Evaluation |
|---|---|---|
| I | Tenant Isolation Is a Security Boundary | **PASS** — Super Admin operations reside on the platform path (`@Platform()`), served exclusively via `SystemPrismaService` as permitted by Constitution Principle V and VII. Normal tenant request paths continue to use `app_tenant` and RLS isolation. |
| II | NestJS-Owned Authentication | **PASS** — Guarded by `JwtAuthGuard` and `PermissionGuard` checking `app_role === 'super_admin'`. Non-super-admins receive immediate `403 Forbidden`. No Supabase Auth. |
| III | Database-Driven RBAC | **PASS** — `super_admin` is the only predefined system role (Constitution III). Statuses and payment methods use string literals, zero TypeScript enums. |
| IV | Test-First Development (NON-NEGOTIABLE) | **PASS** — Red→green development: failing unit and e2e tests written first against embedded PostgreSQL (`.pgdata-test`). 100% of acceptance scenarios and concurrency boundaries verified. |
| V | Least-Privilege Database Access | **PASS** — Super Admin endpoints explicitly declare `@Platform()`, using the audited `SystemPrismaService` (table owner) connection. Normal tenant traffic cannot access these endpoints or bypass RLS. |
| VI | Simplicity and Anti-Abstraction | **PASS** — Plain NestJS controllers, services, and DTOs. Zero new runtime dependencies. Standard `{ statusCode, data }` response envelopes, cursor pagination (`items` + `nextCursor`), and structured error contracts. |
| VII | Auditable, Lockout-Safe Administration | **PASS** — Every privileged mutation (payment verification, refund, status change, force-cancel, reinstate, operational override, report resolution) calls `AuditService.log(...)` with sanitized metadata without secrets. |

---

## Project Structure

### Documentation (this feature)

```text
specs/005-super-admin-booking-review/
├── spec.md                   # Feature specification with ratified clarifications
├── checklists/
│   └── requirements.md       # Quality checklist (16/16 passed)
├── research.md               # Technical research and design decisions (R-01 to R-09)
├── data-model.md             # Entities, schema extensions, state machines, locking
├── contracts/
│   ├── admin-bookings.md     # API contracts for booking list, detail, status, cancel, reinstate, override
│   ├── admin-payments.md     # API contracts for payment verification, refunds, failures
│   ├── admin-reports.md      # API contract for incident report resolution
│   └── errors.md             # Canonical error catalog and envelope mappings
├── quickstart.md             # End-to-end runnable validation guide
└── plan.md                   # This file
```

### Source Code Changes & Structure

```text
prisma/
├── schema.prisma             # Extended Booking and PassengerReport models
└── migrations/
    └── <timestamp>_super_admin_booking_review/
        └── migration.sql     # Added columns on bookings and passenger_reports

src/
├── bookings/
│   ├── dto/
│   │   ├── admin-booking.dto.ts        # Query filters, list item, detail DTOs
│   │   ├── admin-payment.dto.ts        # Payment verify, refund, fail DTOs
│   │   └── admin-report.dto.ts         # Report resolution DTO
│   ├── admin-bookings.controller.ts    # [NEW] @Platform() @Controller('admin/bookings')
│   ├── admin-bookings.service.ts       # [NEW] Platform service using SystemPrismaService & AuditService
│   ├── admin-bookings.service.spec.ts  # [NEW] Unit tests for service logic
│   └── bookings.module.ts              # Register AdminBookingsController and AdminBookingsService

test/
└── admin-bookings.e2e-spec.ts          # [NEW] E2E test suite covering all 6 user stories on real PostgreSQL
```

---

## Complexity Tracking

> *No constitutional violations. Zero unjustified complexity.*

| Category | Decision | Justification |
|---|---|---|
| Connection Selection | `SystemPrismaService` | Mandated by Constitution Principle V and VII for privileged platform administration. |
| Pagination | Cursor-based only | Mandated by Constitution Principle VI (`toCursorPage`). |
| Error Contract | Standardized JSON | Aligns with PRD §26 and Constitution VI envelope. |
