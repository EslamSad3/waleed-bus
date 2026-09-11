# Implementation Plan: Fleet Owner & Bus Driver Flows

**Branch**: `main` (no feature branch cut yet — suggested: `003-fleet-owner-driver-flows`) | **Date**: 2026-09-11 | **Spec**: PRD `WalledBus_Mobile_Users_Backend_PRD.md` §7–§8 (+ §9–§15 driver operation rules)

**Input**: PRD sections 7 (Fleet Owner) and 8 (Bus Driver) plus the normative driver-operation sections 9–15 (passenger data scope, boarding, drop-off, cash payment, ratings, reports). There is no ratified `spec.md` for this slice yet — the plan treats the PRD text as the source requirement and flags the five points that need spec-level clarification at the bottom.

**Note**: Produced by the `/speckit-plan` workflow (Phase 0 research + Phase 1 design). Context7 MCP consulted for NestJS (`/nestjs/docs.nestjs.com` — guards/RBAC/decorators), Prisma (`/prisma/skills` — interactive transactions), and Supabase (`/supabase/supabase` — RLS USING/WITH CHECK patterns); web search covered RLS multi-tenancy fail-closed practice, NestJS controller-service-repository clean boundaries, and OWASP/idempotent state-machine design (see research.md Sources).

## Summary

Give fleet owners and bus drivers their mobile backend: phone+password login through the existing shared `/auth/login` (`loginType` `FLEET_OWNER`/`DRIVER`, generic failures), a `fleet` module surface for owners (profile, owned buses incl. add/modify/disable/reactivate, driver roster + bus assignment with request-ready service seam, trip reads, reports), and a `driver` module surface for drivers (assigned bus/fleet, assigned trips + current trip, passenger manifest, idempotent board/drop-off/cash-payment/rate/report/complete-trip operations). Approach: reuse `AuthService` session/JWT machinery unchanged, anchor every fleet-scoped read/write in `FleetPathService` + transaction-local RLS context, add one `bus_assignments` table (single active driver per bus, single active bus per driver), extend `bookings` with operational columns (boarding, drop-off, cash payment, ratings), add `passenger_reports`, seed `fleet_owner`/`driver` roles + permission catalog, and keep the `{statusCode, data}` envelope with PRD error codes riding inside the extended error body (same pattern as spec 002). TDD red→green with e2e against real PostgreSQL; the 14-test isolation matrix must stay green.

## Technical Context

**Language/Version**: TypeScript strict (ESM, `"type": "module"`, `module/moduleResolution: nodenext` — relative imports carry `.js` suffix), Node.js 24, NestJS 12

**Primary Dependencies**: `@nestjs/common|core|jwt|platform-express|swagger`, Prisma 7 (`prisma-client` generator ESM, `@prisma/adapter-pg`), `argon2`, `class-validator`/`class-transformer`, `pg`. No new runtime dependencies (research R-09).

**Storage**: PostgreSQL (Supabase = host + RLS layer only; local/CI Postgres via `DATABASE_URL` tenant / `DIRECT_URL` owner; `prisma.config.ts` routes migrations to owner). New: `bus_assignments`, `passenger_reports`; extended: `bookings` operational columns. RLS: both new tables join the `tenant_isolation` policy family in `prisma/sql/rls/001-tenant-isolation.sql`, enforced by `db:check-rls` (research R-01, R-02).

**Testing**: vitest — unit `*.spec.ts` colocated in `src/`, e2e `*.e2e-spec.ts` in `test/` (`pnpm test:e2e`, `fileParallelism: false`, refuses non-localhost URLs). Gates: `pnpm typecheck` → `pnpm lint` → `pnpm test:cov` (lines 80 / functions 70 / statements 75 / branches 70) → `pnpm build`. New suites: `test/fleet-owner.e2e-spec.ts`, `test/driver-ops.e2e-spec.ts` + tenant-isolation additions (cross-fleet owner/driver matrix).

**Target Platform**: Linux server / Vercel serverless (`server.js` imports `dist/app.bootstrap.js`, never `listen()`). Consequence: all driver/owner state is DB-backed; no in-memory assignment caches; mobile retries handled by convergent state transitions, not server-side idempotency keys (research R-06).

**Project Type**: web-service (NestJS JSON API for mobile clients)

**Performance Goals**: Owner/driver reads p95 < 500 ms API-internal; driver manifest is one indexed query per trip; assignment checks are single-row lookups on partial unique indexes. No load-test gate beyond the existing e2e timing budgets.

