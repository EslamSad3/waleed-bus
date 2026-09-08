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

Rules:
- `name` update: saved, verification state untouched.
- `phoneNumber` update: normalized; conflict with any account's phone → non-revealing `409 PHONE_UNAVAILABLE` ("Unable to complete this update." — no existence disclosure); on success the new phone is stored with `phoneVerifiedAt = null`, a `PHONE_CHANGE` challenge is opened (subject to send-throttle), all live sessions implicitly drop to `restricted`, audit `phone.change`. Response includes `verificationRequired: true`.
- `picture`: optional URL string (length-capped), saved as-is.

Success `200`:
```json
{ "statusCode": 200, "data": { "id": "uuid", "name": "Ahmed", "phoneNumber": "01000000001", "phoneVerified": false, "picture": null, "verificationRequired": true } }
```

Failures: `400` validation; `409 PHONE_UNAVAILABLE` (non-revealing); `429 OTP_RATE_LIMITED` if the auto-opened challenge hits send-throttle (phone is still updated to unverified; client retries send-otp after `retryAfter`).
