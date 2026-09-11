# Contracts: Error codes (`003-fleet-owner-driver-flows`)

Extends the 002 pattern: HTTP transport keeps `{statusCode, data}` on success; failures are `{statusCode, code, message, details?}` via the shared `AllExceptionsFilter` (extended, not forked). Statuses: 401 auth, 403 membership/permission, 404 cross-fleet or foreign rows (no existence oracle), 409 illegal/conflicting transitions, 422 validation.

## Auth (generic — never disclose existence, role, or account type)

| Code | When |
|---|---|
| `AUTHENTICATION_FAILED` | bad credentials, unknown phone (dummy-hash path), or account-type mismatch for `loginType` |
| `SESSION_EXPIRED` / `INVALID_REFRESH_TOKEN` | existing session errors (unchanged) |
| `ACCOUNT_SUSPENDED` / `ACCOUNT_DISABLED` | existing account-state errors (unchanged) |

## Driver (PRD §26, verbatim)

| Code | When |
|---|---|
| `DRIVER_NOT_ASSIGNED` | no active `bus_assignments` row for caller+bus (reads) |
| `TRIP_ACCESS_DENIED` | trip not on assigned bus / cross-fleet (404) |
| `INVALID_TRIP_STATE` | `complete` from non-DEPARTED; ops on CANCELLED trip |
| `BOOKING_NOT_ON_TRIP` | booking's trip ≠ path trip (404) |
| `INVALID_DROPOFF_STATE` | conflicting re-drop-off; missing station/reason |
| `PAYMENT_NOT_ALLOWED` | unboarded / already-paid / method mismatch / amount tamper |
| `RATING_NOT_ALLOWED` | ineligible trip state, foreign bus/driver, out-of-range, conflicting re-rating |
| `REPORT_NOT_ALLOWED` | foreign/cancelled-trip report, empty/oversize note |

## Fleet Owner (PRD §26, verbatim)

| Code | When |
|---|---|
| `BUS_ACCESS_DENIED` | bus outside owned fleet (404) |
| `RESOURCE_NOT_OWNED` | trip/report/driver outside owned fleet (404) |
| `DRIVER_ASSIGNMENT_NOT_ALLOWED` | target inactive/foreign, double-active conflict, unassign with none active |
| `BUS_ACTION_NOT_ALLOWED` | disable with DEPARTED trip; reactivate already-active |
| `CONFLICTING_ASSIGNMENT` | duplicate `registrationNumber` in fleet; conflicting re-assignment values |

Cross-fleet ids always surface as 404 (`..._NOT_FOUND` / `..._DENIED` with 404 status), never 403, so identifiers cannot be probed.
