# Feature Specification: Super Admin Booking Review Flow

**Feature Branch**: `005-super-admin-booking-review`

**Created**: 2026-09-14

**Status**: Draft

**Input**: User description: "now we need to work on super admin booking review flow, super admin can retrieve all bookings can handle payments , change status .. etc based on @[WalledBus_Mobile_Users_Backend_PRD.md]"

## Clarifications

### Session 2026-09-14

- Q: What query parameters and filters should the Super Admin have access to when listing and reviewing bookings across the platform?
  → A: Global multi-criteria filtering: platform Super Admin can filter bookings across all fleets by `fleetId`, `tripId`, `passengerId`, `passengerPhone`, booking `status` (`CONFIRMED`, `CANCELLED`, `COMPLETED`), `paymentStatus` (`PENDING`, `PAID`, `REFUND_PENDING`, `REFUNDED`, `FAILED`, `CANCELLED`), `paymentMethod` (`CASH`, `VODAFONE_CASH`, etc.), date range (`createdFrom`/`createdTo` and `departureFrom`/`departureTo`), and `hasReports: true` (to isolate bookings flagged by driver passenger reports). All listing endpoints use cursor-based pagination.
- Q: What detailed information must be provided when a Super Admin inspects a specific booking?
  → A: Full operational and commercial hierarchy: booking identifiers and seat count, passenger user profile (name, phone, picture, national ID, account verification status), trip details (departure time, origin, destination, scheduled route, ordered stations), vehicle details (bus registration, model, capacity), assigned driver (name, phone, license/national ID), commercial payment record (method, status, amount, transaction reference, paid timestamp, marking actor), driver operational lifecycle (boarded timestamp, drop-off status, drop station, drop reason/note), passenger and driver star ratings, associated passenger incident reports (`PassengerReport`), and the audit trail of previous administrative or system actions.
- Q: How should Super Admin handle offline wallet payments (e.g. Vodafone Cash) and payment confirmations?
  → A: Authoritative verification action: Super Admin can transition a payment from `PENDING` to `PAID` by submitting a payment verification action specifying the external payment reference (e.g. Vodafone Cash transaction ID), the verified amount received, and an optional reconciliation note. The booking's payment state updates atomically and an immutable audit log entry is recorded.
- Q: How should refund processing work when bookings are cancelled or disputed?
  → A: Explicit refund resolution: For bookings with digital wallet or offline electronic payments marked as `REFUND_PENDING` (from passenger cancellation) or when an admin grants a refund on an existing `PAID` booking, the Super Admin executes a refund confirmation action specifying `refundReference`, `refundAmount`, and `refundReason`. The payment status transitions to `REFUNDED` and the action is recorded in the platform audit log.
- Q: What happens to seat capacity when a Super Admin administratively force-cancels a booking?
  → A: Controlled seat restoration: By default (`releaseSeats: true`), cancelling an active booking on a future or currently scheduled trip atomically increments available seats back to the trip inventory. If the trip has already departed or completed, or if the Super Admin explicitly specifies `releaseSeats: false` (e.g., in cases of overbooking corrections or passenger penalties), the booking status changes to `CANCELLED` without modifying trip available capacity. An administrative `reason` is strictly required.
- Q: Can the Super Admin override operational driver states (boarding and drop-off)?
  → A: Yes, operational dispute and correction override: If a driver fails to record boarding or drop-off due to device failure or network issues, or during dispute investigations, the Super Admin can manually update `boardedAt`, `dropStatus` (`DROPPED_OFF`, `NOT_DROPPED_OFF`), `dropStationId`, and `dropReason`, requiring an administrative note and recording the override in the platform audit log.
- Q: How should the system handle refund amounts when a Super Admin processes a refund on a booking?
  → A: Full and partial refunds supported with cumulative balance tracking: Super Admin can specify any refund amount up to the remaining unrefunded booking balance. The system tracks cumulative refunded amount (`refundedAmount`) and sets payment status to `REFUNDED` (when fully refunded) or `PARTIALLY_REFUNDED` (when a partial balance has been refunded).
- Q: When a Super Admin verifies an offline wallet payment (such as Vodafone Cash or InstaPay), how should the system handle situations where the verified amount differs from the booking's total amount?
  → A: Strict exact match: The verified amount submitted by the Super Admin must exactly equal the booking `totalAmount`; any discrepancy is rejected with a validation error.
