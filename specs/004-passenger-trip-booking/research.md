# Research: Passenger Trip Booking Flow

**Feature**: `004-passenger-trip-booking` | **Date**: 2026-09-14
**Method**: Codebase inspection (`prisma/schema.prisma`, `src/bookings/*`, `src/trips/*`, `src/authorization/*`, `src/common/*`, `test/*`), PRD analysis (`WalledBus_Mobile_Users_Backend_PRD.md`), and Constitution alignment (`.specify/memory/constitution.md`). All clarifications (Q1, Q2, Q3) were resolved with the user.

---

## R-01 — Structured Routes & Stations Data Model

- **Decision**: Introduce three new tables: `routes`, `stations`, and `route_stations` (join table with `stop_order`). `Trip` receives an optional `route_id UUID REFERENCES routes(id)` and a `fare DECIMAL(10,2) DEFAULT 0` column.
- **Rationale**: User clarified Option A: structured routes with ordered stops. This provides transit-network fidelity: trips operate along a recognized Route (e.g. Cairo – Alexandria Express) passing through Stations in sequence (e.g. Stop 1: Ramses, Stop 2: Banha, Stop 3: Sidi Gaber, Stop 4: Mahatet Masr). Each route carries a unique `qr_identifier` (e.g., `qr_route_cai_alx_01`) enabling instant QR code resolution at physical bus stops and vehicle decals. All three tables carry `fleet_id` to strictly satisfy Constitution Principle I.
- **Alternatives considered**:
  - *(a) Flat text arrays on trips* — rejected per user clarification (cannot represent station coordinates, ordered sequences, or route-level QR codes).
  - *(b) Station-to-station matrix pricing inside trip* — rejected as premature complexity (Constitution VI); trips have a trip-level fare per seat.

---

## R-02 — `Booking.passenger_user_id` and Passenger Isolation (OWASP BOLA)

- **Decision**: Add `passenger_user_id UUID REFERENCES users(id)` (nullable for operator/walk-in bookings, populated for passenger app bookings) and indexed (`@@index([passenger_user_id])`). For passenger endpoints (`GET /bookings`, `GET /bookings/:id`, `POST /bookings/:id/cancel`), authorization is enforced per-object by asserting `booking.passengerUserId === actor.id` (with fallback to verified phone match for historical records). Nonexistent bookings and foreign bookings return a uniform 404 `BOOKING_NOT_FOUND`.
- **Rationale**: Passengers are platform customers who travel on microbuses owned by different fleets. A passenger does not hold a `FleetMember` record, so they query their personal bookings across fleets. Adding `passenger_user_id` provides an exact, indexed link between the authenticated identity and the booking, eliminating account enumeration or BOLA (Broken Object Level Authorization) vulnerabilities.
- **Alternatives considered**:
  - *(a) Relying exclusively on string phone matching* — rejected (users can change phone numbers; UUID foreign keys guarantee referential integrity and performance).
  - *(b) Creating a `FleetMember` row for every passenger* — rejected (violates domain boundaries; passengers are customers, not corporate fleet members).

---

## R-03 — Atomic Seat Reservation & Concurrency Protection

- **Decision**: Execute seat reservation inside a PostgreSQL interactive transaction with row-level locking on the `Trip` row:
  ```sql
  SELECT id, fleet_id, bus_id, status, depart_at FROM trips WHERE id = $tripId FOR UPDATE;
  ```
  Followed by an aggregate query of confirmed seats:
  ```sql
  SELECT COALESCE(SUM(seats), 0)::int FROM bookings WHERE trip_id = $tripId AND status = 'CONFIRMED';
  ```
  If `bookedSeats + requestedSeats > busCapacity`, transaction aborts and throws `409 SEATS_UNAVAILABLE`. Otherwise, it inserts the new `Booking` with `status: 'CONFIRMED'`, `passengerUserId: actor.id`, and commits.
