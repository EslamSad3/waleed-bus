# API Contract: Super Admin Bookings Management

**Base Path**: `/admin/bookings`  
**Security**: Bearer JWT (`app_role: 'super_admin'`)  
**Guard**: `@Platform()`  
**Response Format**: `{ statusCode: number, data: T }`  

---

## 1. List Bookings Across All Fleets

Retrieves a cursor-paginated list of bookings across all fleets with multi-criteria filtering.

- **Method**: `GET`
- **Path**: `/admin/bookings`

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|:---:|---|
| `cursor` | UUID | No | Opaque ID of the last item from previous page |
| `limit` | Integer | No | Page size (default 20, max 100) |
| `fleetId` | UUID | No | Filter by specific fleet |
| `tripId` | UUID | No | Filter by specific scheduled trip |
| `passengerUserId` | UUID | No | Filter by passenger user account ID |
| `passengerPhone` | String | No | Filter by passenger phone number (case-insensitive contains) |
| `passengerName` | String | No | Filter by passenger name (case-insensitive contains) |
| `status` | String | No | `CONFIRMED` \| `CANCELLED` \| `COMPLETED` |
| `paymentStatus` | String | No | `PENDING` \| `PAID` \| `REFUND_PENDING` \| `PARTIALLY_REFUNDED` \| `REFUNDED` \| `FAILED` \| `CANCELLED` |
| `paymentMethod` | String | No | `CASH` \| `VODAFONE_CASH` \| etc. |
| `createdFrom` | ISO8601 | No | Filter bookings created on or after date |
| `createdTo` | ISO8601 | No | Filter bookings created on or before date |
| `departureFrom` | ISO8601 | No | Filter trips departing on or after date |
| `departureTo` | ISO8601 | No | Filter trips departing on or before date |
| `hasReports` | Boolean | No | If `true`, returns only bookings with associated incident reports |

### Response (200 OK)

```json
{
  "statusCode": 200,
  "data": {
    "items": [
      {
        "id": "c7a8e2b1-5f3d-4c8e-9b2a-1f0e8d7c6b5a",
        "fleetId": "f1a2b3c4-d5e6-7f8a-9b0c-1d2e3f4a5b6c",
        "fleetName": "Cairo Metro Express",
        "tripId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
        "passengerName": "Ahmed Hassan",
        "passengerPhone": "01012345678",
        "passengerUserId": "u1a2b3c4-d5e6-7f8a-9b0c-1d2e3f4a5b6c",
        "seats": 2,
        "status": "CONFIRMED",
        "totalAmount": "100.00",
        "refundedAmount": "0.00",
        "paymentMethod": "VODAFONE_CASH",
        "paymentStatus": "PAID",
        "paymentReference": "VF-9021849",
        "boardedAt": "2026-09-14T08:05:00.000Z",
        "dropStatus": "DROPPED_OFF",
        "hasReports": false,
        "tripDepartureTime": "2026-09-14T08:00:00.000Z",
        "originName": "Ramses Station",
        "destinationName": "New Cairo AUC",
        "confirmedAt": "2026-09-14T07:15:00.000Z",
        "createdAt": "2026-09-14T07:15:00.000Z"
      }
    ],
    "nextCursor": "c7a8e2b1-5f3d-4c8e-9b2a-1f0e8d7c6b5a"
  }
}
```

---

## 2. Inspect Single Booking Details

Fetches the complete relational graph for a single booking, including passenger, trip, vehicle, driver, payment details, incident reports, and recent inline audit history.

- **Method**: `GET`
- **Path**: `/admin/bookings/:id`

### Response (200 OK)