- Q: When a Super Admin reviews a booking with associated driver incident reports (`PassengerReport`), what workflow actions should be supported on the report records themselves?
  → A: Closed-loop resolution lifecycle: Super Admin can update the report state (`RESOLVED` or `DISMISSED`) with a mandatory administrative resolution note, recording `resolvedBy` and `resolvedAt` in the report record and the platform audit log.
- Q: When a Super Admin attempts to reinstate a previously cancelled booking, how should the system behave if the trip has reached full capacity in the meantime?
  → A: Strict capacity check (fail-safe): The system strictly rejects the reinstatement request with `SEATS_UNAVAILABLE` if the requested seats exceed current available capacity; no overbooking is permitted.
- Q: Should the booking inspection endpoint (`GET /admin/bookings/:id`) include the recent administrative audit trail inline in the response payload?
  → A: Inline audit history: The booking details response includes the most recent administrative audit events (up to 20 events with timestamp, action, actor ID, and sanitized metadata) directly inside the booking details response payload.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Global Booking Retrieval and Multi-Criteria Filtering (Priority: P1)

As a Super Admin reviewing transportation operations, I want to retrieve and search all bookings across all fleets on the platform with flexible filters (fleet, trip, passenger, date, booking status, payment status, and incident flags), so that I can monitor platform-wide booking volume, locate disputed or delayed tickets, and identify bookings requiring manual intervention.

**Why this priority**: Global visibility into bookings is the foundation of platform administration. Without search and retrieval across fleets, no administrative review, customer dispute resolution, or payment verification can occur.

**Independent Test**: Can be fully tested by seeding bookings across multiple fleets with diverse statuses, querying the platform endpoint with various filter combinations (e.g. `paymentStatus=PENDING&paymentMethod=VODAFONE_CASH` or `hasReports=true`), and verifying that only matching records are returned in cursor-paginated envelopes.

**Acceptance Scenarios**:

1. **Given** multiple bookings exist across Fleet A and Fleet B, **When** a Super Admin calls the global bookings retrieval endpoint without fleet restrictions, **Then** bookings from all fleets are returned, ordered by creation date descending with cursor pagination tokens.
2. **Given** bookings with different payment statuses (`PENDING`, `PAID`, `REFUND_PENDING`), **When** a Super Admin filters by `paymentStatus=PENDING` and `paymentMethod=VODAFONE_CASH`, **Then** only pending Vodafone Cash bookings are returned.
3. **Given** bookings flagged with driver passenger incident reports, **When** a Super Admin filters by `hasReports=true`, **Then** only bookings that have at least one associated passenger report are returned.
4. **Given** date range filters `departureFrom` and `departureTo`, **When** a Super Admin queries bookings, **Then** only bookings associated with trips scheduled within the specified departure window are returned.
5. **Given** a non-super-admin user (e.g., a standard passenger or a fleet member), **When** they attempt to access the global bookings endpoint, **Then** access is denied with a `403 Forbidden` response.

---

### User Story 2 - Comprehensive Booking Details Inspection (Priority: P1)

As a Super Admin investigating a customer inquiry, payment issue, or driver report, I want to retrieve complete details for a specific booking—including passenger user details, trip route and timing, bus and driver assignment, payment history, boarding/drop-off status, submitted ratings, and incident reports—so that I have full context to make administrative decisions.

**Why this priority**: Administrative action requires deep context. Customer support and incident resolution depend on seeing the relationship between the passenger, trip, driver, and commercial transactions in a single unified view.

**Independent Test**: Can be fully tested by retrieving a specific booking ID as Super Admin and asserting that the payload contains the complete nested structure (passenger profile, vehicle registration, driver details, payment breakdown, operational timestamps, ratings, and incident reports).

**Acceptance Scenarios**:

1. **Given** a valid booking ID across any fleet, **When** a Super Admin requests the booking details, **Then** the response includes booking status, seat count, fare, passenger identity (name, phone, picture, user ID), trip schedule (departure, origin, destination, route stations), bus (plate/registration), assigned driver (name, phone), payment status and method, operational status (boarded/dropped-off timestamps), ratings, driver reports, and recent administrative audit events (up to 20 most recent entries with timestamp, action, actor ID, and metadata).
2. **Given** a booking that has associated passenger incident reports filed by the trip driver, **When** the Super Admin inspects the booking, **Then** the report details (driver note, creation timestamp) are included in the response payload.
3. **Given** a nonexistent booking ID, **When** the Super Admin requests details, **Then** the system returns a standard `404 Not Found` error.
4. **Given** a caller without the global `super_admin` role, **When** they request booking inspection through the platform administration endpoint, **Then** the system rejects the request with `403 Forbidden`.

