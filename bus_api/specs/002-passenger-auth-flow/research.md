# Research: Passenger Auth Flow

**Feature**: `002-passenger-auth-flow` | **Date**: 2026-09-07
**Method**: Direct codebase inspection (`src/auth/*`, `src/users/*`, `src/audit/*`, `src/common/filters|interceptors`, `src/config/*`, `prisma/schema.prisma`, `package.json`, `test/*`). No NEEDS CLARIFICATION remained in Technical Context; the table below records every material decision.

## R-01 — `User.email` becomes nullable; phone becomes the passenger identifier

- **Decision**: Alter `User.email` to nullable-unique; add `phoneNumber` (nullable, globally unique), `phoneVerifiedAt` (nullable timestamp), `picture` (nullable). Existing rows keep their emails; migration is safe.
- **Rationale**: The current schema (`schema.prisma:14-30`) is email-centric (`email NOT NULL UNIQUE`), but the spec mandates phone as the mandatory passenger identifier and Google/Apple sign-in (Apple can withhold email; social users may have no password). Nullable email preserves the existing platform login (`findUnique where email`) while allowing phone-only and provider-only passenger rows. Global phone uniqueness (spec FR-021) is enforced by a DB unique constraint — the strongest, race-free enforcement.
- **Alternatives considered**: (a) Synthetic placeholder emails for social users — rejected (fake PII pollutes the unique index and leaks into audit/logs). (b) Separate `Passenger` table — rejected (splits identity, duplicates session/RBAC machinery, violates simplicity VI).

## R-02 — OTP challenges + throttle counters as DB tables (no new infra)

- **Decision**: New `phone_verification_challenges` table (one active row per phone, app-layer upsert; expiry/attempts/consumed/last-sent columns) and generic `throttle_counters` table (`key` unique, `count`, `window_start`; keys `login:phone:<n>`, `login:ip:<ip>`, `otp:send:<phone>`, `otp:verify:<challengeId>`). All increments are single-row atomic upserts inside transactions.
- **Rationale**: The repo runs serverless (`vercel.json`, `server.js`) — in-memory throttle/OTP state would be per-instance and incorrect. DB-backed state is correct on every instance, survives restarts, and needs no new dependency (constitution VI). Single-active-challenge-per-phone is enforced by upsert-on-`phoneNumber` in a transaction (Prisma cannot express partial unique indexes; app-layer + unique phone column on the challenge table with delete-on-consume is the explicit alternative — see data-model.md).
- **Alternatives considered**: `@nestjs/throttler` + in-memory/Redis store — rejected (new dependency + Redis is premature infrastructure; in-memory is wrong on serverless). Separate per-operation counter tables — rejected (one generic table is smaller and explicit).

## R-03 — Google/Apple `idToken` verification with zero new dependencies

- **Decision**: `ProvidersService` verifies tokens with global `fetch` against provider JWKS (Google `https://www.googleapis.com/oauth2/v3/certs`, Apple `https://appleid.apple.com/auth/keys`), key caching best-effort in-memory with refetch-on-`kid`-miss, signature check via the transitive `jsonwebtoken` (already present through `@nestjs/jwt`), validating `iss`/`aud`/`exp`. Verified identity (provider, providerUserId, email, email_verified) is returned; the raw `idToken` is never stored or logged.
- **Rationale**: Constitution VI requires dependency justification — both flows reduce to "fetch JWKS once, verify JWT", which the existing stack already covers. Apple mandates ES256 JWKS verification (no tokeninfo equivalent); using the same JWKS path for Google keeps one code path. `email_verified` from Google is honored: unverified provider emails are treated as absent for contact purposes (passenger still needs phone verification regardless).
- **Alternatives considered**: `google-auth-library` + `jwks-rsa` — rejected (two new deps for logic expressible in ~80 lines with existing packages; revisit only if key-rotation edge cases demand it). Calling Google `tokeninfo` per login — rejected (extra network hop per login, quota-limited, Apple has no equivalent).

## R-04 — Fixed code `123456` compares against a constant; challenges still modeled fully

- **Decision**: `OtpService.verify` checks challenge state first (exists → not expired → not consumed → attempts < 5 → throttle budget), then constant-time-compares the submitted code to the `FIXED_OTP` constant (`123456`, sourced from env `OTP_FIXED_CODE` defaulting to `123456` so tests pin it). No code hash is stored — there is nothing per-challenge to store. All lifecycle columns (expiry, attempts, cooldown, single-use) behave exactly as they will with random codes, so the SMS-provider swap later changes only the code source.
- **Rationale**: Spec FR-007 mandates the fixed code temporarily; modeling the full lifecycle now (rather than stubbing verification to `code === '123456'`) means the provider swap is a one-line source change with identical tests. Threat accepted per spec: anyone knowing `123456` can verify any phone with a live challenge — mitigated to the spec's budgets (5 guesses, send/verify throttles) and recorded here for the future swap.
- **Alternatives considered**: Random codes logged to console "for dev" — rejected (spec FR-013 forbids disclosure; logs are client-accessible in some deployments). Skipping challenge rows until SMS arrives — rejected (defers all lifecycle logic and its tests).

## R-05 — Restricted scope derived server-side from live state (no JWT change)

