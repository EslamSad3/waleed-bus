# Contracts: Profile Status & Update

**Feature**: `002-passenger-auth-flow` | PRD #5 + spec FR-005, FR-017–FR-019, FR-022
**Access**: Bearer token with **restricted or full** scope (these are the routes restricted sessions may call, plus the OTP routes in otp.md). All other authenticated routes require `full` scope, else `403 PROFILE_INCOMPLETE`.

## GET /me/profile-status

Success `200`:
```json
{
  "statusCode": 200,
  "data": { "profileComplete": false, "missingFields": ["phoneNumber"], "phoneVerified": false }
}
```
- `profileComplete` = `name != null && phoneNumber != null && phoneVerifiedAt != null`.
- `missingFields` uses PRD field names (`phoneNumber`, `name`). `phoneVerified` mirrors `phoneVerifiedAt != null`.
- Complete-profile example: `{ "profileComplete": true, "missingFields": [], "phoneVerified": true }`.

## PATCH /me — update name / phone / picture

Request (all fields optional, at least one required):
```json
{ "name": "Ahmed", "phoneNumber": "01000000001", "picture": "https://…" }
```

Success `200` (no pending change):
```json
{
  "statusCode": 200,
  "data": { "profileComplete": true, "missingFields": [], "phoneVerified": true, "pendingPhoneNumber": null, "expiresInSeconds": null }
}
```
- `pendingPhoneNumber` / `expiresInSeconds` (remaining seconds) describe the active phone-change request, if any, so the client can resume verification after a restart.

## PATCH /me — update name / phone / picture

Request (all fields optional, at least one required):
```json
{ "name": "Ahmed", "phoneNumber": "01000000001", "picture": "https://…" }
```

Rules:
- `name` / `picture`: saved, verification state untouched (allowed while a change is pending).
- `phoneNumber` update: normalized; conflict with any account's phone → non-revealing `409 PHONE_UNAVAILABLE` ("Unable to complete this update." — no existence disclosure). On success the verified number is NOT touched: a `PHONE_CHANGE` challenge with a 60-second window is opened for the new number, the session keeps full scope, and the response carries `verificationRequired: true`, `pendingPhoneNumber`, and `expiresInSeconds: 60`. Verifying within the window swaps the number in; expiry drops the request with the verified phone and session intact.
- One pending change at a time: a further `phoneNumber` update while one is active → `429 OTP_RATE_LIMITED` (`details.scope: "phone-change"`, `retryAfter` = remaining window seconds). Phone changes are additionally rate-limited to 3 per user per 10 minutes (`details.scope: "phone-change"`) plus the shared per-phone send budget (`details.scope: "send"`).
- `picture`: optional URL string (length-capped), saved as-is.

Success `200` (phone change):
```json
{ "statusCode": 200, "data": { "id": "uuid", "name": "Ahmed", "phoneNumber": "01000000000", "phoneVerified": true, "picture": null, "verificationRequired": true, "pendingPhoneNumber": "01000000001", "expiresInSeconds": 60 } }
```

Failures: `400` validation; `409 PHONE_UNAVAILABLE` (non-revealing); `429 OTP_RATE_LIMITED` + `retryAfter` — pending window still active, per-user budget exceeded, or the auto-opened challenge hits the send budget / 60s resend cooldown (no phone data is written on throttle rejections; the client retries after `retryAfter`).