---

### User Story 3 - Payment Verification and Reconciliation for Offline/Wallet Payments (Priority: P1)

As a Super Admin managing commercial collections, I want to verify manual and offline digital wallet payments (such as Vodafone Cash or Instapay transfers) by entering the external transaction reference and confirming receipt of funds, so that pending bookings are marked as paid and commercial revenue is reconciled.

**Why this priority**: Offline digital wallets (e.g. Vodafone Cash) cannot automatically confirm payment without manual administrative or webhook reconciliation. Enabling Super Admin to verify and mark payments as `PAID` is critical to confirm travel eligibility.

**Independent Test**: Can be fully tested by submitting a payment verification request for a booking in `PENDING` payment status with transaction reference `VF-109283` and amount `50.00`, verifying that the booking payment status transitions to `PAID`, `paidAt` is populated, and an audit log entry records the verification.

**Acceptance Scenarios**:

1. **Given** a booking with payment status `PENDING` and payment method `VODAFONE_CASH`, **When** the Super Admin submits a payment verification action with `reference: "VF-98172"` and matching `amount`, **Then** the payment status transitions to `PAID`, `paidAt` is set to the current timestamp, `paymentMarkedBy` is set to the Super Admin user ID, and the transaction is recorded in the platform audit log.
2. **Given** a booking whose payment is already marked `PAID`, **When** a Super Admin attempts to verify payment again without an override flag, **Then** the system returns a conflict error indicating the booking is already paid.
3. **Given** a payment verification request where the submitted verified amount does not exactly equal the booking `totalAmount` (e.g. 40.00 submitted for a 50.00 booking), **When** submitted, **Then** the request is rejected with validation error `400 Bad Request` requiring exact fare match.
4. **Given** a payment verification request with an invalid or zero amount, **When** submitted, **Then** the request is rejected with validation error `400 Bad Request`.
5. **Given** an unverified or fraudulent transfer, **When** the Super Admin marks the payment as `FAILED` with a mandatory reason, **Then** the payment status transitions to `FAILED` and an audit entry is generated.

---

### User Story 4 - Refund Processing for Cancelled or Disputed Bookings (Priority: P2)

As a Super Admin handling customer service and financial settlements, I want to review bookings with `REFUND_PENDING` status (or approve administrative refunds on `PAID` bookings) and record full or partial refund completion with external transfer references and balance tracking, so that passenger refunds are properly accounted for without overpaying.

**Why this priority**: When trips or bookings are cancelled, passengers who paid via digital wallets or bank transfers require refunds. Super Admins must track and mark refunds as fulfilled (full or partial) to prevent duplicate payouts and ensure financial integrity.

**Independent Test**: Can be fully tested by taking a cancelled booking in `REFUND_PENDING` payment status with total amount 100.00, submitting a partial refund of 40.00, verifying status becomes `PARTIALLY_REFUNDED` with `refundedAmount: 40.00`, then submitting a remaining refund of 60.00, verifying status becomes `REFUNDED` with `refundedAmount: 100.00` and an audit entry is created.

**Acceptance Scenarios**:

1. **Given** a booking in `REFUND_PENDING` payment status with an unrefunded balance, **When** a Super Admin submits a refund completion request with `refundReference`, `refundAmount` equal to the remaining balance, and optional `notes`, **Then** the payment status transitions to `REFUNDED`, cumulative `refundedAmount` equals total amount, and an audit log entry is recorded.
2. **Given** a booking with total amount 100.00, **When** a Super Admin processes a partial refund of 30.00, **Then** `refundedAmount` becomes 30.00, the payment status transitions to `PARTIALLY_REFUNDED`, and the remaining refundable balance is 70.00.
3. **Given** an active `PAID` booking where a passenger experienced service failure, **When** a Super Admin grants an administrative refund with a mandatory explanation, **Then** the refund is processed and the payment status transitions to `REFUNDED` or `PARTIALLY_REFUNDED`.
4. **Given** a booking whose payment method was `CASH` and unpaid, **When** a Super Admin attempts to process an electronic refund, **Then** the system rejects the request with an error stating cash bookings without payment are not eligible for electronic refunds.
5. **Given** a refund amount that exceeds the remaining unrefunded balance (`totalAmount - refundedAmount`), **When** submitted, **Then** the system rejects the request with a validation error indicating the refund exceeds the remaining chargeable balance.

