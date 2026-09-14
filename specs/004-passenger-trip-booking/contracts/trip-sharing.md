# API Contracts: Secure Trip Sharing

**Feature**: `004-passenger-trip-booking` | **Base Path**: `/`
**Authentication**: Booking share generation requires `passenger` JWT; verification is public.
**Envelope**: Global success `{ statusCode, data }`; error `{ statusCode, code, message, details?, retryAfter? }`.

---

## 1. Create Trip Share

Generates a secure share link with a 6-digit numeric verification code for an active booking.

- **Endpoint**: `POST /bookings/:id/share`
- **Auth**: Required (`passenger`, must own the booking)

### Response 201 Created
```json
{
  "statusCode": 201,
  "data": {
    "shareId": "7f000001-91ea-13b2-8191-ea1c00000500",
    "verificationCode": "482913",
    "expiresAt": "2026-09-15T14:00:00.000Z"
  }
}
```

#### 404 Not Found (Foreign or nonexistent booking)
```json
{
  "statusCode": 404,
  "code": "BOOKING_NOT_FOUND",
  "message": "Booking not found."
}
```

#### 409 Conflict: Not Shareable
```json
{
  "statusCode": 409,
  "code": "INVALID_SHARE",
  "message": "Trip share can only be created for confirmed active trips."
}
```

---

## 2. Public Verify Trip Share

Unauthenticated verification of a share code, granting read-only vehicle tracking access.

- **Endpoint**: `POST /public/trip-shares/:shareId/verify`
- **Auth**: Public (No credentials required)
- **Rate Limit**: 5 attempts per share per 10 minutes via `throttle_counters` (`share:verify:<shareId>`).

### Request Body
```json
{
  "verificationCode": "482913"
}
```

### Responses

#### 200 OK (Verified)
```json
{
  "statusCode": 200,
  "data": {
    "shareId": "7f000001-91ea-13b2-8191-ea1c00000500",
    "passengerName": "Ahmed Hassan",
    "trip": {
      "id": "7f000001-91ea-13b2-8191-ea1c00000001",
      "origin": "Cairo",
      "destination": "Alexandria",
      "departAt": "2026-09-15T08:00:00.000Z",
      "status": "SCHEDULED",
      "bus": {
        "plateNumber": "ق ب أ 1234"
      }
    },
    "tracking": {
      "provider": "firebase_rtdb",
      "channel": "trips/7f000001-91ea-13b2-8191-ea1c00000001"
    },
    "expiresAt": "2026-09-15T14:00:00.000Z"
  }
}
```

#### 400 Bad Request: Incorrect Verification Code
```json
{
  "statusCode": 400,
  "code": "INVALID_SHARE_CODE",
  "message": "Incorrect verification code."
}
```

#### 410 Gone: Expired or Cancelled
```json
{
  "statusCode": 410,
  "code": "SHARE_EXPIRED",
  "message": "Trip share has expired or the trip is completed."
}
```

#### 429 Too Many Requests: Rate Limited
```json
{
  "statusCode": 429,
  "code": "SHARE_RATE_LIMITED",
  "message": "Too many verification attempts. Please wait before retrying.",
  "retryAfter": 600
}
```
