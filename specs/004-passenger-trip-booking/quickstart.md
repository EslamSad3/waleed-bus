# Quickstart Validation Guide: Passenger Trip Booking Flow

**Feature**: `004-passenger-trip-booking`
**Purpose**: Step-by-step runnable guide to validate the passenger booking flow end-to-end.

---

## 1. Prerequisites & Environment

Ensure the local PostgreSQL database is running with migrations and RLS applied:

```bash
# 1. Start local embedded Postgres (if not running)
pnpm db:up

# 2. Deploy latest migrations
pnpm db:migrate:deploy

# 3. Apply RLS policies & grants
pnpm db:setup-rls

# 4. Seed baseline data (roles, super_admin, test fleet, bus, trips, routes)
pnpm db:seed

# 5. Start development server
pnpm start:dev
```

Server will be running at `http://localhost:3000`.

---

## 2. End-to-End Validation Scenarios

### Scenario 1: Search Trips & Public QR Route Discovery

1. **Public Trip Search**:
   ```bash
   curl -s -X GET "http://localhost:3000/trips/search?origin=Cairo&destination=Alexandria&date=2026-09-15"
   ```
   **Expected Outcome**: 
   - HTTP 200 with `{ statusCode: 200, data: { items: [ ... ], nextCursor: null } }`.
   - Each item includes `id`, `departAt`, `fare`, `capacity`, `availableSeats`.

2. **Public QR Code Scanning**:
   ```bash
   curl -s -X GET "http://localhost:3000/public/routes/qr_route_cai_alx_01"
   ```
   **Expected Outcome**:
   - HTTP 200 with route details, ordered stations (`Ramses`, `Banha`, `Mahatet Masr`), and upcoming scheduled trips with available seat counts.

---

### Scenario 2: Passenger Seat Booking & Concurrency

1. **Obtain Passenger Token**:
   Log in with a verified passenger phone:
   ```bash
   curl -s -X POST "http://localhost:3000/auth/login" \
     -H "Content-Type: application/json" \
     -d '{"loginType": "PASSENGER", "phone": "01000000000", "password": "Password123!"}'
   # Extract accessToken
   ```

2. **Create Booking**:
   ```bash
   curl -s -X POST "http://localhost:3000/bookings" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"tripId": "<TRIP_ID>", "seatCount": 2, "paymentMethod": "CASH"}'
   ```
   **Expected Outcome**:
   - HTTP 201 with `{ statusCode: 201, data: { id, seats: 2, status: "CONFIRMED", paymentStatus: "PENDING" } }`.

3. **Concurrency Boundary Validation**:
   - For a trip with 1 remaining seat, fire two concurrent requests with `seatCount: 1`.
   - Exactly one request must return HTTP 201; the second request must return HTTP 409 with `code: "SEATS_UNAVAILABLE"`.

---

### Scenario 3: Duplicate-Time Booking & Override

1. **Attempt Conflicting Booking**:
   Book another trip departing in the same 2-hour time window:
   ```bash
   curl -s -X POST "http://localhost:3000/bookings" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"tripId": "<CONFLICTING_TRIP_ID>", "seatCount": 1, "paymentMethod": "CASH"}'
   ```
   **Expected Outcome**:
   - HTTP 409 with `code: "DUPLICATE_TIME_BOOKING"` and `details: { existingBookingId, existingTripId }`.

2. **Confirm Conflict Override**:
   Resubmit with `confirmTimeConflict: true`:
   ```bash
   curl -s -X POST "http://localhost:3000/bookings" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"tripId": "<CONFLICTING_TRIP_ID>", "seatCount": 1, "paymentMethod": "CASH", "confirmTimeConflict": true}'
   ```
   **Expected Outcome**:
   - HTTP 201 with confirmed booking.

---

### Scenario 4: Booking Management & Cancellation

1. **List My Bookings**:
   ```bash
   curl -s -X GET "http://localhost:3000/bookings?timeFilter=upcoming" \
     -H "Authorization: Bearer $TOKEN"
   ```
   **Expected Outcome**:
   - Returns array of current passenger's active upcoming bookings. Foreign bookings are invisible.

2. **Cancel Booking**:
   ```bash
   curl -s -X POST "http://localhost:3000/bookings/<BOOKING_ID>/cancel" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"reason": "Change of plans"}'
   ```
   **Expected Outcome**:
   - HTTP 200 with `status: "CANCELLED"`.
   - Trip's available seats increase by the released seat count.

3. **Cancellation Replay & Post-Departure Protection**:
   - Repeat cancellation on the same booking -> HTTP 409 `BOOKING_ALREADY_CANCELLED`.
   - Attempt cancellation after trip departure -> HTTP 409 `TRIP_ALREADY_STARTED`.

---

### Scenario 5: Active Trip & Secure Trip Sharing

1. **Query Active Trip**:
   ```bash
   curl -s -X GET "http://localhost:3000/me/active-trip" \
     -H "Authorization: Bearer $TOKEN"
   ```
   **Expected Outcome**:
   - HTTP 200 with vehicle details, assigned driver contact, and `tracking: { provider: "firebase_rtdb", channel: "trips/<tripId>" }`.

2. **Generate Share Code**:
   ```bash
   curl -s -X POST "http://localhost:3000/bookings/<BOOKING_ID>/share" \
     -H "Authorization: Bearer $TOKEN"
   ```
   **Expected Outcome**:
   - HTTP 201 with `{ shareId, verificationCode, expiresAt }`.

3. **Public Share Verification**:
   ```bash
   curl -s -X POST "http://localhost:3000/public/trip-shares/<SHARE_ID>/verify" \
     -H "Content-Type: application/json" \
     -d '{"verificationCode": "<CODE>"}'
   ```
   **Expected Outcome**:
   - HTTP 200 without authentication, returning read-only trip overview and live tracking channel.
   - Wrong code returns HTTP 400 `INVALID_SHARE_CODE`.
   - Exceeding 5 guesses returns HTTP 429 `SHARE_RATE_LIMITED`.

---

## 3. Automated Test Suites

Run focused automated tests to verify unit and e2e coverage:

```bash
# Unit specs
pnpm vitest run src/bookings/
pnpm vitest run src/trips/

# E2E test suites with real PostgreSQL and RLS
pnpm test:e2e test/passenger-booking.e2e-spec.ts

# Full test suite with coverage gate
pnpm test:cov
```