---

### User Story 5 - Administrative Booking Status Modification and Force Cancellation (Priority: P2)

As a Super Admin resolving operational conflicts, safety concerns, or customer support escalations, I want to administratively modify booking statuses (e.g., force-cancel a booking with seat release control, confirm a mistakenly cancelled booking, or mark a completed booking), so that platform records reflect real-world events.

**Why this priority**: Operational disruptions (bad weather, vehicle breakdown, customer emergency, fraudulent reservations) require an administrator with global authority to cancel or adjust bookings without being constrained by regular passenger cancellation time windows.

**Independent Test**: Can be fully tested by force-cancelling a confirmed booking on an upcoming trip, verifying that the booking status changes to `CANCELLED`, trip available seats are incremented by the booking seat count, the cancellation reason is stored, and an audit log entry is created.

**Acceptance Scenarios**:

1. **Given** a confirmed booking on an upcoming trip, **When** a Super Admin force-cancels the booking with `reason: "Trip rerouted by authority"` and `releaseSeats: true` (or omitted default), **Then** the booking status becomes `CANCELLED`, the cancellation reason and actor are saved, the trip available seats increase by the booking's seat count, and an audit log entry is written.
2. **Given** a confirmed booking on an upcoming trip, **When** a Super Admin force-cancels with `releaseSeats: false`, **Then** the booking status becomes `CANCELLED`, but the trip available capacity remains unchanged.
3. **Given** a trip that has already departed or completed, **When** a Super Admin force-cancels a booking, **Then** the booking status transitions to `CANCELLED`, but no seats are restored to the past trip.
4. **Given** an administrative cancellation request with an empty cancellation reason, **When** submitted, **Then** the system rejects the request with `400 Bad Request` (reasons are mandatory for administrative overrides).
5. **Given** a booking mistakenly cancelled, **When** a Super Admin reinstates the booking and the trip has sufficient available seats, **Then** the booking status returns to `CONFIRMED`, seats are re-deducted from the trip, and the action is audited.
6. **Given** a cancelled booking on a trip that has reached full capacity (0 available seats), **When** a Super Admin attempts to reinstate the booking, **Then** the request is rejected with `SEATS_UNAVAILABLE` and no seats are deducted.

---

### User Story 6 - Driver Operational Status Administrative Override (Priority: P3)

As a Super Admin resolving passenger disputes or handling driver connectivity failures, I want to manually update operational lifecycle indicators (boarding status and station drop-off status) on a booking, so that records accurately reflect whether the passenger actually traveled.

**Why this priority**: In real-world microbus operations, mobile phones run out of battery or lose cellular signal, leaving passengers marked as unboarded even when they completed the ride. Administrative override ensures accurate data for disputes and driver ratings.

**Independent Test**: Can be fully tested by submitting an operational override updating `boardedAt` and `dropStatus: "DROPPED_OFF"` for a booking whose driver was unable to record boarding, verifying the booking reflects the new state and an audit log entry captures the override reason.

**Acceptance Scenarios**:

1. **Given** a confirmed booking where the passenger boarded the microbus but the driver app was offline, **When** the Super Admin submits an operational override with `boarded: true` and an administrative note, **Then** `boardedAt` is set to the current timestamp, `boardedBy` records the Super Admin ID, and an audit record is created.
2. **Given** an active booking, **When** the Super Admin overrides drop-off with `dropStatus: "DROPPED_OFF"`, `dropStationId: "st-1"`, and an administrative note, **Then** the drop-off status and timestamp are updated accordingly.
3. **Given** an operational override without a justification note, **When** submitted, **Then** the system rejects the request with a validation error.
4. **Given** a booking with a pending driver incident report (`PassengerReport`), **When** the Super Admin reviews the incident and submits a resolution action with `status: "RESOLVED"`, `resolutionNote: "Passenger contacted and warned; fare settled"`, **Then** the report status transitions to `RESOLVED`, `resolvedBy` and `resolvedAt` are saved, and an audit log entry is recorded.

---

### Edge Cases

