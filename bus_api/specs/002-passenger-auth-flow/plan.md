# Implementation Plan: Passenger Auth Flow

**Branch**: `002-passenger-auth-flow` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-passenger-auth-flow/spec.md` (PRD #3/#4/#5, passenger only; fixed OTP `123456`; locked OTP + rate-limit values; 5 clarification answers integrated 2026-09-07)

**Note**: This plan was produced by the `/speckit-plan` workflow (Phase 0 research + Phase 1 design).

## Summary

Extend the existing NestJS-owned email/password auth with a passenger identity: phone-based registration and login, Google/Apple provider login, fixed-code OTP phone verification (`123456` until an SMS provider is chosen), profile-completeness status and update, and DB-backed rate limiting on login/OTP. Approach: add `phoneNumber`/`phoneVerifiedAt`/`picture` to `User`, add `UserAuthProvider`, `PhoneVerificationChallenge`, and `ThrottleCounter` tables, implement a `passenger-auth` module reusing `AuthService` session/JWT machinery and `AuditService`, derive restricted-vs-full session scope server-side from live verification state (no JWT claim change), and extend the shared error filter with PRD error `code`/`details` fields while keeping the `{statusCode, data}` success envelope. No new runtime dependencies. TDD red→green with e2e against real PostgreSQL.

## Technical Context

**Language/Version**: TypeScript strict (ESM, `"type": "module"`), Node.js, NestJS 12

**Primary Dependencies**: `@nestjs/common|core|jwt|platform-express|swagger`, Prisma 7 (`prisma-client` generator, `@prisma/adapter-pg`), `argon2`, `class-validator`/`class-transformer`, `pg`. No new runtime dependencies (see research.md R-03, R-04).

**Storage**: PostgreSQL (Supabase = platform + RLS layer; local native PostgreSQL for dev/test via `DATABASE_URL`/`DIRECT_URL`). Prisma 7 with `prisma.config.ts` datasource URLs. New tables: `User` columns + `user_auth_providers`, `phone_verification_challenges`, `throttle_counters` (see data-model.md).

**Testing**: vitest — unit `*.spec.ts` colocated in `src/`, e2e `*.e2e-spec.ts` in `test/` run via `pnpm test:e2e` (requires local Postgres; e2e refuses non-localhost URLs). Quality gate: `pnpm lint`, `pnpm test`, `pnpm test:cov` (≥80%), `pnpm test:e2e`. Existing 14-test isolation matrix must keep passing.

**Target Platform**: Linux server / Vercel serverless (`vercel.json`, `server.js` present). Consequence: no in-memory rate-limit or challenge state — all throttle/OTP state is DB-backed; JWKS cache is best-effort in-memory with refetch-on-miss so cold starts stay correct.

**Project Type**: web-service (NestJS JSON API for mobile clients)

**Performance Goals**: Spec SC-001 (registration incl. verification < 3 min), SC-003 (login < 30 s); API-internal target p95 < 500 ms for auth/OTP endpoints excluding client think time. Throttle counters use single-row upserts; challenge lookup is one indexed query.

**Constraints**:
- Constitution hard constraints: NestJS-only JWT (HS256, `app_role` claim, validated signature/expiry/issuer/audience/subject); `{statusCode, data}` success envelope; DB-driven RBAC (no TS role/permission enums; only `super_admin` predefined); `app_tenant` least-privilege path; transaction-local tenant context; audit of login success/failure without secrets; TDD gate.
- Spec normative values (locked 2026-09-07): OTP 5-min lifetime / 60-s resend cooldown / 5 guesses per challenge / single use / fixed code `123456`; login throttle 5 failures per phone + 20 per source per 15 min; OTP send 3 per phone per 10 min; verify 10 per challenge per 10 min; generic failures except the `PHONE_NOT_VERIFIED` signal; globally unique phones; restricted incomplete-profile sessions.
- No Supabase Auth, no Docker, no offset pagination, no committed secrets.

**Scale/Scope**: MVP passenger-auth slice: ~6 endpoints, 3 new tables, 3 extended DTO groups, 1 new NestJS module + AuthService/AuthGuard extensions. Single region; DB-backed counters scale with Postgres; no caching layer (constitution VI).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design — see bottom re-check.*

| # | Principle | Evaluation |
|---|---|---|
| I | Tenant isolation (RLS boundary) | PASS — new identity tables (`user_auth_providers`, `phone_verification_challenges`, `throttle_counters`) and `User` phone columns are platform-level identity data, not fleet-owned, so no `fleet_id`/RLS applies. Public auth endpoints use the privileged system path by necessity (no identity exists yet — identical to existing `AuthService.login`). `app_tenant` receives NO grants on the new tables. No fleet data is touched by these flows; the 14-test isolation matrix is unaffected (must still pass). |
| II | NestJS-owned auth | PASS — all tokens remain NestJS HS256 JWTs with validated signature/expiry/issuer/audience/subject; `app_role` stays a JWT-only claim, never duplicated in bodies. Google/Apple `idToken`s are verified server-side via provider JWKS and then exchanged for NestJS tokens; no Supabase Auth. |
| III | DB-driven RBAC | PASS — passenger authority is a `Role` row (`slug: 'passenger'`, seeded by migration) assigned through `UserRole`, resolved by the existing `resolveAppRole`/`appRoleFrom` machinery. No TS role/permission enums; slug string literals only (same pattern as existing `'super_admin'`/`'user'`). |
| IV | Test-first (NON-NEGOTIABLE) | PASS — plan mandates red→green: failing unit + e2e specs first (real PostgreSQL), coverage ≥80%, isolation matrix green before merge. |
| V | Least-privilege DB access | PASS — normal authenticated passenger reads use the tenant path (`app_tenant` + transaction-local context, fail-closed on fleet tables since passengers hold no membership). Unauthenticated auth/OTP endpoints use the explicit system path (documented, same as current login). New tables: no `app_tenant` grants. |
| VI | Simplicity / anti-abstraction | PASS — plain NestJS module/services/guards/decorators; zero new runtime dependencies (JWKS via global `fetch` + transitive `jsonwebtoken`; throttle via Prisma); envelope preserved; no caching layer. |
| VII | Auditable, lockout-safe admin | PASS — audit `auth.login.success/failure`, `otp.send/verify`, `provider.link`, `profile.update`, `phone.change` via `AuditService` with no secrets (phone numbers are account identifiers, permitted; never log codes/tokens/passwords). Phone change does NOT bump `authVersion`/revoke (restricted session must survive to finish verification) — restriction is derived from live state instead; documented in data-model.md. No admin lockout surface (no role/admin mutations in this feature). |

Pre-Phase-0 gate: **PASS (no violations, Complexity Tracking empty).**

## Project Structure

### Documentation (this feature)

```text
specs/002-passenger-auth-flow/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── auth.md          # register + shared login (passenger variants)
│   ├── otp.md           # send-otp / verify-otp
│   ├── profile.md       # profile-status + PATCH /me
│   └── errors.md        # error code catalog + envelope mapping
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── passenger-auth/                  # NEW module (this feature)
│   ├── passenger-auth.module.ts
│   ├── passenger-auth.controller.ts # register, send-otp, verify-otp, profile-status, PATCH /me
│   ├── dto/
│   │   └── passenger-auth.dto.ts    # RegisterDto, SendOtpDto, VerifyOtpDto, UpdateMeDto, ProfileStatusDto
│   ├── otp.service.ts               # challenge lifecycle (spec FR-006..FR-012, FR-016)
│   ├── otp.service.spec.ts
│   ├── providers.service.ts         # Google/Apple idToken → verified identity (no new deps)
│   ├── providers.service.spec.ts
│   ├── throttle.service.ts          # DB-backed counters (spec FR-015/FR-016)
│   ├── throttle.service.spec.ts
│   └── profile-scope.guard.ts       # rejects restricted sessions outside profile/OTP routes
├── auth/
│   ├── auth.controller.ts           # EXTEND: loginType-union login (passenger phone + provider)
│   ├── auth.service.ts              # EXTEND: passenger login, PHONE_NOT_VERIFIED signal, dummy-hash path, audit
│   ├── auth.service.spec.ts         # EXTEND
│   ├── guards/jwt-auth.guard.ts     # EXTEND: derive profile scope from live verification state
│   └── dto/auth.dto.ts              # EXTEND: PassengerPhoneLoginDto, ProviderLoginDto
├── common/
│   ├── filters/all-exceptions.filter.ts  # EXTEND: emit {statusCode, code, message, details?, retryAfter?}
│   └── decorators/profile-scope.decorator.ts  # NEW: @AllowRestricted() marker
├── audit/audit.service.ts           # REUSE (no change; new action strings only)
└── generated/prisma/                # REGENERATED via `pnpm db:generate`

