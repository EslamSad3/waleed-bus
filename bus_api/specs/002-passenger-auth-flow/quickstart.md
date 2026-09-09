# Quickstart: Validate Passenger Auth Flow

**Feature**: `002-passenger-auth-flow` | **Date**: 2026-09-07
Proves the feature end-to-end. TDD order: write the failing specs first, then implement. Details live in [data-model.md](./data-model.md) and [contracts/](./contracts/errors.md) — not duplicated here.

## Prerequisites

- Local PostgreSQL running; `.env` from `.env.example` (never commit secrets).
- `pnpm install`, then:
  ```bash
  pnpm db:generate && pnpm db:migrate:deploy && pnpm db:setup-rls && pnpm db:check-rls
  pnpm start:dev
  ```
- E2E uses `TEST_*_URL` (localhost only): `pnpm test:e2e -- test/passenger-auth.e2e-spec.ts`

## Scenario 1 — Register → verify → full session (spec SC-001/SC-002)

1. `POST /auth/register` `{name, phoneNumber: 01000000000, password}` → `201 verificationRequired: true`.
2. `POST /auth/phone/verify-otp` `{phoneNumber, otp: "123456"}` → `200 phoneVerified: true`.
3. `POST /auth/login` `{loginType: "PASSENGER", phone, password}` → `201` token pair; `GET /me/profile-status` with it → `profileComplete: true`.
4. Expected: end-to-end under 3 min; first-attempt correct code verifies ≥95/100 seeded trials (script in e2e).

## Scenario 2 — Unverified login signal (spec FR-002)

1. Register a second phone, do NOT verify.
2. Login with correct password → `403 PHONE_NOT_VERIFIED`; login with wrong password → `401 AUTHENTICATION_FAILED` (identical to unknown-phone response).
3. Verify, login again → `201`.

## Scenario 3 — Social login → restricted → upgrade (spec SC-004)

1. `POST /auth/login` `{loginType: "PASSENGER", provider: "GOOGLE", idToken}` (e2e mocks JWKS; unit tests stub `ProvidersService`) → `201` restricted token + `profileComplete: false`.
2. Restricted token on a non-profile route → `403 PROFILE_INCOMPLETE`; on `GET /me/profile-status` → `200` with `missingFields: ["phoneNumber"]`.
3. `PATCH /me` `{phoneNumber}` → `verificationRequired: true`; verify `123456` → next request derives `full` scope, no re-login.

## Scenario 4 — Generic-error probe set (spec SC-005/SC-007)

Run the e2e probe matrix and diff response bodies: existing vs nonexistent phones, right vs wrong passwords, driver-typed phone as `PASSENGER`, linked vs unlinked provider tokens — all `401 AUTHENTICATION_FAILED` byte-identical (except the FR-002 case). Assert no response/log contains `123456`, tokens, or passwords.

## Scenario 5 — Throttle & lifecycle budgets (spec SC-006/SC-008)

1. Resend inside 60 s → `429` + `retryAfter`, no new challenge. 6th wrong guess → locked, further guesses `OTP_INVALID`. Expired challenge → `410 OTP_EXPIRED`. Replay consumed code → `OTP_INVALID`.
2. 6 rapid failed logins on one phone → subsequent attempts `429` (phone bucket); 50 rapid wrong-code attempts → ≤5 evaluated, rest rejected.
3. Quality gate before merge: `pnpm lint && pnpm test && pnpm test:cov` (≥80%) `&& pnpm test:e2e` (isolation matrix green).

## Manual smoke (curl)

```bash
BASE=http://localhost:3000
curl -s -X POST $BASE/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Ahmed","phoneNumber":"01000000000","password":"Passw0rd!123"}'
curl -s -X POST $BASE/auth/phone/verify-otp -H 'Content-Type: application/json' \
  -d '{"phoneNumber":"01000000000","otp":"123456"}'
curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"loginType":"PASSENGER","phone":"01000000000","password":"Passw0rd!123"}'
```