- **Rationale**: Under high load (e.g. 20 passengers concurrently booking the last available seat on a bus), application-level checks without database locks suffer from race conditions (read-modify-write hazard), resulting in double-booked seats. Row-level `FOR UPDATE` locking on the specific `Trip` row serializes concurrent booking requests for that trip without locking unrelated trips or the whole table.
- **Alternatives considered**:
  - *(a) Optimistic concurrency with version counter on Trip* — rejected (higher retry churn and abort rate under high contention; pesimistic row lock serializes the critical section cleanly in < 10ms).
  - *(b) Storing `availableSeats` as a denormalized column on Trip* — rejected (susceptible to drift when cancellations or boarding modifications occur; calculating `capacity - sum(confirmed)` within the locked transaction is strictly consistent).

---

## R-04 — Duplicate-Time Booking Overlap Window & Override

- **Decision**: When creating a booking, query whether the passenger already has an active booking (`status = 'CONFIRMED'`) on any trip whose scheduled departure time falls within \(\pm 2\) hours of the target trip's `departAt`. If such a booking exists and `confirmTimeConflict` is false/omitted, throw `409 DUPLICATE_TIME_BOOKING` with details `{ existingBookingId, existingTripId }`. If `confirmTimeConflict === true` is submitted, allow the booking to proceed.
- **Rationale**: Commuters often tap repeatedly when network latency occurs or mistakenly choose an overlapping trip. A 2-hour window represents the operational departure window of a typical regional transit route. Providing the structured details allows the mobile UI to display: *"You already have a trip to Alexandria at 8:00 AM. Do you still want to book this trip at 8:30 AM?"*. The override flag satisfies user decision Q1.
- **Alternatives considered**:
  - *(a) Hard rejection with no override* — rejected per user clarification (passengers frequently buy tickets for family members traveling on concurrent microbuses).
  - *(b) Exact minute match only* — rejected (trips departing 10 minutes apart are physically impossible for the same passenger to take simultaneously, so a 2-hour operational window is realistic).

---

## R-05 — Booking Cancellation Lifecycle & Payment Reconciliation

- **Decision**: Pre-departure cancellation transitions booking status to `CANCELLED`, releases seats back to available capacity immediately, and records `cancelledAt: now()`, `cancelledBy: actor.id`, and `cancellationReason`. For payment status:
  - If `paymentMethod === 'CASH'` -> `paymentStatus: 'CANCELLED'`
  - If `paymentMethod !== 'CASH'` and `paymentStatus === 'PAID'` -> `paymentStatus: 'REFUND_PENDING'`
  - If `paymentStatus === 'UNPAID' | 'PENDING'` -> `paymentStatus: 'CANCELLED'`
  If `trip.departAt <= now()` or `trip.status IN ('DEPARTED', 'COMPLETED')`, cancellation is rejected with `409 TRIP_ALREADY_STARTED`. If already cancelled, rejected with `409 BOOKING_ALREADY_CANCELLED`. If `booking.boardedAt !== null`, rejected with `409 BOOKING_NOT_CANCELLABLE`.
- **Rationale**: Implements user decision Q2. Cash payments require no refund because cash is paid on board; digital payments (Vodafone Cash, etc.) cannot be magically refunded without payment gateway webhooks or manual payouts, so transitioning to `REFUND_PENDING` flags the transaction for administrative processing while instantly releasing the seat inventory.
- **Alternatives considered**:
  - *(a) Instant automated wallet credit* — rejected (wallet ledger integration is out of scope in this phase; `REFUND_PENDING` provides the exact audit trail needed).
  - *(b) Allowing cancellation after departure* — rejected by PRD §20 (seats cannot be re-sold after departure).

---

## R-06 — Active Trip & Real-Time Tracking Integration

- **Decision**: `GET /me/active-trip` returns the passenger's current active booking where `booking.status === 'CONFIRMED'`, `trip.status IN ('SCHEDULED', 'DEPARTED')`, and `trip.departAt` is on the current date (between `now() - 4 hours` and `now() + 12 hours`), ordered by `trip.departAt ASC`. The payload includes:
  - Booking ID, seat count, payment status, boarding status
  - Trip ID, departure time, status, route name
  - Bus plate number, registration number
  - Assigned Driver name, phone number, picture (from active `bus_assignments`)
  - Tracking descriptor: `{ provider: 'firebase_rtdb', channel: 'trips/<tripId>' }`