- **Concurrent Status Mutations**: When a Super Admin force-cancels a booking at the exact instant a passenger attempts self-service cancellation or a driver marks the passenger as boarded, the database transaction locks the booking row and ensures only one transition succeeds without data corruption.
- **Seat Release Boundary**: When cancelling a booking where seats were already previously released or partially cancelled, the system calculates exact remaining booked seats to ensure the trip available seat counter never exceeds vehicle physical capacity.
- **Cross-Fleet Access**: Super Admin endpoints operate on the privileged system path (`SystemPrismaService`) and can read or mutate bookings across all fleets without requiring individual fleet membership, while standard tenant endpoints remain isolated by PostgreSQL RLS.
- **Audit Secret Redaction**: Administrative actions involving financial notes or reference IDs must sanitize inputs to guarantee that no card numbers, PINs, or security credentials leak into the `audit_logs` metadata table.
- **Zero-Seat Bookings**: If a booking's seat count is corrupted or zero, administrative actions gracefully handle seat calculations without negative counter increments.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a platform administration endpoint to list bookings across all fleets, accessible only to authenticated users with the global `super_admin` role.
- **FR-002**: System MUST support cursor-based pagination on the global booking list endpoint, returning items and an opaque `nextCursor`.
- **FR-003**: System MUST support filtering the global booking list by:
  - `fleetId`: Filter bookings belonging to a specific fleet.
  - `tripId`: Filter bookings belonging to a specific trip.
  - `passengerUserId`: Filter bookings created by a specific user account.
  - `passengerPhone`: Case-insensitive partial or exact match on passenger phone number.
  - `passengerName`: Case-insensitive partial match on passenger name.
  - `status`: Filter by booking status (`CONFIRMED`, `CANCELLED`, `COMPLETED`).
  - `paymentStatus`: Filter by payment status (`PENDING`, `PAID`, `REFUND_PENDING`, `PARTIALLY_REFUNDED`, `REFUNDED`, `FAILED`, `CANCELLED`).
  - `paymentMethod`: Filter by payment method (`CASH`, `VODAFONE_CASH`, or configured wallet methods).
  - `createdFrom` and `createdTo`: Filter by booking creation timestamp range.
  - `departureFrom` and `departureTo`: Filter by associated trip scheduled departure timestamp range.
  - `hasReports`: Boolean flag to retrieve only bookings with associated driver passenger incident reports.
- **FR-004**: System MUST provide a platform endpoint to inspect a single booking by ID with full entity associations: passenger account, trip, route, scheduled stations, bus, assigned driver, payment state, operational status, passenger & driver ratings, associated incident reports, and recent administrative audit events (up to 20 most recent entries with timestamp, action, actor ID, and metadata) returned inline.
- **FR-005**: System MUST allow a Super Admin to update payment status for any booking:
  - Transition from `PENDING` to `PAID` with external transaction reference, received amount (which MUST strictly equal booking `totalAmount`), and reconciliation notes; any discrepancy between submitted amount and booking `totalAmount` MUST be rejected with a validation error.
  - Transition from `PENDING` to `FAILED` or `CANCELLED` with a mandatory reason.
  - Transition from `REFUND_PENDING`, `PAID`, or `PARTIALLY_REFUNDED` to `REFUNDED` (when remaining refundable balance reaches 0) or `PARTIALLY_REFUNDED` (when a partial balance is refunded) with refund reference, refund amount, and mandatory reason.
- **FR-006**: System MUST track cumulative `refundedAmount` on the booking and validate that any submitted refund amount does not exceed the remaining unrefunded balance (`totalAmount - refundedAmount`).
- **FR-007**: System MUST allow a Super Admin to force-cancel any booking with a mandatory administrative reason.
- **FR-008**: When a Super Admin force-cancels a booking, the system MUST support an optional `releaseSeats` parameter (default `true` for future trips):
  - If `true` and the trip has not departed, reserved seats MUST be atomically restored to the trip's available capacity.
  - If `false` or if the trip has already departed, trip capacity MUST remain unchanged.
