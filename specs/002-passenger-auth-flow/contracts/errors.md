# Contracts: Error Catalog & Envelope Mapping

**Feature**: `002-passenger-auth-flow` | PRD #26 + spec FR-013/FR-014
**Rule**: success envelope stays `{statusCode, data}` (constitution VI). Error envelope is extended once, globally, in `AllExceptionsFilter`: `{statusCode, code, message, details?, retryAfter?}`. No endpoint returns the PRD `{success, error}` shape; `code` carries every PRD error code.

## Catalog (this feature)

| `code` | HTTP | Meaning | `details` / notes |
|---|---|---|---|
| `AUTHENTICATION_FAILED` | 401 | Generic login failure (unknown phone, wrong password, inactive, type mismatch, bad provider token, unlinked social — all identical) | No details. Message: "Unable to authenticate with the provided credentials." |
| `PHONE_NOT_VERIFIED` | 403 | Correct password-credentials on an unverified phone (sole permitted distinction) | `details: { phoneNumber }`. Client routes to verify flow. |
| `PROFILE_INCOMPLETE` | 403 | Restricted session used outside profile/OTP routes | `details: { missingFields[] }`. |
| `OTP_INVALID` | 404 | Wrong code, missing challenge, replay of consumed code, post-lockout guess (all identical) | No details. Chosen 404 so guessing yields no existence signal. |
| `OTP_EXPIRED` | 410 | Challenge past 5-min lifetime | Client requests a new code (cooldown applies). |
| `OTP_RATE_LIMITED` | 429 | Cooldown / send / verify / login throttle exceeded | `retryAfter` seconds; `details: { scope: "resend-cooldown" \| "send" \| "verify" \| "login" }`. |
| `PHONE_UNAVAILABLE` | 409 | New phone conflicts with another account | Message non-revealing: "Unable to complete this update." No details. |
| `VALIDATION_FAILED` | 400 | DTO validation (Nest ValidationPipe mapped via shared factory) | `details: { fields: {…} }` per-field messages. |

## Non-goals

- No `message` may contain a code value, phone-existence hint, role name, or timing-revealing text (verified by the e2e probe set in quickstart.md).
- `retryAfter` is always seconds (integer), present on every `429`.
- Audit/log lines mirror these codes in `action` fields but never include `otp`, tokens, or passwords.