- **Rationale**: PRD §22 specifies live vehicle tracking via Firebase Realtime Database. The backend does not proxy high-frequency GPS pings; instead, the backend provides the authoritative trip context, driver identity, and Firebase channel reference. The mobile client subscribes directly to Firebase RTDB for vehicle coordinate updates.
- **Alternatives considered**:
  - *(a) Polling backend for GPS coordinates* — rejected (PRD §22 explicitly dictates Firebase RTDB with ~15s driver pings).
  - *(b) WebSocket proxy in NestJS* — rejected (premature infrastructure, violates Constitution VI).

---

## R-07 — Secure Trip Sharing & Rate-Limited Public Verification

- **Decision**: Create a `trip_shares` table (`id`, `booking_id`, `verification_code`, `expires_at`, `revoked_at`).
  - `POST /bookings/:id/share` generates a 6-digit cryptographically secure numeric code and sets `expires_at` to `trip.departAt + 6 hours`.
  - `POST /public/trip-shares/:shareId/verify` allows unauthenticated recipients to submit `{ verificationCode }`.
  - Abuse protection: verification attempts are throttled using the existing `throttle_counters` table (key `share:verify:<shareId>`, max 5 attempts per 10 minutes). Exceeding budget throws `429 SHARE_RATE_LIMITED`.
  - On matching code and unexpired state, returns read-only trip overview, vehicle plate, current status, and the Firebase live tracking channel reference.
- **Rationale**: PRD §23 dictates that recipients need no login. A 6-digit verification code with a 5-guess throttle ensures that an attacker cannot enumerate or brute-force share codes, while legitimate recipients have a seamless experience.
- **Alternatives considered**:
  - *(a) Unguarded public share URLs without codes* — rejected (anyone finding or guessing a link could track a vehicle; the 6-digit code provides two-factor sharing security per PRD).
  - *(b) Requiring recipients to register* — rejected (contradicts PRD §23: "Recipient does not need login").

---

## R-08 — Public QR Route Resolution

- **Decision**: `GET /public/routes/:identifier` accepts either the route's `qr_identifier` or `code` or `id`. It executes without authentication, returning:
  - Route header: id, name, code, origin, destination
  - Ordered stations: array of stops with name, coordinates, address, and stop sequence
  - Upcoming scheduled trips: trips departing in the next 48 hours with departure time, bus plate number, fare, and available seat count (`capacity - confirmedBookings`).
- **Rationale**: Meets PRD §24 requirements. Allows passengers to scan a QR code on a bus stop sign or microbus window to immediately see upcoming buses on that line without logging in. Booking still requires logging in with a verified account.
- **Alternatives considered**:
  - *(a) Separate QR endpoint for each bus* — rejected (bus QR can resolve to the route of its current scheduled trip).

---

## R-09 — Standard Error Codes & Envelope Compliance

- **Decision**: Maintain the global `{ statusCode, data }` success envelope and use `CodedException` for error responses so they render as:
  ```json
  {
    "statusCode": 409,
    "code": "DUPLICATE_TIME_BOOKING",
    "message": "Unable to complete this booking.",
    "details": {
      "existingBookingId": "...",
      "existingTripId": "..."
    }
  }
  ```
  Supported error codes strictly follow PRD §26:
  `TRIP_NOT_FOUND`, `TRIP_NOT_BOOKABLE`, `SEATS_UNAVAILABLE`, `DUPLICATE_TIME_BOOKING`, `BOOKING_NOT_FOUND`, `BOOKING_NOT_CANCELLABLE`, `BOOKING_ALREADY_CANCELLED`, `TRIP_ALREADY_STARTED`, `INVALID_PAYMENT_METHOD`, `INVALID_SHARE`, `SHARE_EXPIRED`, `INVALID_SHARE_CODE`, `SHARE_RATE_LIMITED`, `INVALID_QR`, `ROUTE_NOT_FOUND`.
- **Rationale**: Satisfies both the Constitution VI envelope standard and the PRD §26 mobile client error handling specifications.