```json
{
  "statusCode": 200,
  "data": {
    "id": "c7a8e2b1-5f3d-4c8e-9b2a-1f0e8d7c6b5a",
    "fleetId": "f1a2b3c4-d5e6-7f8a-9b0c-1d2e3f4a5b6c",
    "fleetName": "Cairo Metro Express",
    "status": "CONFIRMED",
    "seats": 2,
    "totalAmount": "100.00",
    "refundedAmount": "0.00",
    "paymentMethod": "VODAFONE_CASH",
    "paymentStatus": "PAID",
    "paymentReference": "VF-9021849",
    "paymentNotes": "Verified via Vodafone Cash merchant wallet",
    "paidAt": "2026-09-14T07:20:00.000Z",
    "paymentMarkedBy": "u0-admin-super",
    "confirmedAt": "2026-09-14T07:15:00.000Z",
    "cancelledAt": null,
    "cancelledBy": null,
    "cancellationReason": null,
    "boardedAt": "2026-09-14T08:05:00.000Z",
    "boardedBy": "u-driver-1",
    "dropStatus": "DROPPED_OFF",
    "dropStationId": "st-auc-gate4",
    "dropReason": null,
    "passenger": {
      "id": "u1a2b3c4-d5e6-7f8a-9b0c-1d2e3f4a5b6c",
      "name": "Ahmed Hassan",
      "phoneNumber": "01012345678",
      "phoneVerifiedAt": "2026-09-10T10:00:00.000Z",
      "picture": "https://cdn.example.com/profiles/ahmed.jpg",
      "nationalId": "29801011234567"
    },
    "trip": {
      "id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "departureTime": "2026-09-14T08:00:00.000Z",
      "originName": "Ramses Station",
      "destinationName": "New Cairo AUC",
      "fare": "50.00",
      "status": "IN_PROGRESS",
      "availableSeats": 12,
      "bus": {
        "id": "b1-bus-id",
        "registrationNumber": "ABC-1234",
        "capacity": 14
      },
      "driver": {
        "id": "d1-driver-id",
        "name": "Mahmoud Driver",
        "phoneNumber": "01123456789"
      }
    },
    "reports": [
      {
        "id": "rep-1",
        "note": "Passenger was late to the pickup point.",
        "status": "RESOLVED",
        "resolutionNote": "Spoke with passenger; reminded of 5-min punctuality rule.",
        "resolvedAt": "2026-09-14T09:00:00.000Z",
        "resolvedBy": "u0-admin-super",
        "createdAt": "2026-09-14T08:10:00.000Z"
      }
    ],
    "ratings": {
      "busRating": 5,
      "driverRating": 4,
      "passengerRating": 5
    },
    "auditTrail": [
      {
        "id": "aud-1",
        "action": "booking.verify_payment",
        "actorUserId": "u0-admin-super",
        "metadata": {
          "paymentMethod": "VODAFONE_CASH",
          "amount": "100.00",
          "reference": "VF-9021849"
        },
        "createdAt": "2026-09-14T07:20:00.000Z"
      }
    ]
  }
}
```

---

## 3. Force Cancel Booking

Administratively cancels a booking with seat release control.

- **Method**: `POST`
- **Path**: `/admin/bookings/:id/cancel`

### Request Body

```json
{
  "reason": "Emergency trip rerouting by transit authority",
  "releaseSeats": true
}
```

### Response (200 OK)

```json
{
  "statusCode": 200,
  "data": {
    "id": "c7a8e2b1-5f3d-4c8e-9b2a-1f0e8d7c6b5a",
    "status": "CANCELLED",
    "cancellationReason": "Emergency trip rerouting by transit authority",
    "cancelledAt": "2026-09-14T07:30:00.000Z",
    "paymentStatus": "REFUND_PENDING",
    "seatsRestored": true
  }
}
```

---

## 4. Reinstate Cancelled Booking

Restores a mistakenly cancelled booking back to `CONFIRMED` status, validating seat inventory.

- **Method**: `POST`
- **Path**: `/admin/bookings/:id/reinstate`

### Request Body

```json
{
  "reason": "Passenger cancellation was requested in error; customer confirmed travel."
}
```

### Response (200 OK)

```json
{
  "statusCode": 200,
  "data": {
    "id": "c7a8e2b1-5f3d-4c8e-9b2a-1f0e8d7c6b5a",
    "status": "CONFIRMED",
    "reinstatedAt": "2026-09-14T07:45:00.000Z"
  }
}
```

### Errors

- `409 Conflict`: `SEATS_UNAVAILABLE` if trip capacity is already fully booked.

---

## 5. Override Operational Driver State

Allows Super Admin to update boarding or drop-off indicators during connectivity failures or dispute investigations.

- **Method**: `PATCH`
- **Path**: `/admin/bookings/:id/operational`

### Request Body

```json
{
  "boarded": true,
  "dropStatus": "DROPPED_OFF",
  "dropStationId": "st-auc-gate4",
  "dropReason": null,
  "justification": "Driver terminal battery died during the second leg of the trip."
}
```

### Response (200 OK)

```json
{
  "statusCode": 200,
  "data": {
    "id": "c7a8e2b1-5f3d-4c8e-9b2a-1f0e8d7c6b5a",
    "boardedAt": "2026-09-14T08:05:00.000Z",
    "dropStatus": "DROPPED_OFF",
    "dropStationId": "st-auc-gate4",
    "updatedAt": "2026-09-14T09:30:00.000Z"
  }
}
```
