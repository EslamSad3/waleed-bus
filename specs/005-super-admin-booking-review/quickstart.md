# Quickstart Validation Guide: Super Admin Booking Review Flow

**Feature**: `005-super-admin-booking-review`  
**Purpose**: Step-by-step runnable guide to validate Super Admin booking review, payment handling, and status modifications end-to-end.

---

## 1. Prerequisites & Environment

Ensure the local environment has database migrations applied and baseline data seeded:

```bash
# 1. Start local embedded Postgres (if not running)
pnpm db:up

# 2. Deploy latest migrations (runs on DIRECT_URL as owner)
pnpm db:migrate:deploy

# 3. Apply RLS policies & grants
pnpm db:setup-rls

# 4. Seed baseline data (seeds super_admin account)
pnpm db:seed

# 5. Start development server
pnpm start:dev
```

The API will listen at `http://localhost:3000`.

---

## 2. Authentication: Obtain Super Admin Token

Login with the seeded Super Admin credentials:

```bash
SUPER_ADMIN_TOKEN=$(curl -s -X POST "http://localhost:3000/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "superadmin@example.com",
    "password": "superadmin_password_123"
  }' | jq -r '.data.accessToken')
```

Verify token holds `app_role: 'super_admin'`:
```bash
echo $SUPER_ADMIN_TOKEN
```

---

## 3. End-to-End Validation Scenarios

### Scenario 1: Global Booking Retrieval & Filtering

1. **List All Bookings Across Fleets**:
   ```bash
   curl -s -X GET "http://localhost:3000/admin/bookings?limit=10" \
     -H "Authorization: Bearer $SUPER_ADMIN_TOKEN"
   ```
   **Expected Outcome**:
   - HTTP 200 with `{ statusCode: 200, data: { items: [ ... ], nextCursor: "..." } }`.
   - Returns bookings from multiple fleets ordered chronologically.

2. **Filter by Pending Vodafone Cash Bookings**:
   ```bash
   curl -s -X GET "http://localhost:3000/admin/bookings?paymentStatus=PENDING&paymentMethod=VODAFONE_CASH" \
     -H "Authorization: Bearer $SUPER_ADMIN_TOKEN"
   ```
   **Expected Outcome**: Only bookings matching both filters are returned.

3. **Filter by Flagged Incident Bookings**:
   ```bash
   curl -s -X GET "http://localhost:3000/admin/bookings?hasReports=true" \
     -H "Authorization: Bearer $SUPER_ADMIN_TOKEN"
   ```
   **Expected Outcome**: Returns only bookings that have at least one associated `PassengerReport`.

---

### Scenario 2: Single Booking Inspection with Relations & Inline Audit Trail

Inspect detailed context for booking `:id`:

```bash
curl -s -X GET "http://localhost:3000/admin/bookings/BOOKING_UUID" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN"
```

**Expected Outcome**:
- HTTP 200 with full entity hierarchy:
  - `passenger`: Account details (name, phone, verification date, picture, national ID).
  - `trip`: Route, stations, scheduled departure, bus registration, assigned driver.
  - `reports`: Linked driver incident reports.
  - `auditTrail`: Array of up to 20 most recent administrative audit entries.

---

### Scenario 3: Offline Wallet Payment Verification

1. **Verify Exact Fare Payment**:
   ```bash
   curl -s -X POST "http://localhost:3000/admin/bookings/BOOKING_UUID/payment/verify" \
     -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "reference": "VF-9812739",
       "amount": 100.00,
       "paymentMethod": "VODAFONE_CASH",
       "notes": "Verified in Vodafone Cash statement"
     }'
   ```
   **Expected Outcome**: HTTP 200 with `paymentStatus: "PAID"`.

2. **Verify Amount Mismatch Rejection**:
   Submit amount different from booking total (e.g. 80.00 for a 100.00 booking):
   ```bash
   curl -s -X POST "http://localhost:3000/admin/bookings/BOOKING_UUID/payment/verify" \
     -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "reference": "VF-9812739",
       "amount": 80.00
     }'
   ```
   **Expected Outcome**: HTTP 400 with `code: "PAYMENT_AMOUNT_MISMATCH"`.

---

### Scenario 4: Cumulative Refund Processing

1. **Process Partial Refund**:
   ```bash
   curl -s -X POST "http://localhost:3000/admin/bookings/BOOKING_UUID/payment/refund" \
     -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "refundReference": "REF-001",
       "refundAmount": 40.00,
       "reason": "1 seat cancelled by customer support",
       "notes": "Transfer sent via wallet"
     }'
   ```
   **Expected Outcome**: HTTP 200 with `paymentStatus: "PARTIALLY_REFUNDED"`, `refundedAmount: 40.00`, `remainingRefundableBalance: 60.00`.

2. **Process Balance Refund**:
   ```bash
   curl -s -X POST "http://localhost:3000/admin/bookings/BOOKING_UUID/payment/refund" \
     -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "refundReference": "REF-002",
       "refundAmount": 60.00,
       "reason": "Customer cancelled remaining seat",
       "notes": "Balance settled"
     }'
   ```
   **Expected Outcome**: HTTP 200 with `paymentStatus: "REFUNDED"`, `refundedAmount: 100.00`, `remainingRefundableBalance: 0.00`.

---

### Scenario 5: Force Cancellation & Reinstatement

1. **Force Cancel Booking with Seat Release**:
   ```bash
   curl -s -X POST "http://localhost:3000/admin/bookings/BOOKING_UUID/cancel" \
     -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "reason": "Route suspended due to severe weather",
       "releaseSeats": true
     }'
   ```
   **Expected Outcome**: HTTP 200 with `status: "CANCELLED"`, `seatsRestored: true`.

2. **Reinstate Booking**:
   ```bash
   curl -s -X POST "http://localhost:3000/admin/bookings/BOOKING_UUID/reinstate" \
     -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "reason": "Weather cleared; passenger confirmed seat retention"
     }'
   ```
   **Expected Outcome**: HTTP 200 with `status: "CONFIRMED"`. (If trip capacity is 0, returns HTTP 409 `SEATS_UNAVAILABLE`).

---

### Scenario 6: Driver Operational Override & Incident Report Resolution

1. **Override Boarding Status**:
   ```bash
   curl -s -X PATCH "http://localhost:3000/admin/bookings/BOOKING_UUID/operational" \
     -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "boarded": true,
       "dropStatus": "DROPPED_OFF",
       "justification": "Driver device battery depleted"
     }'
   ```
   **Expected Outcome**: HTTP 200 with updated `boardedAt` and `dropStatus`.

2. **Resolve Incident Report**:
   ```bash
   curl -s -X PATCH "http://localhost:3000/admin/bookings/BOOKING_UUID/reports/REPORT_UUID" \
     -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "status": "RESOLVED",
       "resolutionNote": "Customer support issued warning to passenger"
     }'
   ```
   **Expected Outcome**: HTTP 200 with `status: "RESOLVED"`, `resolvedBy`, and `resolvedAt`.

---

## 4. Automated Testing Commands

Run the test suite:

```bash
# Run unit specs
pnpm vitest run src/bookings/admin-bookings.service.spec.ts

# Run E2E suite against embedded PostgreSQL
pnpm vitest run --config ./vitest.config.e2e.ts test/admin-bookings.e2e-spec.ts
```