- **FR-009**: System MUST allow a Super Admin to reinstate a mistakenly cancelled booking, strictly verifying that sufficient available capacity remains on the trip before re-confirming and deducting seats atomically; if available capacity is less than the booking's seat count, the reinstatement request MUST be rejected with `SEATS_UNAVAILABLE`.
- **FR-010**: System MUST allow a Super Admin to override operational driver status (marking `boardedAt`, `dropStatus`, `dropStationId`, and `dropReason`) with a mandatory administrative justification note.
- **FR-011**: System MUST record every administrative booking mutation (payment verification, refund, status modification, force-cancellation, operational override) in the platform `audit_logs` table via `AuditService`, capturing the actor user ID, target resource ID, action name, and sanitized metadata without sensitive secrets.
- **FR-012**: System MUST reject any booking administrative action initiated by an actor without the global `super_admin` role with a `403 Forbidden` response.
- **FR-013**: System MUST execute administrative mutations within database transactions to guarantee atomicity of status updates, seat inventory calculations, and audit log generation.
- **FR-014**: System MUST format all successful administrative API responses in the standard `{ statusCode, data }` response envelope and all error responses according to the standard platform error contract.
- **FR-015**: System MUST allow a Super Admin to update the status of a `PassengerReport` associated with a booking to `RESOLVED` or `DISMISSED`, requiring a mandatory administrative `resolutionNote` and recording `resolvedAt` and `resolvedBy` in the report record and the platform audit log.

### Key Entities *(include if feature involves data)*

- **Booking**: The primary reservation record linking passenger, trip, and fleet. Attributes include `id`, `fleetId`, `tripId`, `passengerUserId`, `passengerName`, `passengerPhone`, `seats`, `status` (`CONFIRMED`, `CANCELLED`, `COMPLETED`), `totalAmount`, `refundedAmount`, `paymentMethod`, `paymentStatus` (`PENDING`, `PAID`, `REFUND_PENDING`, `PARTIALLY_REFUNDED`, `REFUNDED`, `FAILED`, `CANCELLED`), `paidAt`, `paymentMarkedBy`, `boardedAt`, `boardedBy`, `dropStatus`, `dropStationId`, `dropReason`, `cancelledAt`, `cancelledBy`, `cancellationReason`.
- **Payment Transaction / Details**: Commercial transaction metadata associated with the booking. Key attributes include transaction `reference`, `amount`, `method`, `status`, `refundReference`, `refundAmount`, `refundedAmount`, `notes`, `verifiedAt`, `verifiedBy`.
- **PassengerReport**: Incident report filed by a driver regarding a passenger on a specific trip booking. Attributes include `id`, `tripId`, `bookingId`, `passengerId`, `driverId`, `note`, `status` (`PENDING`, `RESOLVED`, `DISMISSED`), `resolutionNote`, `resolvedAt`, `resolvedBy`, `createdAt`, `updatedAt`.
- **Trip**: The scheduled journey containing route, vehicle, driver, departure time, capacity, and current available seat count.
- **AuditLog**: Immutable platform administration audit record containing `actorUserId`, `action`, `resource`, `resourceId`, `metadata`, `success`, `createdAt`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Super Admin can search and filter through 10,000+ bookings across all fleets with responses returned in under 1 second.
- **SC-002**: 100% of administrative mutations (status changes, payment updates, refunds, cancellations) generate an auditable record in the platform audit log.
- **SC-003**: Concurrency safety: Zero instances of seat inventory overbooking or undercounting when administrative cancellations or reinstatements occur concurrently with passenger bookings.
- **SC-004**: Security isolation: 100% of requests to platform booking administration endpoints from non-super-admin accounts are rejected with `403 Forbidden`.
- **SC-005**: Error contract consistency: 100% of failure responses adhere to the standard structured error format without exposing internal database errors or unhandled exceptions.

---

## Assumptions

- **Administrative Role**: Only users holding the verified global `super_admin` role can access the endpoints defined in this specification. Fleet owners and drivers manage bookings only through their respective fleet-scoped or driver-assigned endpoints.
- **Platform Path Usage**: All endpoints in this feature reside under the platform administration path (e.g. `/admin/bookings`) and utilize the privileged `SystemPrismaService` connection rather than RLS-restricted tenant connections, allowing global visibility across all fleets.
- **Payment Methods**: In this phase, supported payment methods include `CASH`, `VODAFONE_CASH`, and manual digital wallet methods. Automated payment gateway webhooks (e.g. Stripe/Paymob) may be integrated in future specifications and will share the same payment state lifecycle established here.
- **Seat Release Rules**: Cancelling a booking on a departed or completed trip does not release seats back to the trip inventory because the vehicle has already left the station.
- **Driver Passenger Reports**: Driver reports (`PassengerReport` created via PRD §15) are linked to bookings and surfaced in this review flow for Super Admin compliance and safety evaluation.
