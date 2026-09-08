# Data Model: Passenger Auth Flow

**Feature**: `002-passenger-auth-flow` | **Date**: 2026-09-07
**Source**: spec.md FR-001–FR-022 + research.md R-01/R-02/R-05/R-08/R-09. Prisma 7 (`prisma/schema.prisma`, snake_case tables).

## Changes to existing `User` model

| Column | Type | Null | Constraint | Notes |
|---|---|---|---|---|
| `email` | `VarChar(255)` | YES (was NOT NULL) | unique (partial effect: multiple NULLs allowed in Postgres) | Existing platform login unchanged (`findUnique` by email). Migration safe: current rows all have emails. |
| `phone_number` | `VarChar(20)` | YES | **UNIQUE** (spec FR-021, global across all account types) | Canonical `01XXXXXXXXX` form (R-09). Set at registration or social phone entry. |
| `phone_verified_at` | `Timestamptz` | YES | — | NULL = unverified/restricted. Sole driver of session scope (R-05). |
| `picture` | `VarChar(1024)` | YES | — | Optional passenger picture (PRD #6). |

Relations added: `authProviders UserAuthProvider[]`, `phoneChallenges PhoneVerificationChallenge[]` (by phone, logical — see below).

**Invariants**:
- `phoneNumber` unique where not null (Postgres unique index semantics) — registration and phone-change run in a transaction: normalize → check conflict → write. Conflict ⇒ non-revealing generic error (spec FR-014/FR-021).
- At least one of `email` / `phoneNumber` / linked provider must exist (app-layer check on create).
- Password login requires `passwordHash` to match AND `phoneVerifiedAt` non-null for full login; correct credentials + null `phoneVerifiedAt` ⇒ `PHONE_NOT_VERIFIED` (spec FR-002).

## New model: `UserAuthProvider` → `user_auth_providers`

Social identity link (spec entity "Social Identity Link", PRD #6).

| Column | Type | Constraint |
|---|---|---|
| `id` | Uuid PK | default `uuid()` |
| `user_id` | Uuid FK → `users.id` | `onDelete: Cascade`, index |
| `provider` | `VarChar(20)` | app-layer validated `GOOGLE` \| `APPLE` (plain strings, not a TS enum) |
| `provider_user_id` | `VarChar(255)` | — |
| `created_at` / `updated_at` | Timestamptz | — |

- `@@unique([provider, provider_user_id])` — one link per provider identity, prevents double-registration.
- Lookup path: provider link → user (login); user → links (account merge display, future).

## New model: `PhoneVerificationChallenge` → `phone_verification_challenges`

Time-bound single-use demand (spec entity "Phone Verification Challenge", FR-006–FR-012).

| Column | Type | Notes |
|---|---|---|
| `id` | Uuid PK | challenge id used in `otp:verify` throttle keys |
| `phone_number` | `VarChar(20)` | **UNIQUE** — one active row per phone; resend upserts this row (resets `expires_at`, keeps/refreshes `last_sent_at`, does NOT reset `attempts`? Decision: resend resets attempts to 0 — new code epoch. Locked: resend starts a fresh 5-guess budget with fresh 5-min expiry.) |
| `purpose` | `VarChar(20)` | `REGISTRATION` \| `PROFILE` \| `PHONE_CHANGE` (plain strings) |
| `user_id` | Uuid FK → `users.id`, nullable | owner when known (registration links after create); nullable to allow challenge-before-user edge ordering |
| `expires_at` | Timestamptz | `created + 5 min` (locked) |
| `attempts` | Int | default 0; lock at 5 (6th guess rejected, challenge marked consumed/expired) |
| `consumed_at` | Timestamptz, nullable | set on success OR on lockout; any non-null ⇒ reject replay (FR-009) |
| `last_sent_at` | Timestamptz | resend cooldown: reject if < 60 s (FR-011) |
| `created_at` / `updated_at` | Timestamptz | — |

- No code column (fixed `123456` phase; R-04). A future `code_hash` column is the documented SMS-swap extension — no lifecycle change needed.
- State machine: `ACTIVE → CONSUMED(success) | CONSUMED(locked, attempts≥5) | EXPIRED(now > expires_at)`. Concurrent verify uses `SELECT … FOR UPDATE` (transaction) so only one success consumes.

## New model: `ThrottleCounter` → `throttle_counters`

Generic DB-backed rate-limit buckets (spec FR-015/FR-016; locked budgets).

| Column | Type | Notes |
|---|---|---|
| `key` | `VarChar(128)` PK | `login:phone:<canonical>` \| `login:ip:<ip>` \| `otp:send:<phone>` \| `otp:verify:<challengeId>` |
| `count` | Int | failures/sends in current window |
| `window_start` | Timestamptz | window anchor; stale windows reset on next hit |
| `updated_at` | Timestamptz | — |

- Windows: login 15 min (5 per phone, 20 per source IP); `otp:send` 10 min (3 per phone); `otp:verify` 10 min (10 per challenge, independent of the 5-guess lock).
- Success resets the relevant counter (`login:phone` on successful login; challenge row consumed on verify success).
- No `app_tenant` grants (constitution V): all access via system path inside `ThrottleService`/`OtpService` transactions.

## `Session` — no schema change

Scope is derived per request (R-05): `full` iff live `user.phoneNumber != null && user.phoneVerifiedAt != null`, else `restricted`. Phone change (`phoneNumber := new, phoneVerifiedAt := null` in one transaction + `authVersion` untouched) instantly restricts all live sessions; successful verification upgrades them with no re-login. Refresh rotation and 7-day TTL unchanged.

## Seed / migration ordering

1. Prisma migration: alter `users` (nullable email, new columns), create 3 tables, seed `roles(slug='passenger', isSystem=true, isActive=true)` + minimal `permissions` only if passenger-scoped routes require permission rows (default: none — route scoping is by `app_role` + profile scope, not fleet permissions).
2. `pnpm db:generate` → `pnpm db:migrate:deploy` → `scripts/db-setup-rls.ts` → `scripts/check-rls.ts` (new tables explicitly excluded from `app_tenant` grants; check script must still pass).
3. Rollback: migration down reverses seed row first, then tables, then column restores (email NOT NULL restore guarded by `WHERE email IS NULL` count = 0 assertion).

## Validation rules summary (DTO layer)

- Phone: normalize (R-09) then `^01[0-9]{9}$`, max 20 chars.
- Password: min 8, max 128 (existing `LoginDto` rule reused for register).
- Name: 1–255 chars, required at registration; optional on update.
- OTP: exactly 6 digits (fixed `123456` in this phase; format check stays for the SMS future).
- `loginType`: required literal `PASSENGER` on mobile login variants; absent ⇒ legacy email platform login (backward compat, see contracts/auth.md).
