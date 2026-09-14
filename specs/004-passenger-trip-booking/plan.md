# Implementation Plan: Passenger Trip Booking Flow

**Branch**: `main` (suggested: `004-passenger-trip-booking`) | **Date**: 2026-09-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-passenger-trip-booking/spec.md` (based on `WalledBus_Mobile_Users_Backend_PRD.md` §16–24, §2.1, §13, §26).

---

## Summary

Deliver the mobile passenger trip booking experience:
1. **Discovery**: Scheduled trip search (`GET /trips/search`) with live available seat counts and route details; public QR resolution (`GET /public/routes/:identifier`) displaying ordered stations and upcoming schedules.
2. **Booking & Concurrency**: Atomic seat reservation (`POST /bookings`) using row-level locking (`SELECT ... FOR UPDATE`) inside an interactive transaction to eliminate overbooking; duplicate-time booking conflict detection (`DUPLICATE_TIME_BOOKING`) with optional confirmation override (`confirmTimeConflict: true`).
3. **Management & Cancellation**: Personal booking list and detail endpoints with cursor pagination (`GET /bookings`, `GET /bookings/:id`); pre-departure cancellation (`POST /bookings/:id/cancel`, full or partial via `seatsToCancel`) with instant seat release and `REFUND_PENDING` reconciliation for digital payments.
4. **Day of Travel & Sharing**: Active trip descriptor (`GET /me/active-trip`) with assigned bus/driver context and Firebase Realtime Database channel; secure trip sharing (`POST /bookings/:id/share`) with rate-limited public verification (`POST /public/trip-shares/:shareId/verify`).

Approach: Extend Prisma schema with `routes`, `stations`, `route_stations`, `trip_shares`, and operational booking/trip columns; integrate RLS policies and grants; reuse `TenantContextService` and `CodedException` error handling; build TDD red→green with comprehensive e2e tests on real PostgreSQL.

---

## Technical Context

**Language/Version**: TypeScript strict (ESM, `"type": "module"`, `module/moduleResolution: nodenext` — relative imports carry `.js` suffix), Node.js 24, NestJS 12.

**Primary Dependencies**: `@nestjs/common|core|jwt|platform-express|swagger`, Prisma 7 (`prisma-client` generator ESM, `@prisma/adapter-pg`), `class-validator`/`class-transformer`, `pg`, `argon2`. Zero new runtime dependencies (R-01, R-02, R-07).

**Storage**: PostgreSQL (Supabase host / local embedded PG on port 5433 / test embedded PG on port 5434).
- New tables: `routes`, `stations`, `route_stations`, `trip_shares`.
- Extended tables: `trips` (`route_id`, `fare`), `bookings` (`passenger_user_id`, `total_amount`, `confirmed_at`, `cancelled_at`, `cancelled_by`, `cancellation_reason`).
- RLS: New tables join `tenant_isolation` in `prisma/sql/rls/001-tenant-isolation.sql`, enforced by `pnpm db:check-rls`.

**Testing**: Vitest — unit `*.spec.ts` colocated in `src/`, e2e `*.e2e-spec.ts` in `test/` (`pnpm test:e2e`, `fileParallelism: false`, refuses non-localhost URLs). Gates: `pnpm typecheck` -> `pnpm lint` -> `pnpm test:cov` (lines 80 / functions 70 / statements 75 / branches 70) -> `pnpm build`. New suite: `test/passenger-booking.e2e-spec.ts`.

**Target Platform**: Linux server / Vercel serverless (`server.js` imports `dist/app.bootstrap.js`, never `listen()`). All state is DB-backed; no in-memory state; rate limits rely on `throttle_counters`.

**Project Type**: web-service (NestJS REST API for mobile clients).

**Performance Goals**: Atomic seat reservation critical section < 15ms; trip search p95 < 200ms; zero overbooking under 20 concurrent reservation requests; rate-limited verification throttled in < 5ms.

**Constraints**:
- Constitution hard principles I–VII (RLS boundaries, NestJS HS256 JWT, DB-driven RBAC, TDD red→green, least-privilege `app_tenant`, `{ statusCode, data }` envelope, cursor pagination only, audit without secrets).
- PRD normative requirements (§16 booking flow, §17 concurrency locking, §18 duplicate-time conflict, §19 scoped retrieval, §20 cancellation, §22 active trip & Firebase channel, §23 secure sharing, §24 public QR resolution, §26 error codes).

**Scale/Scope**: ~10 new/augmented endpoints across `trips`, `bookings`, and `routes` modules; 4 new tables + 8 column extensions; 1 migration.

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked post Phase 1 design.*

| # | Principle | Evaluation |
|---|---|---|
| I | Tenant Isolation Is a Security Boundary | **PASS** — Every new table (`routes`, `stations`, `route_stations`) carries a mandatory `fleet_id` column with foreign key to `fleets(id)` and joins the fail-closed `tenant_isolation` RLS policy family. Bookings link to `fleet_id` of the trip. Passenger queries are strictly filtered by `passenger_user_id = actor.id` with BOLA protection returning 404 for foreign or nonexistent resources. |
| II | NestJS-Owned Authentication | **PASS** — Passenger endpoints require valid HS256 JWT with `app_role: 'passenger'` and verified phone number (`phoneVerifiedAt != null`). Public endpoints (`/trips/search`, `/trips/:id`, `/public/routes/:identifier`, `/public/trip-shares/:shareId/verify`) are explicitly declared public and disclose no tenant secrets. No Supabase Auth. |
| III | Database-Driven RBAC | **PASS** — Passenger role is a seeded DB row (`roles` table). String literal checks only; zero TypeScript role enums. |
| IV | Test-First Development (NON-NEGOTIABLE) | **PASS** — Red→green development: failing unit and e2e tests written first against real PostgreSQL (`.pgdata-test`). 100% of acceptance scenarios and concurrency boundaries verified. |
| V | Least-Privilege Database Access | **PASS** — Tenant request paths connect as `app_tenant` inside `TenantContextService.withFleetContext` / `withUserContext`. Privileged migrations and RLS setups use `DIRECT_URL`. Minimal table grants enumerated in `001-tenant-isolation.sql`. |
| VI | Simplicity and Anti-Abstraction | **PASS** — Plain NestJS modules, services, and controllers. Zero new runtime dependencies. No Redis, no Kafka, no Docker. Atomic locking uses PostgreSQL native `SELECT ... FOR UPDATE`. Standard `{ statusCode, data }` envelope and cursor pagination. |
| VII | Auditable, Lockout-Safe Administration | **PASS** — Audit events logged for booking creation, cancellation, rating, and share generation without secrets or sensitive tokens. Lockout guards untouched. |

---

## Project Structure

### Documentation (this feature)

```text
specs/004-passenger-trip-booking/
├── spec.md              # Feature specification with ratified requirements
├── checklists/
│   └── requirements.md  # Quality checklist (100% passed)
├── research.md          # Technical research and design decisions (R-01 to R-09)
├── data-model.md        # Entities, schema extensions, state machines, locking
├── contracts/
│   ├── passenger-booking.md # API contracts for bookings, cancellation, active trip
│   ├── routes-stations.md   # API contracts for search, trip details, QR resolution
│   ├── trip-sharing.md      # API contracts for secure sharing & public verification
│   └── errors.md            # Canonical PRD error codes and envelope mappings
├── quickstart.md        # End-to-end runnable validation guide
└── plan.md              # This file
```

### Source Code Changes & Structure

```text
src/
├── routes/                                # [NEW] Routes and Stations module
│   ├── dto/
│   │   └── route.dto.ts                  # Route, Station, RouteStation DTOs
│   ├── routes.controller.ts              # Public QR resolution & fleet route endpoints
│   ├── routes.service.ts                 # Route & station queries
│   └── routes.module.ts
├── trips/
│   ├── dto/
│   │   ├── trip.dto.ts                   # Extended with fare, routeId, search queries
│   │   └── trip-search.dto.ts            # Search criteria validation DTO
│   ├── trips-search.controller.ts        # [NEW] GET /trips/search and GET /trips/:id
│   ├── trips.service.ts                  # Extended with searchByOriginDestination
│   └── trips.module.ts
├── bookings/
│   ├── dto/
│   │   ├── passenger-booking.dto.ts      # [NEW] CreateBookingDto, CancelBookingDto, etc.
│   │   └── trip-share.dto.ts             # [NEW] Share verification DTO
│   ├── passenger-bookings.controller.ts  # [NEW] POST /bookings, GET /bookings, cancel, share
│   ├── public-shares.controller.ts       # [NEW] POST /public/trip-shares/:shareId/verify
│   ├── bookings.service.ts               # Extended with atomic seat reservation & cancel
│   ├── trip-shares.service.ts            # [NEW] Share generation & rate-limited verify
│   └── bookings.module.ts
├── users/
│   ├── me.controller.ts                  # Augmented with GET /me/active-trip
│   └── me.service.ts
└── generated/prisma/                     # Regenerated Prisma client after migration

prisma/
├── schema.prisma                         # Added models & fields
├── migrations/
│   └── <timestamp>_passenger_trip_booking/
│       └── migration.sql                 # DDL for routes, stations, shares, booking columns
└── sql/rls/
    └── 001-tenant-isolation.sql          # RLS policies & grants for routes, stations, shares

test/
├── passenger-booking.e2e-spec.ts         # [NEW] Full e2e test suite
└── test-helpers.ts                       # Fixtures for routes, stations, passenger tokens
```

**Structure Decision**: Monolithic modular architecture matching existing codebase patterns (`src/buses`, `src/trips`, `src/bookings`, `src/passenger-auth`). Clean division between public endpoints (`/trips/search`, `/public/routes/...`, `/public/trip-shares/...`) and authenticated passenger endpoints (`/bookings`, `/me/active-trip`).

---

## Complexity Tracking

*No violations. All design choices strictly adhere to Constitution Principles I–VII.*
