# API Contracts: Routes & Station Discovery

**Feature**: `004-passenger-trip-booking` | **Base Path**: `/`
**Authentication**: Public / Optional Bearer JWT
**Envelope**: Global success `{ statusCode, data }`; error `{ statusCode, code, message, details? }`.

---

## 1. Search Scheduled Trips

Search bookable microbus trips by origin, destination, and date with available seat counts.

- **Endpoint**: `GET /trips/search`
- **Auth**: Public / Optional

### Query Parameters
| Parameter | Type | Required | Description |
|---|---|---|---|
| `origin` | String | Yes | Origin city or station (e.g. "Cairo") |
| `destination` | String | Yes | Destination city or station (e.g. "Alexandria") |
| `date` | String (YYYY-MM-DD)| Yes | Scheduled date of departure |
| `cursor` | UUID | No | Cursor pagination |
| `limit` | Integer | No | Page size (default 20, max 50) |

### Response 200 OK
```json
{
  "statusCode": 200,
  "data": {
    "items": [
      {
        "id": "7f000001-91ea-13b2-8191-ea1c00000001",
        "routeId": "7f000001-91ea-13b2-8191-ea1c00000100",
        "routeName": "Cairo - Alexandria Express",
        "origin": "Cairo",
        "destination": "Alexandria",
        "departAt": "2026-09-15T08:00:00.000Z",
        "fare": "50.00",
        "status": "SCHEDULED",
        "capacity": 14,
        "availableSeats": 6,
        "paymentMethods": ["CASH", "VODAFONE_CASH"],
        "bus": {
          "plateNumber": "ق ب أ 1234"
        }
      }
    ],
    "nextCursor": null
  }
}
```

---

## 2. Get Single Trip Details

Retrieve comprehensive information about a scheduled trip, its bus, fare, and station stopping sequence.

- **Endpoint**: `GET /trips/:id`
- **Auth**: Public / Optional

### Response 200 OK
```json
{
  "statusCode": 200,
  "data": {
    "id": "7f000001-91ea-13b2-8191-ea1c00000001",
    "origin": "Cairo",
    "destination": "Alexandria",
    "departAt": "2026-09-15T08:00:00.000Z",
    "fare": "50.00",
    "status": "SCHEDULED",
    "capacity": 14,
    "availableSeats": 6,
    "paymentMethods": ["CASH", "VODAFONE_CASH"],
    "route": {
      "id": "7f000001-91ea-13b2-8191-ea1c00000100",
      "name": "Cairo - Alexandria Express",
      "code": "CAI-ALX-01",
      "stations": [
        {
          "id": "7f000001-91ea-13b2-8191-ea1c00000201",
          "name": "Ramses Station",
          "stopOrder": 1,
          "estimatedStopMinutes": 0
        },
        {
          "id": "7f000001-91ea-13b2-8191-ea1c00000202",
          "name": "Banha Station",
          "stopOrder": 2,
          "estimatedStopMinutes": 45
        },
        {
          "id": "7f000001-91ea-13b2-8191-ea1c00000203",
          "name": "Mahatet Masr (Alexandria)",
          "stopOrder": 3,
          "estimatedStopMinutes": 150
        }
      ]
    },
    "bus": {
      "id": "7f000001-91ea-13b2-8191-ea1c00000301",
      "plateNumber": "ق ب أ 1234",
      "registrationNumber": "BUS-001"
    }
  }
}
```

---

## 3. Public QR Route Resolution

Scan a station sign or bus QR code to view route details, ordered stations, and upcoming scheduled trips with live seat availability.

- **Endpoint**: `GET /public/routes/:identifier`
- **Auth**: Public (No authentication required)
- **Parameters**: `identifier` = `qrIdentifier`, `code`, or route `UUID`.

### Response 200 OK
```json
{
  "statusCode": 200,
  "data": {
    "id": "7f000001-91ea-13b2-8191-ea1c00000100",
    "name": "Cairo - Alexandria Express",
    "code": "CAI-ALX-01",
    "origin": "Cairo",
    "destination": "Alexandria",
    "qrIdentifier": "qr_route_cai_alx_01",
    "stations": [
      {
        "id": "7f000001-91ea-13b2-8191-ea1c00000201",
        "name": "Ramses Station",
        "address": "Ramses Square, Cairo",
        "latitude": 30.0631,
        "longitude": 31.2497,
        "stopOrder": 1,
        "estimatedStopMinutes": 0
      },
      {
        "id": "7f000001-91ea-13b2-8191-ea1c00000202",
        "name": "Banha Station",
        "address": "Banha Transit Hub",
        "latitude": 30.4660,
        "longitude": 31.1853,
        "stopOrder": 2,
        "estimatedStopMinutes": 45
      },
      {
        "id": "7f000001-91ea-13b2-8191-ea1c00000203",
        "name": "Mahatet Masr (Alexandria)",
        "address": "Alexandria Station Square",
        "latitude": 31.1927,
        "longitude": 29.9060,
        "stopOrder": 3,
        "estimatedStopMinutes": 150
      }
    ],
    "upcomingTrips": [
      {
        "id": "7f000001-91ea-13b2-8191-ea1c00000001",
        "departAt": "2026-09-14T14:00:00.000Z",
        "fare": "50.00",
        "capacity": 14,
        "availableSeats": 4,
        "bus": {
          "plateNumber": "ق ب أ 1234"
        }
      }
    ]
  }
}
```

#### 404 Not Found
```json
{
  "statusCode": 404,
  "code": "ROUTE_NOT_FOUND",
  "message": "Route not found for the provided identifier."
}
```