- **Decision**: No new JWT claims. `JwtAuthGuard` already loads the live user + session per request; it additionally attaches `profileScope: 'restricted' | 'full'` derived from `user.phoneNumber && user.phoneVerifiedAt`. A `ProfileScopeGuard`/route marker (`@AllowRestricted()`) permits only profile-status, profile update, send-otp, verify-otp for restricted sessions; every other authenticated route requires `full`.
- **Rationale**: Derivation stays correct without touching sessions on phone change: the verified number remains live (so all sessions stay `full`) until verification swaps the new number in — no revocation logic and no `authVersion` bump, which would destroy the session that must survive to finish verification. No token-shape change means existing clients/guards/tests are unaffected (constitution II/VII patterns preserved).
- **Alternatives considered**: `scope` JWT claim — rejected (stale claims need revocation plumbing; derivation is always fresh). Separate short-lived profile token — rejected (second token type, second issuance/validation path, more complexity for identical security).

## R-06 — PRD error codes ride inside the platform envelope (no fork)

- **Decision**: Keep `{statusCode, data}` success envelope (constitution VI) and extend `AllExceptionsFilter`'s error body to `{statusCode, code, message, details?, retryAfter?}`, where `code` is the PRD code (`AUTHENTICATION_FAILED`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_RATE_LIMITED`, `PHONE_NOT_VERIFIED`, …). HTTP statuses: 401 generic auth failures, 403 `PHONE_NOT_VERIFIED`, 422 validation, 429 throttles with `retryAfter` seconds. Controllers/services throw typed `HttpException`s carrying `code`/`details`.
- **Rationale**: The PRD's `{success, error:{code…}}` contract and the constitution's `{statusCode,…}` envelope conflict; the extension satisfies both — transport shape unchanged (existing clients/tests keep passing), PRD codes present for mobile clients (see contracts/errors.md). A parallel mobile error format was rejected as a second error path (complexity, divergent handling).
- **Alternatives considered**: Mobile-only exception filter — rejected (two error paths, filter ordering hazards). Stuffing codes into `message` strings — rejected (unparseable, breaks i18n later).

## R-07 — Audit every auth event without secrets; login timing-oracle mitigation

- **Decision**: Emit `AuditService.log` for `auth.login.success`, `auth.login.failure` (metadata: loginType, phone masked to last 2 digits? No — phone is the account identifier and audit already stores identifiers; store full phone, never passwords/tokens/codes), `auth.register`, `otp.send`, `otp.verify.success/failure`, `provider.link`, `profile.update`, `phone.change`. Audit writes stay best-effort (service already swallows failures loudly). Login performs `argon2.verify` against a constant dummy hash when no user is found, so unknown-phone vs wrong-password timing is indistinguishable.
- **Rationale**: Constitution VII mandates login success/failure audit with no secrets; the current `AuthService.login` writes none — this feature closes that gap for its own paths. Dummy-hash verification removes the user-existence timing oracle that generic messages alone don't cover.
- **Alternatives considered**: No audit on failure (avoid log spam) — rejected (VII explicitly requires it). Masked phone in audit — rejected (identifiers are legitimate audit content; masking would hinder abuse investigation).

## R-08 — `passenger` authority is a seeded `Role` row, not a code enum

- **Decision**: Migration seeds `roles(slug='passenger', isSystem=true)`; registration assigns it via `UserRole`; `AuthService.appRoleFrom` resolves it through the existing query (slug strings only, same as `'super_admin'`/`'user'` literals today). Social first-login and verify-upgrade issue tokens with `app_role: 'passenger'`.
- **Rationale**: Constitution III — roles are DB rows; string slug literals are the established pattern, not enums. Passengers hold no fleet membership, so fleet authorization (evaluated from `FleetMember`) fails closed for them automatically — they can only reach explicitly passenger-scoped routes.
- **Alternatives considered**: Deriving `app_role` from user shape (`phoneNumber != null ⇒ passenger`) — rejected (role inference in code instead of DB rows). A TS `AppRole` enum — explicitly forbidden by the constitution.

## R-09 — Phone normalization: Egyptian mobile canonical form

- **Decision**: Accept `01XXXXXXXXX` (11 digits), `+20 1XXXXXXXXX`, `0020 1XXXXXXXXX`; normalize to `01XXXXXXXXX` before storage/lookup/rate-keying. Validation regex on DTOs; normalization in one shared helper (`normalizePhone`) unit-tested independently.
- **Rationale**: PRD examples use Egyptian mobile format; canonicalization prevents duplicate accounts (`010...` vs `+2010...`) that would defeat global uniqueness, and keeps throttle keys stable.
- **Alternatives considered**: Full E.164 with multi-country support — rejected (out of scope; the single canonical form covers the PRD; helper is isolated for later extension).

## Resolved status

All Technical Context unknowns resolved — **zero NEEDS CLARIFICATION** carry into Phase 1.

## Follow-up: SMS-provider swap (post-002, tracked 2026-09-08)

When a real SMS provider is chosen, the fixed-code phase ends with this
minimal, lifecycle-preserving change set:

1. Add `code_hash VARCHAR(255)` to `phone_verification_challenges`
   (store an HMAC/SHA-256 of the random 6-digit code with a server secret —
   never the plain code, honoring FR-013).
2. `OtpService.openChallenge` generates a cryptographically random 6-digit
   code, stores only its hash, and hands the plain code to the SMS sender
   exactly once (no logs, no audit, no response).
3. `matchesFixedCode` becomes a hash comparison against the stored
   `code_hash`; `OTP_FIXED_CODE` env and its config plumbing are removed.
4. Keep everything else identical: 5-min lifetime, 60-s cooldown, 5-guess
   lock, single use, budgets, generic errors, and the full red→green test
   suite (unit + `test/passenger-auth.e2e-spec.ts`) must stay green with
   random codes injected via the sender seam.
5. Provider choice criteria: Egyptian-route deliverability, per-message cost,
   delivery-receipt webhooks, and a test sandbox; rate-limit budgets
   (FR-015/FR-016) stay unchanged since SMS cost abuse is already bounded.
