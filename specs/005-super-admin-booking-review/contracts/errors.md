# Error Contracts: Super Admin Booking Review Flow

**Feature**: `005-super-admin-booking-review`  
**Conformance**: Aligns PRD §26 Canonical Error Codes with Constitution VI HTTP Envelope.  

---

## 1. Error Response Wire Format

All error responses conform to the standard platform error contract:

```json
{
  "statusCode": 409,
  "code": "SEATS_UNAVAILABLE",
  "message": "Trip has reached full capacity; unable to reinstate booking.",
  "details": {
    "tripId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "availableSeats": 0,
    "requestedSeats": 2
  }
}
```

---

## 2. Canonical Error Code Catalog

| Code | HTTP Status | Trigger Condition |
|---|:---:|---|
| `BOOKING_NOT_FOUND` | 404 | Booking UUID does not exist in any fleet. |
| `BOOKING_ALREADY_CANCELLED` | 409 | Attempting to cancel an already cancelled booking. |
| `BOOKING_NOT_CANCELLED` | 409 | Attempting to reinstate a booking that is currently active or completed. |
| `SEATS_UNAVAILABLE` | 409 | Reinstating a booking when the trip's available capacity is less than the booking's seat count. |
| `PAYMENT_AMOUNT_MISMATCH` | 400 | Offline wallet verification amount does not exactly equal booking `totalAmount`. |
| `PAYMENT_ALREADY_SETTLED` | 409 | Payment is already `PAID` or `REFUNDED` when attempting verification. |
| `REFUND_EXCEEDS_BALANCE` | 400 | Submitted refund amount exceeds remaining unrefunded balance (`totalAmount - refundedAmount`). |
| `REFUND_NOT_ELIGIBLE` | 400 | Attempting electronic refund on an unpaid cash booking. |
| `REPORT_NOT_FOUND` | 404 | Passenger incident report does not exist or does not belong to the target booking. |
| `INVALID_REPORT_STATUS` | 400 | Submitted report resolution status is not `RESOLVED` or `DISMISSED`. |
| `FORBIDDEN_PLATFORM_ACCESS`| 403 | Caller does not hold the verified global `super_admin` role. |
| `JUSTIFICATION_REQUIRED` | 400 | Mandatory administrative reason/justification was omitted or empty. |