**Constraints**:
- Constitution hard constraints: NestJS-only HS256 JWT (`app_role` custom claim, short-lived access + rotating hashed refresh, `authVersion` revocation); `{statusCode, data}` success envelope; DB-driven RBAC (no TS role/permission enums; only `super_admin` predefined — new `fleet_owner`/`driver` roles are seeded DB rows); `app_tenant` least-privilege path; transaction-local tenant context; audit of privileged ops without secrets; TDD gate; cursor pagination only.
- PRD normative rules (§3 auth genericity, §7 owner capabilities + request-oriented seam, §8–§15 driver capability list + per-operation validations + error-code catalog §26).
- No Supabase Auth, no Docker, no offset pagination, no committed secrets, no Firebase backend work (live location stays client→Firebase RTDB; backend exposes only assignment/trip reads — research R-10).

**Scale/Scope**: ~20 endpoints across two new modules (`fleet-owner`, `driver-ops`) reusing `BusesService`/`BookingsService`/`MembersService` patterns; 2 new tables + ~12 booking columns + role/permission seeds; 1 migration. Single region; no caching layer.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design — see bottom re-check.*

| # | Principle | Evaluation |
|---|---|---|
| I | Tenant isolation (RLS boundary) | PASS — every new row carries `fleet_id` and is covered by the fail-closed `tenant_isolation` policy (USING + WITH CHECK on `fleet_id` = tx setting AND `app.is_fleet_member`). Driver trip access resolves `fleetId` from the trip row inside the same tenant tx (never from client input); cross-fleet ids → 404 via RLS invisibility, same as `BookingsService.create` today. New tables added to `db:check-rls` surface automatically. |
| II | NestJS-owned auth | PASS — JWT shape unchanged; FLEET_OWNER/DRIVER are `loginType` selectors on the existing shared login, validated server-side against live membership/role rows; `loginType` never grants authority; failures stay generic `AUTHENTICATION_FAILED` (dummy-hash path for unknown phones, as in 002). No Supabase Auth. |
| III | DB-driven RBAC | PASS — `fleet_owner`/`driver` are seeded `Role` rows; all checks via `@RequirePermission` keys (`fleet.buses.*`, `fleet.drivers.*`, `fleet.reports.read`, `driver.trips.*`, …) resolved from the ACTIVE membership's role. Slug string literals only, no enums. |
| IV | Test-first (NON-NEGOTIABLE) | PASS — red→green mandated: failing unit + e2e specs first on real PostgreSQL (embedded `.pgdata-test`), isolation matrix extended with owner/driver cross-fleet cases, coverage gate retained. |
| V | Least-privilege DB access | PASS — owner/driver request paths run on `app_tenant` inside `withFleetContext`; login uses the explicit system path (no identity exists yet — same as current login); `app_tenant` grants enumerated per table in the RLS script; business services never touch `SystemPrismaService` directly (only via `FleetPathService`). |
| VI | Simplicity / anti-abstraction | PASS — plain NestJS modules/services/guards/decorators following the existing `buses`/`bookings` module shape; zero new runtime deps; request→approval seam is a narrow service interface, not a workflow engine; envelope + cursor pagination preserved. |
| VII | Auditable, lockout-safe admin | PASS — audit `fleet.bus.*`, `fleet.driver.*`, `driver.trip.*`, `driver.passenger.*` actions with ids only (no PII beyond the identifiers the audit log already stores; never passwords/tokens); driver/owner mutations that change authorization bump `authVersion` + revoke sessions (same helper as `MembersService`); no changes to the `super_admin` lockout guards. |

Pre-Phase-0 gate: **PASS (no violations, Complexity Tracking empty).**

## Project Structure

### Documentation (this feature)

```text
specs/003-fleet-owner-driver-flows/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── fleet-owner.md   # /fleet/* + /me owner endpoints
│   ├── driver.md        # /driver/* endpoints
│   └── errors.md        # error code catalog + envelope mapping
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── fleet-owner/                    # NEW module (owner surface)
│   ├── fleet-owner.module.ts
│   ├── fleet-owner.controller.ts   # GET/PATCH /me, /fleet/buses*, /fleet/trips*, /fleet/reports, /fleet/drivers*
│   ├── fleet-owner.service.ts      # orchestration; business ops isolated for future request/approval seam
│   ├── bus-lifecycle.service.ts    # disable/reactivate guards (no DEPARTED trip on bus)
│   ├── dto/fleet-owner.dto.ts
│   └── *.spec.ts
├── driver-ops/                     # NEW module (driver surface)
│   ├── driver-ops.module.ts
│   ├── driver-ops.controller.ts    # /driver/bus, /driver/fleet, /driver/trips*, passenger ops, complete
│   ├── driver-ops.service.ts       # assignment-anchored ops, all inside one tenant tx per op
│   ├── driver-trip.guard.ts        # водитель assigned to trip (via active bus_assignment in-tx)
│   ├── dto/driver-ops.dto.ts
│   └── *.spec.ts
├── auth/
│   ├── auth.service.ts             # EXTEND: FLEET_OWNER/DRIVER phone login + account-type check
│   ├── auth.controller.ts          # no route change (same /auth/login body, wider loginType use)
│   └── dto/auth.dto.ts             # EXTEND: document owner/driver phone variants
├── buses/ trips/ bookings/         # REUSE via FleetPathService (bookings gains operational updates)
├── authorization/                  # REUSE guards/decorators; new permission keys seeded, not coded
└── generated/prisma/               # REGENERATED via `pnpm db:generate`

prisma/
├── schema.prisma                   # EXTEND: BusAssignment, PassengerReport, Booking ops columns
├── migrations/<ts>_fleet_owner_driver/  # NEW migration + role/permission seeds
└── sql/rls/001-tenant-isolation.sql     # EXTEND: policies + grants for 2 new tables

test/
├── fleet-owner.e2e-spec.ts         # NEW: owner matrix (roster, buses, lifecycle, cross-fleet 404s)
├── driver-ops.e2e-spec.ts          # NEW: assignment ops, idempotent retries, rating/report guards
└── tenant-isolation.e2e-spec.ts    # EXTEND: owner/driver cross-fleet cases
```

