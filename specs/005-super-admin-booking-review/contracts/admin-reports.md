# API Contract: Super Admin Incident Report Resolution

**Base Path**: `/admin/bookings/:id/reports/:reportId`  
**Security**: Bearer JWT (`app_role: 'super_admin'`)  
**Guard**: `@Platform()`  
**Response Format**: `{ statusCode: number, data: T }`  

---

## 1. Resolve or Dismiss Driver Incident Report

Updates the administrative status of a `PassengerReport` associated with a booking (Clarification Q3), creating a closed-loop incident resolution.

- **Method**: `PATCH`
- **Path**: `/admin/bookings/:id/reports/:reportId`

### Request Body

```json
{
  "status": "RESOLVED",
  "resolutionNote": "Customer support contacted passenger; resolved fare discrepancy and recorded warning."
}
```

### Validation Rules

- `status`: String, required. Enum: `RESOLVED` | `DISMISSED`.
- `resolutionNote`: String, 5–2000 characters, required.

### Response (200 OK)

```json
{
  "statusCode": 200,
  "data": {
    "id": "rep-1",
    "bookingId": "c7a8e2b1-5f3d-4c8e-9b2a-1f0e8d7c6b5a",
    "driverId": "u-driver-1",
    "passengerId": "u1a2b3c4-d5e6-7f8a-9b0c-1d2e3f4a5b6c",
    "driverNote": "Passenger caused an operational issue during the trip.",
    "status": "RESOLVED",
    "resolutionNote": "Customer support contacted passenger; resolved fare discrepancy and recorded warning.",
    "resolvedBy": "u0-admin-super",
    "resolvedAt": "2026-09-14T09:00:00.000Z",
    "updatedAt": "2026-09-14T09:00:00.000Z"
  }
}
```

### Errors

- `400 Bad Request`: `INVALID_REPORT_STATUS` if status is not `RESOLVED` or `DISMISSED`.
- `404 Not Found`: `REPORT_NOT_FOUND` if report ID does not match the booking.
