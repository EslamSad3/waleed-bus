# Contracts: Registration & Login

**Feature**: `002-passenger-auth-flow` | PRD #3 + spec FR-001–FR-005, FR-013–FR-015, FR-021
**Transport**: JSON, platform envelope (`{statusCode, data}` success; `{statusCode, code, message, details?, retryAfter?}` errors — see errors.md). Authenticated passenger routes use `Authorization: Bearer <accessJwt>`.

## POST /auth/register — passenger phone registration `(P1)`

Registers a phone+password passenger as pending-verification and opens an OTP challenge. **Public.**

Request:
```json
{ "name": "Ahmed", "phoneNumber": "01000000000", "password": "********" }
```
- `name`: 1–255 chars, required. `phoneNumber`: accepted in local/`+20`/`0020` forms, normalized to `01XXXXXXXXX`. `password`: 8–128 chars.

Success `201`:
```json
{ "statusCode": 201, "data": { "verificationRequired": true, "phoneNumber": "01000000000" } }
```
- Side effects: `User` row (pending, `phoneVerifiedAt: null`, `passenger` role assigned), active challenge (5-min expiry), audit `auth.register`. No session is issued.
- **Anti-enumeration**: if the phone is already tied to any account, the response is byte-identical (same 201 body, same timing class); internally no duplicate user is created. A challenge may still be (re)opened so the legitimate owner can proceed — indistinguishable externally.

Failure: `400` validation; `429` `OTP_RATE_LIMITED` on send-throttle (3/phone/10 min) with `retryAfter`.

## POST /auth/login — shared login (passenger variants + legacy)

`loginType` selects the flow. **Public.** Throttled: 5 failures/target phone + 20/source IP per 15 min (`429` + `retryAfter`); failures counted only, successes reset the phone bucket. All failures below return the identical generic error **except** the documented `PHONE_NOT_VERIFIED` case.

### A. Passenger phone + password

Request:
```json
{ "loginType": "PASSENGER", "phone": "01000000000", "password": "********" }
```

Success `201` (verified phone, correct password):
```json
{ "statusCode": 201, "data": { "accessToken": "<hs256>", "refreshToken": "<opaque>" } }
```
- JWT carries `{sub, app_role: "passenger", authVersion, sessionId}` (+ existing `email` claim, null for phone-only users). No role duplicated in body. Audit `auth.login.success`.

Correct credentials but **unverified phone** → `403`:
```json
{ "statusCode": 403, "code": "PHONE_NOT_VERIFIED", "message": "Phone verification is required.", "details": { "phoneNumber": "01000000000" } }
```
- The client routes to the verify flow. This is the sole permitted distinction (spec FR-002/FR-014).

Anything else (unknown phone, wrong password, inactive account, phone bound to a non-passenger account, mismatched type) → `401`:
```json
{ "statusCode": 401, "code": "AUTHENTICATION_FAILED", "message": "Unable to authenticate with the provided credentials." }
```
- Includes dummy-hash verification when no user row exists (no timing oracle). Audit `auth.login.failure` without secrets.

### B. Passenger Google / Apple

Request:
```json
{ "loginType": "PASSENGER", "provider": "GOOGLE", "idToken": "..." }
```
- `provider`: `GOOGLE` | `APPLE`. `idToken` verified against provider JWKS (iss/aud/exp); invalid ⇒ generic `401 AUTHENTICATION_FAILED` (never reveals whether the social account is linked).

Outcomes:
1. **Known link + verified phone** → `201` token pair (full session), audit `auth.login.success`.
2. **Known link + unverified/missing phone** → `201` token pair scoped **restricted** + `verificationRequired` hint (see profile.md); client completes phone flow without re-authenticating.
3. **Unknown provider identity** → new passenger row created (email from verified token claim when present, else null), provider linked (`provider.link` audit), restricted session issued, response as in (2) with `profileComplete: false`.

### C. Legacy platform login (unchanged, backward compat)

Request without `loginType`: `{ "email": "...", "password": "..." }` → behavior identical to current `AuthService.login` (email users, `super_admin`/`user` roles). No contract change; existing tests keep passing.