prisma/
├── schema.prisma                    # EXTEND: User phone columns + 3 new models
├── migrations/                      # NEW migration (User alter + tables + 'passenger' role seed)
└── seed.ts                          # EXTEND if role seeding lives here (see data-model.md)

test/
├── passenger-auth.e2e-spec.ts       # NEW: full matrix (register/verify/login/provider/profile/throttle/generic-errors)
└── helpers/                         # REUSE e2e harness (embedded/real PG)
```

**Structure Decision**: Single NestJS project (Option 1). New `src/passenger-auth/` module owns OTP/provider/throttle/profile-scope logic; `src/auth/` is extended (not forked) for the shared login endpoint per PRD #3; error-shape extension stays in the existing global filter to preserve one error path. Migration precedes RLS scripts per the quality gate (`db:migrate` → `db:setup-rls` → `db:check-rls`).

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

None — no violations.

---

## Post-Phase-1 Constitution Re-check

| # | Re-evaluation after design (research.md + data-model.md + contracts/) | Result |
|---|---|---|
| I | Public OTP/register endpoints use system path with phone-keyed rows only; `app_tenant` granted nothing new; no fleet predicates bypassed; isolation matrix untouched. | PASS |
| II | JWT shape unchanged (no new claims); scope derived server-side per request from `phoneVerifiedAt`; provider tokens verified via JWKS then discarded. | PASS |
| III | `passenger` role is a seeded DB row assigned via `UserRole`; guard/decorator use slug strings, no enums. | PASS |
| IV | quickstart.md defines red→green e2e matrix on real PG; coverage gate retained. | PASS |
| V | Services document system-path vs tenant-path usage; transaction-local context unchanged; throttle/challenge writes are keyed counters, never tenant reads. | PASS |
| VI | Zero new dependencies confirmed in research R-03/R-04; envelope + single error filter retained; no cache, no abstraction layers. | PASS |
| VII | Audit action catalog added (research R-07); no secrets in logs (codes/tokens/passwords excluded; phone = identifier only); phone-change restriction without `authVersion` bump justified (restricted session must survive; live-state derivation is the enforcement). | PASS |

Post-design gate: **PASS. Ready for `/speckit-tasks`.**
