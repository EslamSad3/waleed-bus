# Data Model: Passenger Trip Booking Flow

**Feature**: `004-passenger-trip-booking` | **Date**: 2026-09-14
**Prerequisites**: `specs/004-passenger-trip-booking/research.md`

---

## 1. Entity Relationship Overview

```text
Fleet (1)
  ├── Buses (1..N)
  ├── Routes (1..N)
  │     ├── RouteStations (1..N) ──> Station
  │     └── Trips (0..N)
  │           ├── Bookings (0..N)
  │           │     ├── TripShare (0..1)
  │           │     └── PassengerReport (0..N)
  │           └── BusAssignments (0..N) ──> Driver (User)
  └── Stations (1..N)

User (Passenger)
  └── Bookings (0..N) as passenger_user_id
```

---

## 2. Entity Definitions

### 2.1 Route (`routes`)
Represents a predefined transit line operated by a Fleet between two terminals.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | Primary Key | Route unique identifier |
| `fleet_id` | UUID | Foreign Key -> `fleets(id)` | Owning fleet tenant boundary |
| `name` | VARCHAR(255) | NOT NULL | Human-readable route name (e.g. "Cairo - Alexandria Express") |
| `code` | VARCHAR(50) | NOT NULL | Short route code (e.g. "CAI-ALX-01") |
| `origin` | VARCHAR(255) | NOT NULL | Route origin city/district |
| `destination` | VARCHAR(255) | NOT NULL | Route destination city/district |
| `qr_identifier` | VARCHAR(100) | UNIQUE, NOT NULL | Public scanning code for route stops and buses |
| `is_active` | BOOLEAN | DEFAULT true | Operational status |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Auto-updated | Modification timestamp |

**Indexes & Constraints**:
- `@@unique([fleet_id, code])`
- `@@unique([qr_identifier])`
- `@@index([fleet_id])`

---

### 2.2 Station (`stations`)
Represents a designated physical pick-up or drop-off location.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | Primary Key | Station unique identifier |
| `fleet_id` | UUID | Foreign Key -> `fleets(id)` | Owning fleet tenant boundary |
| `name` | VARCHAR(255) | NOT NULL | Station name (e.g. "Ramses Railway Station") |
| `address` | VARCHAR(500) | NULLABLE | Physical address / landmark description |
| `latitude` | DECIMAL(10, 7) | NULLABLE | WGS-84 Latitude coordinate |
| `longitude` | DECIMAL(10, 7) | NULLABLE | WGS-84 Longitude coordinate |
| `is_active` | BOOLEAN | DEFAULT true | Operational status |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Auto-updated | Modification timestamp |

**Indexes & Constraints**:
- `@@index([fleet_id])`

---

### 2.3 RouteStation (`route_stations`)
Ordered sequence of stops along a specific route.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | Primary Key | Join record identifier |
| `fleet_id` | UUID | Foreign Key -> `fleets(id)` | Owning fleet tenant boundary |
| `route_id` | UUID | Foreign Key -> `routes(id)` ON DELETE CASCADE | Parent route |
| `station_id` | UUID | Foreign Key -> `stations(id)` ON DELETE CASCADE | Associated station |
| `stop_order` | INT | NOT NULL (>= 1) | Sequence index (1 = origin, N = destination) |
| `estimated_stop_minutes`| INT | NULLABLE (>= 0) | Offset in minutes from departure |

**Indexes & Constraints**:
- `@@unique([route_id, stop_order])`
- `@@unique([route_id, station_id])`
- `@@index([fleet_id])`
- `@@index([station_id])`

---

### 2.4 Trip (`trips`) — Schema Extensions
Augmented with route link and seat fare.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `route_id` | UUID | NULLABLE, Foreign Key -> `routes(id)` | Route on which trip operates |
| `fare` | DECIMAL(10, 2)| DEFAULT 0.00 | Authoritative price per seat |

*Existing Trip columns retained*: `id`, `fleet_id`, `bus_id`, `origin`, `destination`, `depart_at`, `status` (`SCHEDULED`, `DEPARTED`, `COMPLETED`, `CANCELLED`), `created_at`, `updated_at`.

---

### 2.5 Booking (`bookings`) — Schema Extensions
Augmented with passenger identity, financial totals, and cancellation audit trail.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `passenger_user_id` | UUID | NULLABLE, Foreign Key -> `users(id)` | Authenticated passenger account |
| `total_amount` | DECIMAL(10, 2)| NULLABLE | Total fare (`seats * trip.fare`) |
| `confirmed_at` | TIMESTAMPTZ | DEFAULT now() | Booking creation timestamp |
| `cancelled_at` | TIMESTAMPTZ | NULLABLE | Pre-departure cancellation timestamp |
| `cancelled_by` | UUID | NULLABLE | User ID of the actor who cancelled |
| `cancellation_reason` | VARCHAR(500) | NULLABLE | Recorded cancellation note |

*Existing Booking columns retained*: `id`, `fleet_id`, `trip_id`, `passenger_name`, `passenger_phone`, `seats`, `status` (`CONFIRMED`, `CANCELLED`), `payment_method`, `payment_status` (`PENDING`, `PAID`, `REFUND_PENDING`, `REFUNDED`, `CANCELLED`), `paid_at`, `boarded_at`, `dropped_at`, ratings (`bus_rating`, `driver_rating`), etc.

