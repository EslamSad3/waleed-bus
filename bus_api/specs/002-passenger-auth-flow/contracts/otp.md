# Contracts: Phone Verification (OTP)

**Feature**: `002-passenger-auth-flow` | PRD #4 + spec FR-006–FR-013, FR-016
**Temporary rule (locked)**: the valid code for every active challenge is the fixed `123456` until an SMS provider is chosen. The code NEVER appears in any response, error, log, or audit field.

## POST /auth/phone/send-otp — open (re)send challenge. **Public.**

Request:
```json
{ "phoneNumber": "01000000000" }
```

Success `201`:
```json
{ "statusCode": 201, "data": { "sent": true, "expiresInSeconds": 300 } }
```
- Creates or refreshes the single active challenge for the phone (`expires_at = now + lifetime`, `last_sent_at = now`, fresh 5-guess budget). Lifetime is 5 minutes for `REGISTRATION`/`PROFILE`, 60 seconds for `PHONE_CHANGE` (opened implicitly by `PATCH /me`, which returns its `expiresInSeconds`). Purpose derived from caller context (`REGISTRATION` | `PROFILE` | `PHONE_CHANGE`). Audit `otp.send` (phone only, no code).
- Uniform response regardless of whether the phone is registered (no oracle).

Failures:
- `429 OTP_RATE_LIMITED` + `retryAfter` — resend within 60-s cooldown, or >3 sends per phone per 10 min. No new challenge is created on rejection.
- `400` — malformed phone.

## POST /auth/phone/verify-otp — consume challenge. **Public.**

Request:
```json
{ "phoneNumber": "01000000000", "otp": "123456" }
```

Evaluation order (first match wins): challenge missing → `OTP_INVALID`; consumed already → `OTP_INVALID` (replay); expired (`now > expires_at`) → `OTP_EXPIRED`; attempts ≥ 5 → lock (mark consumed) + `OTP_INVALID`; verify-throttle exceeded (10/challenge/10 min) → `429 OTP_RATE_LIMITED` + `retryAfter`; code mismatch → increment attempts + `OTP_INVALID`; match (`123456`) → success path below. Wrong-code and missing-challenge responses are identical (`404`-class `OTP_INVALID` — code only, no hints).

Success `200`:
```json
{ "statusCode": 200, "data": { "success": true, "phoneVerified": true } }
```
- Atomic transaction (`SELECT … FOR UPDATE` on the challenge row): mark consumed, set `user.phoneNumber` (if changed) + `phoneVerifiedAt = now`, link challenge to user, audit `otp.verify.success`. For `PHONE_CHANGE` this is the moment the pending number swaps in; if another account claimed the number meanwhile, verification fails with non-revealing `409 PHONE_UNAVAILABLE` (challenge consumed, owner keeps the old number). Only one concurrent verify can succeed; losers get `OTP_INVALID`.
- Session effect: the caller's live sessions (restricted or new login) derive `full` scope from `phoneVerifiedAt` on their next request — no re-login required. If the request carries a restricted Bearer token, the response additionally includes a fresh full-scope hint (`profileComplete: true`); token refresh is unnecessary since scope is server-derived.

Error bodies (all generic, code-carrying):
```json
{ "statusCode": 404, "code": "OTP_INVALID", "message": "The verification code is invalid." }
{ "statusCode": 410, "code": "OTP_EXPIRED", "message": "The verification code has expired. Request a new one." }
{ "statusCode": 429, "code": "OTP_RATE_LIMITED", "message": "Too many attempts. Try again later.", "retryAfter": 60 }
```