**Structure Decision**: Single NestJS project. Two new modules (`fleet-owner`, `driver-ops`) own the mobile surfaces; fleet-owned persistence stays behind the existing `FleetPathService` two-path pattern; no new top-level infra. Migration precedes RLS scripts per the quality gate (`db:migrate:deploy` → `db:setup-rls` → `db:check-rls` → `docs:generate`).

## Complexity Tracking

None — no violations.

---

## Post-Phase-1 Constitution Re-check

| # | Re-evaluation after design (research.md + data-model.md + contracts/) | Result |
|---|---|---|
| I | New tables carry `fleet_id` + `tenant_isolation` policies (USING and WITH CHECK); driver ops bind `fleetId` from the in-tx trip row; FK-bypass rule honored by loading trip+booking+assignment in one tenant tx; cross-fleet → 404. | PASS |
| II | JWT/session machinery untouched; `loginType` is a flow selector with server-side account-type verification and generic failures. | PASS |
| III | `fleet_owner`/`driver` roles + permission keys are migration seeds; guards use key strings via existing decorators; no enums. | PASS |
| IV | quickstart.md defines red→green e2e matrices on real PG; isolation-matrix extension required before merge. | PASS |
| V | All owner/driver data paths via `FleetPathService` tenant path; system path only for login (documented) and super_admin platform context; grants enumerated. | PASS |
| VI | Zero new dependencies; envelope + cursor pagination kept; approval seam is an interface, not a framework. | PASS |
| VII | Audit catalog added (research R-08); no secrets in logs; `authVersion` bump on authorization-changing mutations only (assignment/role/status), not on operational writes (board/drop-off/complete). | PASS |

Post-design gate: **PASS. Ready for `/speckit-tasks`.**

## Clarification decisions (session 2026-09-11 — recorded in plan.md; no spec.md ratified yet)

- Scope: trips lifecycle flow SKIPPED for this round — focus is fleet-owner and driver flows only. Open item #1 (departure trigger / start-trip op) DEFERRED, not decided.
- Q2 (independent fleet-less drivers): DECIDED — option B. Independent drivers supported in v1 with fleet-less tenant context + separate policies. ✅ RESOLVED by T045 (research R-10): auto-provisioned single-driver personal fleet at first DRIVER login — zero RLS/context/data-model changes; `independent_driver` role seeded in the migration.
- Q3 (disable-bus with future SCHEDULED trips): DECIDED — option A. Disable blocked only by DEPARTED trips; SCHEDULED trips do not stop disable (plan §Bus lifecycle unchanged; reassignment of scheduled trips stays a platform concern).
- Q4 (`GET /fleet/reports` shape): DECIDED — option A. v1 returns `{reports: PassengerReport[], ratingSummary: {busAvg, driverAvg, count}}` scoped to owned fleet (contracts/fleet-owner.md §Reports confirmed, no change).
- Q5 (`GET /driver/fleet` PII scope): DECIDED — option B. Returns fleet name + phone + owner contact details. ⚠️ Follow-up: contracts/driver.md currently specifies name+phone only — needs update, plus a permission/privacy note on which owner-contact fields are exposed.

## Open spec clarifications (for `/speckit-specify`)

1. Trip departure trigger: no PRD endpoint starts a trip — assume DEPARTED comes from the existing platform flow; driver `complete` requires DEPARTED. Confirm or add a start-trip op.
2. Independent (fleet-less) drivers (§8 "OR independent driver with its own bus") are SUPPORTED in v1 via auto-provisioned personal fleets (T045/R-10) — no fleet-less context needed.
3. Disable-bus behavior with future SCHEDULED trips (warn vs block) — plan blocks only on DEPARTED trips.
4. `GET /fleet/reports` content shape (plan: report list + rating aggregates) — confirm fields.
5. `GET /driver/fleet` exposes fleet name+phone only — confirm no wider fleet PII.
