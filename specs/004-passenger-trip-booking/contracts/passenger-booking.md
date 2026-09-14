# API Contracts: Passenger Bookings

**Feature**: `004-passenger-trip-booking` | **Base Path**: `/`
**Authentication**: Bearer JWT (HS256) with `app_role: 'passenger'` and verified phone.
**Envelope**: Global success `{ statusCode, data }`; error `{ statusCode, code, message, details?, retryAfter? }`.

---

## 1. Create Passenger Booking

Reserves one or more seats atomically on a scheduled trip.

- **Endpoint**: `POST /bookings`
- **Auth**: Required (`passenger`, verified phone)
- **Rate Limit**: Standard user mutation budget

### Request Body
```json
{
  "tripId": "7f000001-91ea-13b2-8191-ea1c00000001",
  "seatCount": 2,
  "paymentMethod": "CASH",
  "confirmTimeConflict": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `tripId` | UUID | Yes | Target scheduled trip |
| `seatCount` | Integer | Yes | Number of seats to reserve (\(\ge 1\)) |
| `paymentMethod` | String | Yes | `CASH` or configured wallet (e.g. `VODAFONE_CASH`) |
| `confirmTimeConflict`| Boolean | No | Set to `true` to override a `DUPLICATE_TIME_BOOKING` conflict |

### Responses

#### 201 Created
```json
{
  "statusCode": 201,
  "data": {
    "id": "7f000001-91ea-13b2-8191-ea1c00000010",
    "tripId": "7f000001-91ea-13b2-8191-ea1c00000001",
    "passengerName": "Ahmed Hassan",
    "passengerPhone": "01000000000",
    "seats": 2,
    "status": "CONFIRMED",
    "paymentMethod": "CASH",
    "paymentStatus": "PENDING",
    "totalAmount": "100.00",
    "confirmedAt": "2026-09-14T10:00:00.000Z",
    "trip": {
      "origin": "Cairo",
      "destination": "Alexandria",
      "departAt": "2026-09-15T08:00:00.000Z"
    }
  }
}
```

#### 409 Conflict: Seats Unavailable
```json
{
  "statusCode": 409,
  "code": "SEATS_UNAVAILABLE",
  "message": "Requested seat count exceeds remaining capacity."
}
```

#### 409 Conflict: Duplicate-Time Booking
```json
{
  "statusCode": 409,
  "code": "DUPLICATE_TIME_BOOKING",
  "message": "Unable to complete this booking.",
  "details": {
    "existingBookingId": "7f000001-91ea-13b2-8191-ea1c00000005",
    "existingTripId": "7f000001-91ea-13b2-8191-ea1c00000002"
  }
}
```

---

## 2. List Passenger Bookings

Retrieves personal booking history and upcoming trips with cursor pagination.

- **Endpoint**: `GET /bookings`
- **Auth**: Required (`passenger`)

### Query Parameters
| Parameter | Type | Default | Description |
|---|---|---|---|
| `status` | String | (all) | Filter by `CONFIRMED` or `CANCELLED` |
| `timeFilter` | String | (all) | `upcoming` (departAt > now) or `past` (departAt <= now) |
| `cursor` | UUID | None | Next cursor pagination token |
| `limit` | Integer | 20 | Page size (max 50) |

### Response 200 OK
```json
{
  "statusCode": 200,
  "data": {
    "items": [
      {
        "id": "7f000001-91ea-13b2-8191-ea1c00000010",
        "tripId": "7f000001-91ea-13b2-8191-ea1c00000001",
        "passengerName": "Ahmed Hassan",
        "seats": 2,
        "status": "CONFIRMED",
        "paymentMethod": "CASH",
        "paymentStatus": "PENDING",
        "totalAmount": "100.00",
        "confirmedAt": "2026-09-14T10:00:00.000Z",
        "trip": {
          "id": "7f000001-91ea-13b2-8191-ea1c00000001",
          "origin": "Cairo",
          "destination": "Alexandria",
          "departAt": "2026-09-15T08:00:00.000Z",
          "status": "SCHEDULED"
        }
      }
    ],
    "nextCursor": null
  }
}
```

---

## 3. Get Single Booking

Fetch comprehensive details for an individual booking owned by the passenger.

- **Endpoint**: `GET /bookings/:id`
- **Auth**: Required (`passenger`)

### Response 200 OK
```json
{
  "statusCode": 200,
  "data": {
    "id": "7f000001-91ea-13b2-8191-ea1c00000010",
    "tripId": "7f000001-91ea-13b2-8191-ea1c00000001",
    "passengerName": "Ahmed Hassan",
    "passengerPhone": "01000000000",
    "seats": 2,
    "status": "CONFIRMED",
    "paymentMethod": "CASH",
    "paymentStatus": "PENDING",
    "totalAmount": "100.00",
    "boardedAt": null,
    "droppedAt": null,
    "busRating": null,
    "driverRating": null,
    "trip": {
      "id": "7f000001-91ea-13b2-8191-ea1c00000001",
      "origin": "Cairo",
      "destination": "Alexandria",
      "departAt": "2026-09-15T08:00:00.000Z",
      "status": "SCHEDULED",
      "bus": {
        "plateNumber": "ق ب أ 1234",
        "registrationNumber": "BUS-001"
      }
    }
  }
}
```

#### 404 Not Found (also returned on foreign passenger booking)
```json
{
  "statusCode": 404,
  "code": "BOOKING_NOT_FOUND",
  "message": "Booking not found."
}
```

---

## 4. Cancel Passenger Booking

Cancels an active booking prior to departure and releases seats.

- **Endpoint**: `POST /bookings/:id/cancel`
- **Auth**: Required (`passenger`)

### Request Body
```json
{
  "seatsToCancel": 1,
  "reason": "Change of plans"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `seatsToCancel` | Integer | No | Number of seats to cancel (\(1 \le \text{seatsToCancel} \le \text{seats}\)). Omit to cancel all seats. |
| `reason` | String | No | Optional cancellation reason |

### Responses

#### 200 OK (Partial Cancellation)
When cancelling fewer seats than the total booked (`seatsToCancel < seats`), remaining seats stay confirmed:
```json
{
  "statusCode": 200,
  "data": {
    "id": "7f000001-91ea-13b2-8191-ea1c00000010",
    "status": "CONFIRMED",
    "seats": 1,
    "cancelledSeats": 1,
    "paymentStatus": "REFUND_PENDING",
    "cancelledAt": "2026-09-14T11:00:00.000Z",
    "cancellationReason": "Change of plans"
  }
}
```

#### 200 OK (Full Cancellation)
When cancelling all remaining seats on the booking:
```json
{
  "statusCode": 200,
  "data": {
    "id": "7f000001-91ea-13b2-8191-ea1c00000010",
    "status": "CANCELLED",
    "seats": 0,
    "cancelledSeats": 2,
    "paymentStatus": "REFUND_PENDING",
    "cancelledAt": "2026-09-14T11:00:00.000Z",
    "cancellationReason": "Change of plans"
  }
}
```

#### 409 Conflict: Already Departed
```json
{
  "statusCode": 409,
  "code": "TRIP_ALREADY_STARTED",
  "message": "Trip has already departed."
}
```

#### 409 Conflict: Already Cancelled
```json
{
  "statusCode": 409,
  "code": "BOOKING_ALREADY_CANCELLED",
  "message": "Booking is already cancelled."
}
```

---

## 5. Active Trip & Live Tracking Descriptor

Retrieves current day-of-travel trip context and Firebase Realtime Database channel.

- **Endpoint**: `GET /me/active-trip`
- **Auth**: Required (`passenger`)

### Response 200 OK (Trip Active)
```json
{
  "statusCode": 200,
  "data": {
    "bookingId": "7f000001-91ea-13b2-8191-ea1c00000010",
    "seats": 2,
    "boardingStatus": "NOT_BOARDED",
    "trip": {
      "id": "7f000001-91ea-13b2-8191-ea1c00000001",
      "origin": "Cairo",
      "destination": "Alexandria",
      "departAt": "2026-09-14T12:00:00.000Z",
      "status": "SCHEDULED",
      "bus": {
        "plateNumber": "ق ب أ 1234",
        "capacity": 14
      },
      "driver": {
        "name": "Mohamed Ibrahim",
        "phone": "01100000000",
        "picture": null
      }
    },
    "tracking": {
      "provider": "firebase_rtdb",
      "channel": "trips/7f000001-91ea-13b2-8191-ea1c00000001"
    }
  }
}
```

### Response 200 OK (No Active Trip)
```json
{
  "statusCode": 200,
  "data": null
}
```
