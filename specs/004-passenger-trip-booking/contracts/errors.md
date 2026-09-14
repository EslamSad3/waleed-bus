# Error Contracts: Passenger Booking Error Catalog

**Feature**: `004-passenger-trip-booking`
**Conformance**: Aligns PRD §26 Canonical Error Codes with Constitution VI HTTP Envelope.

---

## 1. Error Response Wire Format

All error responses from passenger booking endpoints conform to the following schema:

```json
{
  "statusCode": 409,
  "code": "DUPLICATE_TIME_BOOKING",
  "message": "Unable to complete this booking.",
  "details": {
    "existingBookingId": "7f000001-91ea-13b2-8191-ea1c00000005",
    "existingTripId": "7f000001-91ea-13b2-8191-ea1c00000002"
  },
  "retryAfter": 60
}
```

| Field | Type | Presence | Description |
|---|---|---|---|
| `statusCode` | Integer | Always | HTTP status code (400, 401, 403, 404, 409, 410, 429) |
| `code` | String | Always | Stable machine-readable PRD error code |
| `message` | String | Always | User-friendly English explanation |
| `details` | Object | Optional | Structured contextual payload (e.g. conflicting booking/trip IDs) |
| `retryAfter` | Integer | On 429 | Cooldown in seconds before retry is accepted |

---

## 2. Canonical Error Code Catalog

| Code | HTTP Status | Trigger Condition |
|---|---|---|
| `TRIP_NOT_FOUND` | 404 | Trip UUID does not exist or has been deleted |
| `TRIP_NOT_BOOKABLE` | 409 | Trip is not in `SCHEDULED` status or departure time is in the past |
| `SEATS_UNAVAILABLE` | 409 | Requested seat count exceeds remaining bus capacity under concurrent reservation |
| `DUPLICATE_TIME_BOOKING`| 409 | Passenger already holds an active booking departing in the overlapping time window (\(\pm 2\) hours) |
| `BOOKING_NOT_FOUND` | 404 | Booking ID does not exist, or belongs to another passenger (OWASP BOLA) |
| `BOOKING_NOT_CANCELLABLE`| 409 | Passenger attempts cancellation after being marked boarded |
| `BOOKING_ALREADY_CANCELLED`| 409 | Passenger attempts to cancel an already cancelled booking |
| `TRIP_ALREADY_STARTED` | 409 | Passenger attempts cancellation on a trip that has departed or completed |
| `INVALID_PAYMENT_METHOD` | 400 | Payment method is not supported (e.g. unsupported wallet) |
| `ROUTE_NOT_FOUND` | 404 | Route QR code, code, or UUID is not recognized |
| `INVALID_QR` | 404 | QR payload cannot be parsed or resolved |
| `INVALID_SHARE` | 404 | Share ID does not exist or booking is not in an active state |
| `SHARE_EXPIRED` | 410 | Share time expired (`expiresAt < now`) or trip has completed |
| `INVALID_SHARE_CODE` | 400 | Submitted verification code does not match the share record |
| `SHARE_RATE_LIMITED` | 429 | Guess limit exceeded (5 failed verification attempts per share per 10 min) |

---

## 3. Generic Failure Policy (Anti-Enumeration)

In accordance with PRD §3.2 and Constitution I/VII:
- Querying another passenger's booking details or cancellation returns `404 BOOKING_NOT_FOUND`, never `403 FORBIDDEN` (prevents attackers from discovering whether arbitrary UUIDs exist or belong to other passengers).
- Public trip share verification failure returns `400 INVALID_SHARE_CODE` without revealing the expected code format or length.