**Indexes & Constraints**:
- `@@index([passenger_user_id])`
- `@@index([fleet_id])`
- `@@index([trip_id])`

---

### 2.6 TripShare (`trip_shares`)
Temporary secure link for passenger trip tracking.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | Primary Key | Unique share identifier (`shareId`) |
| `booking_id` | UUID | Foreign Key -> `bookings(id)` ON DELETE CASCADE | Associated passenger booking |
| `verification_code` | VARCHAR(10) | NOT NULL | 6-digit numeric verification code |
| `expires_at` | TIMESTAMPTZ | NOT NULL | Share expiry time (`trip.departAt + 6 hours`) |
| `revoked_at` | TIMESTAMPTZ | NULLABLE | Manual revocation timestamp |
| `view_count` | INT | DEFAULT 0 | Counter of successful verifications |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Auto-updated | Modification timestamp |

**Indexes & Constraints**:
- `@@index([booking_id])`
- `@@index([expires_at])`

---

## 3. State Machines & Transitions

### 3.1 Booking Status State Machine

```text
       [ Passenger Creates Booking ]
                    │
                    ▼
               CONFIRMED ────────────────────────┐
                    │                            │
                    │ [ Passenger Cancels ]      │ [ Driver Boards ]
                    ▼                            ▼
                CANCELLED                     BOARDED
                                                 │
                                                 │ [ Driver Drops Off ]
                                                 ▼
                                             COMPLETED
```

- **Transitions**:
  - `INITIAL` -> `CONFIRMED`: Upon atomic reservation of seats.
  - `CONFIRMED (N seats)` -> `CONFIRMED (N - seatsToCancel)`: Partial cancellation when `seatsToCancel < N`. Released seats return to trip available capacity immediately.
  - `CONFIRMED` -> `CANCELLED`: Full cancellation when all seats are cancelled (`seatsToCancel == N` or omitted). Permitted ONLY if `trip.departAt > now()`, `trip.status === 'SCHEDULED'`, and `booking.boardedAt == null`.
  - `CONFIRMED` -> `BOARDED`: Permitted when driver confirms boarding (`POST /driver/.../board`). Once boarded, cancellation is strictly forbidden.

### 3.2 Payment Status State Machine

```text
       [ Cash Booking Created ]            [ Digital Wallet Booking Created ]
                  │                                         │
                  ▼                                         ▼
            UNPAID / PENDING                           PENDING / PAID
                  │                                         │
       ┌──────────┴──────────┐                   ┌──────────┴──────────┐
       │                     │                   │                     │
 [ Passenger           [ Driver Collects   [ Passenger           [ Trip
   Cancels ]             Cash on Board ]     Cancels ]             Completes ]
       │                     │                   │                     │
       ▼                     ▼                   ▼                     ▼
   CANCELLED                PAID           REFUND_PENDING            PAID
                                                 │
                                                 │ [ Admin / Payout ]
                                                 ▼
                                              REFUNDED
```

### 3.3 Trip Share Status State Machine

```text
     [ POST /bookings/:id/share ]
                  │
                  ▼
                ACTIVE
                  │
       ┌──────────┼───────────────────────┐
       │          │                       │
 [ Trip Ends ]  [ Booking Cancelled ]   [ ExpiresAt Passed / Revoked ]
       │          │                       │
       └──────────┴───────────┬───────────┘
                              ▼
                           EXPIRED
```

---

## 4. Concurrency & Locking Specification

### Atomic Seat Check & Booking Reservation
Executed in a single interactive transaction on `TenantPrismaService`:

```typescript
await tx.$executeRaw`
  SELECT id FROM trips 
  WHERE id = ${tripId}::uuid 
  FOR UPDATE;
`;

const trip = await tx.trip.findUniqueOrThrow({
  where: { id: tripId },
  include: { bus: true },
});

if (trip.status !== 'SCHEDULED' || trip.departAt <= new Date()) {
  throw new CodedException(409, 'TRIP_NOT_BOOKABLE', 'Trip is no longer open for booking.');
}

const bookedAggregate = await tx.booking.aggregate({
  where: { tripId, status: 'CONFIRMED' },
  _sum: { seats: true },
});

const currentBooked = bookedAggregate._sum.seats ?? 0;
const capacity = trip.bus.capacity;

if (currentBooked + requestedSeats > capacity) {
  throw new CodedException(409, 'SEATS_UNAVAILABLE', 'Requested seat count exceeds remaining capacity.');
}

// Seat reservation safe -> insert booking
const booking = await tx.booking.create({
  data: {
    fleetId: trip.fleetId,
    tripId,
    passengerUserId: actor.id,
    passengerName: caller.name,
    passengerPhone: caller.phoneNumber,
    seats: requestedSeats,
    status: 'CONFIRMED',
    paymentMethod,
    paymentStatus: paymentMethod === 'CASH' ? 'PENDING' : 'PENDING',
    totalAmount: Number(trip.fare) * requestedSeats,
  },
});
```
