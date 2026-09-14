# Feature Specification: Passenger Trip Booking Flow

**Feature Branch**: `004-passenger-trip-booking`

**Created**: 2026-09-14

**Status**: Draft

**Input**: User description: "we need to work on passenger trip booking flow based on @[WalledBus_Mobile_Users_Backend_PRD.md]"

## Clarifications

### Session 2026-09-14

- Q: When a passenger encounters a duplicate-time booking conflict, should they be allowed to override and proceed or must they cancel the existing conflicting booking first? → A: Confirmation override flag (`confirmTimeConflict: true`). The mobile app receives `DUPLICATE_TIME_BOOKING` with existing booking details; if confirmed by the user, re-submitting with the flag allows the second booking to proceed without requiring cancellation of the first.
- Q: How should cancellation refunds or credits be handled for digital/wallet payment methods when cancelled before departure? → A: Mark payment status as `REFUND_PENDING` and log a refund record for operational/administrative review and payout.
- Q: For route and station discovery, how structured should stations and routes be in the data model? → A: Structured Routes & Stations with ordered stops (dedicated `Route` and `Station` entities where trips belong to a route and have ordered station stop sequences; QR codes resolve to the route and its ordered stations with upcoming scheduled trips and live availability).
- Q: Should cancellation of a multi-seat booking cancel the entire booking as an atomic whole, or should passengers be allowed to cancel individual seats partially? → A: Partial seat cancellation supported (passenger specifies how many seats to cancel from the booking via `seatsToCancel`; if all seats are cancelled, status becomes `CANCELLED`; if a subset of seats is cancelled, the booking seat count decreases, released seats return to trip inventory, and partial payment adjustment/refund is initiated).
- Q: What should be the maximum number of seats a passenger can reserve in a single booking? → A: Up to remaining vehicle capacity (no per-booking cap; a passenger may book any number of seats from 1 up to the total remaining available capacity of the vehicle).
- Q: When a passenger searches for trips on a specific date (GET /trips/search?date=YYYY-MM-DD), how should the date filter behave if no trips are scheduled on that exact day? → A: Strict date matching (the query returns only trips departing on the requested calendar date; if no trips exist for that date, it returns an empty list without error, allowing the mobile UI to offer adjacent date suggestions).

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Search Available Trips and View Trip Details (Priority: P1)

A passenger searches for scheduled microbus trips by specifying an origin, destination, and target date. The system returns available scheduled trips showing departure times, estimated arrival/duration, origin and destination points, current available seat count, ticket fare per seat, and supported payment methods. The passenger can select a trip to view comprehensive trip details including bus registration, operating fleet, and station stopping points along the route.

**Why this priority**: Without the ability to discover and inspect scheduled trips, passengers cannot initiate the booking flow. This is the entry point for all passenger operations.

**Independent Test**: Can be fully tested by querying scheduled trips between two valid locations for a specific date and verifying that all bookable trips are returned with accurate available seat counts, pricing, and schedule details.

**Acceptance Scenarios**:

1. **Given** one or more scheduled trips exist between an origin and destination for a chosen date, **When** a passenger searches for trips with those criteria, **Then** the system returns a list of matching bookable trips with departure times, fares, and available seat counts.
2. **Given** a scheduled trip has reached full capacity (0 seats remaining), **When** a passenger views search results, **Then** the trip is indicated as sold out or filtered from bookable results based on the search preference.
3. **Given** a valid trip identifier, **When** a passenger requests detailed information for that trip, **Then** the system returns full schedule details, bus capacity, remaining seats, ordered station stops, and allowable payment methods.
4. **Given** search criteria for which no trips are scheduled, **When** a passenger searches, **Then** the system returns an empty result set with clear guidance rather than an error.

---

### User Story 2 - Book Seats on a Scheduled Trip with Concurrency Protection (Priority: P1)

An authenticated passenger with an active account and verified phone number books one or more seats on a scheduled trip and selects a payment method (e.g., Cash or mobile wallet). The system reserves the seats atomically to guarantee that overbooking never occurs even when multiple passengers attempt to book the final available seats simultaneously. Upon success, the system creates an authoritative confirmed booking record and initializes the corresponding payment state.

**Why this priority**: This is the core transactional journey of the application. Enabling passengers to secure seats reliably without double-booking is essential for business viability.

**Independent Test**: Can be fully tested by submitting a booking request for an available trip with a verified passenger account and verifying that the booking is confirmed, the available seats on the trip decrease by the booked amount, and concurrent requests for the last remaining seat allow exactly one winner.

**Acceptance Scenarios**:

1. **Given** an authenticated passenger with a verified phone number and a scheduled trip with sufficient available seats, **When** the passenger submits a booking request for \(N\) seats and selects a valid payment method (e.g., CASH), **Then** the system atomically reserves \(N\) seats, creates a confirmed booking, sets the payment state to pending/unpaid, and returns the authoritative booking details.
2. **Given** a trip with only 1 seat remaining, **When** two passengers concurrently submit booking requests for 1 seat each, **Then** exactly one request succeeds with a confirmed booking and the other is rejected with a seats unavailable notification (`SEATS_UNAVAILABLE`).
3. **Given** a passenger requesting more seats than remain available on a trip, **When** the booking request is submitted, **Then** the transaction is rejected with `SEATS_UNAVAILABLE` and no seats are deducted.
4. **Given** an unauthenticated user or a passenger whose phone number has not been verified, **When** they attempt to create a booking, **Then** the request is rejected with an authentication or profile-completion requirement error.
5. **Given** an invalid or unsupported payment method, **When** a booking is requested, **Then** the system rejects the booking with `INVALID_PAYMENT_METHOD` and reserves no seats.

---

### User Story 3 - Duplicate-Time Booking Detection and Conflict Handling (Priority: P2)

When a passenger attempts to book a trip whose scheduled time conflicts with an existing active booking they already hold, the system detects the time overlap and returns a structured conflict notification (`DUPLICATE_TIME_BOOKING`) referencing the existing booking and trip identifiers. If the passenger deliberately wants to proceed (e.g., booking for travel companions on a simultaneous trip), re-submitting with `confirmTimeConflict: true` allows the booking to proceed.

**Why this priority**: Passengers frequently tap multiple times or accidentally select overlapping trips. Preventing conflicting bookings protects passengers from accidental charges while offering an intentional confirmation path.

**Independent Test**: Can be fully tested by creating an initial confirmed booking on a trip, then attempting to create a second booking on another trip departing during the same time window, verifying that the system returns the duplicate conflict response with the existing booking details, and that resubmitting with `confirmTimeConflict: true` confirms the second booking.

**Acceptance Scenarios**:

1. **Given** a passenger with an existing active confirmed booking on Trip A, **When** the passenger attempts to book Trip B scheduled during the same departure time window without confirmation, **Then** the system rejects the booking with `DUPLICATE_TIME_BOOKING` and returns the conflicting booking ID and trip ID.
2. **Given** a passenger who received a `DUPLICATE_TIME_BOOKING` conflict, **When** the passenger resubmits the booking request with `confirmTimeConflict: true`, **Then** the booking succeeds and both bookings remain active.
3. **Given** a passenger whose prior conflicting booking was cancelled, **When** the passenger books a new trip at the same scheduled time, **Then** the booking succeeds normally without requiring a conflict confirmation.

---

### User Story 4 - View and Filter Passenger Bookings (Priority: P2)

A passenger views their personal booking history and upcoming trips. The passenger can filter bookings by status (e.g., upcoming, past, confirmed, cancelled) and retrieve detailed information for any specific booking they own. Passengers cannot view bookings belonging to other passengers.

**Why this priority**: Passengers must be able to view their tickets, check departure times, verify seat numbers/counts, and present booking details for boarding.

**Independent Test**: Can be fully tested by retrieving the booking list for a passenger with mixed upcoming and past trips, applying status and date filters, verifying accurate pagination, and asserting that foreign passenger bookings return a not-found response.

**Acceptance Scenarios**:

1. **Given** an authenticated passenger with past and upcoming bookings, **When** the passenger requests their bookings list, **Then** the system returns only bookings belonging to that passenger, ordered chronologically with cursor pagination.
2. **Given** an upcoming filter, **When** the passenger lists bookings, **Then** only active confirmed bookings for future trips are returned.
3. **Given** a specific booking ID belonging to the passenger, **When** the passenger requests details, **Then** the system returns the booking, associated trip, station information, payment status, and boarding state.
4. **Given** a booking ID that does not exist or belongs to another passenger, **When** the passenger requests details, **Then** the system returns a non-revealing not-found response (`BOOKING_NOT_FOUND`).

---

### User Story 5 - Cancel an Active Booking (Full or Partial) Before Departure (Priority: P2)

A passenger cancels an active booking (either all seats or a partial seat count) prior to the scheduled departure of the trip. The system updates the booking seat count (or marks the booking as cancelled if all seats are cancelled), atomically restores the released seat count to the trip's available capacity, records the cancellation timestamp, actor, and cancellation reason, and processes the associated payment adjustment (marking cash as cancelled or digital wallet payments as `REFUND_PENDING`). If the trip has already departed or completed, cancellation is rejected.

**Why this priority**: Plans change; allowing passengers to cancel or adjust seat counts before departure restores seat inventory for other passengers and maintains customer trust.

**Independent Test**: Can be fully tested by booking multiple seats on a future trip, cancelling a subset of seats, confirming that remaining seats stay confirmed while released seats return to available capacity, and verifying that cancelling all remaining seats marks the booking cancelled.

**Acceptance Scenarios**:

1. **Given** a confirmed booking for a future trip that has not yet departed, **When** the passenger requests cancellation without specifying a seat count, **Then** the system updates the booking status to cancelled, atomically releases all reserved seats back to the trip inventory, records the cancellation reason, transitions digital payment state to `REFUND_PENDING` (or cancelled for cash), and confirms full cancellation.
2. **Given** a confirmed booking with multiple seats (e.g. 3 seats), **When** the passenger requests cancellation specifying `seatsToCancel: 1`, **Then** the booking remains confirmed with 2 seats, 1 seat is atomically released back to the trip inventory, and a partial refund record is generated.
3. **Given** a booking on a trip that has already departed or completed, **When** the passenger attempts cancellation, **Then** the system rejects the request with `TRIP_ALREADY_STARTED` or `BOOKING_NOT_CANCELLABLE`.
4. **Given** an already cancelled booking, **When** the passenger requests cancellation again, **Then** the system returns `BOOKING_ALREADY_CANCELLED`.
5. **Given** a foreign booking belonging to another user, **When** a passenger attempts cancellation, **Then** the request returns `BOOKING_NOT_FOUND`.

---

### User Story 6 - Active Trip Status and Real-time Tracking Access (Priority: P3)

An authenticated passenger retrieves their current active trip information (`GET /me/active-trip`). If the passenger holds a confirmed booking for a trip currently scheduled or in transit, the system returns the trip context, bus details, assigned driver name and contact, boarding status, and real-time tracking reference to enable live vehicle position viewing on the mobile map.

**Why this priority**: Provides the real-time day-of-travel experience, allowing passengers to see when their bus is arriving, verify boarding status, and navigate to the pickup point.

**Independent Test**: Can be fully tested by creating a booking on an active/departed trip, querying the active trip endpoint, and verifying that the current trip and tracking details are returned; querying with no active trip returns a clear null/empty state.

**Acceptance Scenarios**:

1. **Given** a passenger with a confirmed booking for a trip scheduled for today or currently in transit, **When** the passenger requests active trip status, **Then** the system returns the active trip, assigned driver and vehicle information, boarding status, and tracking reference.
2. **Given** a passenger with no current or upcoming trip on the current day, **When** the passenger requests active trip status, **Then** the system returns a response indicating no active trip.

---

### User Story 7 - Secure Trip Sharing with Public Verification (Priority: P3)

A passenger with an active booking generates a secure, time-bound shareable tracking link and numeric verification code (`POST /bookings/{bookingId}/share`). The recipient (e.g., family or friends) can verify the share code on a public endpoint without logging in (`POST /public/trip-shares/{shareId}/verify`) and access read-only live trip status and vehicle location. Share access expires automatically when the trip ends, the booking is cancelled, or the expiration deadline passes.

**Why this priority**: Essential safety and convenience feature for passengers, enabling family members to monitor travel progress in real time without creating an account.

**Independent Test**: Can be fully tested by generating a share link for a confirmed booking, verifying the code on the public endpoint without authentication, confirming access to read-only trip tracking details, and verifying that expired or invalid codes are rejected and rate-limited.

**Acceptance Scenarios**:

1. **Given** an active confirmed booking, **When** the passenger requests a trip share, **Then** the system generates a unique share identifier, a numeric verification code, and an expiration timestamp.
2. **Given** a valid share identifier and matching verification code, **When** any user submits them to the public verification endpoint without credentials, **Then** the system grants read-only access to current trip progress and location tracking channel.
3. **Given** an incorrect verification code, **When** submitted to the public endpoint, **Then** the system rejects the request with `INVALID_SHARE_CODE`.
4. **Given** repeated incorrect code guesses on a share identifier, **When** the attempt threshold is exceeded, **Then** the system temporarily rate-limits verification requests with `SHARE_RATE_LIMITED`.
5. **Given** a trip that has completed or a booking that has been cancelled, **When** a recipient attempts to verify or view the share, **Then** the request is rejected with `SHARE_EXPIRED`.

---

### User Story 8 - Public QR Route and Station Resolution (Priority: P3)

A commuter scans a QR code located at a bus station or on a vehicle (`GET /public/routes/{identifier}`). Without logging into an account, the user views route details, origin, destination, ordered stations/stops, and upcoming scheduled trips with live seat availability. To book a seat on any discovered trip, the user is prompted to authenticate.

**Why this priority**: Lowers onboarding friction by letting prospective riders scan physical QR codes at bus stops to immediately see schedules and available buses.

**Independent Test**: Can be fully tested by requesting a public route by its unique QR identifier without authentication headers and verifying that route metadata, ordered stations, and upcoming scheduled trips with live seat availability are returned.

**Acceptance Scenarios**:

1. **Given** a valid route or station QR identifier, **When** a public request is made without authentication, **Then** the system returns the route details, ordered stations, and upcoming scheduled trips with remaining seat counts.
2. **Given** an unrecognized or inactive QR identifier, **When** a public request is made, **Then** the system returns `ROUTE_NOT_FOUND` or `INVALID_QR`.

---

### Edge Cases

- What happens when a passenger attempts to book a trip that is currently departing or has already departed? The request is rejected with `TRIP_NOT_BOOKABLE` or `TRIP_ALREADY_STARTED`.
- What happens when the database loses network connectivity during the atomic reservation? The transaction rolls back cleanly, leaving seat counts and booking state unchanged.
- What happens when a passenger cancels a booking at the exact second a driver marks them boarded? Boarding takes precedence; once boarded, the booking is locked in an active state and cancellation is rejected with `BOOKING_NOT_CANCELLABLE`.
- What happens when two concurrent cancellation requests arrive for the same booking? Exactly one request updates the booking and restores seats; the second request receives `BOOKING_ALREADY_CANCELLED`.
- What happens when a passenger attempts to book zero or negative seats? The request is rejected with a validation error; seat count must be an integer greater than or equal to 1.
- What happens when a passenger attempts to book more seats than the bus's total physical capacity? The request is rejected with `SEATS_UNAVAILABLE`.
- What happens if a passenger specifies `seatsToCancel` greater than the booked seats or less than 1? The request is rejected with a validation error; `seatsToCancel` must be between 1 and the current booking seat count.
- What happens when an unverified passenger submits a booking? The request is rejected with profile completion requirements; phone verification is mandatory before booking.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to search for scheduled trips by origin, destination, and departure date, strictly filtering results to the requested calendar day, returning bookable trips with departure times, available seat counts, fare, and payment options (or an empty list if none match).
- **FR-002**: System MUST require an authenticated passenger account with a verified phone number to create a booking; unauthenticated or unverified requests MUST be rejected.
- **FR-003**: System MUST support booking one or multiple seats (from 1 up to the total remaining available capacity of the vehicle) on a scheduled trip in a single transaction.
- **FR-004**: System MUST validate seat availability and reserve seats atomically within a database transaction to prevent overbooking under high concurrent load.
- **FR-005**: System MUST record the selected payment method (e.g., CASH, mobile wallet) and initialize the payment status (e.g., UNPAID/PENDING) upon booking creation; clients MUST NOT be permitted to declare a payment successful.
- **FR-006**: System MUST detect when a passenger attempts to book a trip whose departure time conflicts with an existing active confirmed booking held by the same passenger, returning a structured `DUPLICATE_TIME_BOOKING` conflict error including the conflicting booking ID and trip ID.
- **FR-007**: System MUST allow a passenger encountering a `DUPLICATE_TIME_BOOKING` conflict to explicitly confirm and override the conflict by resubmitting the booking request with a confirmation flag (`confirmTimeConflict: true`), allowing both bookings to remain active.
- **FR-008**: System MUST allow passengers to list their own bookings with cursor-based pagination and optional filtering by status (upcoming, past, confirmed, cancelled) and date.
- **FR-009**: System MUST allow passengers to retrieve the full details of any individual booking they own; requests for nonexistent bookings or bookings belonging to another passenger MUST return a non-revealing `BOOKING_NOT_FOUND` error.
- **FR-010**: System MUST allow a passenger to cancel an active confirmed booking either in full or partially (by specifying `seatsToCancel`, defaulting to all remaining seats) at any time before the trip departs, updating the booking seat count (or setting status to `CANCELLED` if all seats are cancelled), restoring the cancelled seats back to the trip's available capacity, and recording the cancellation timestamp, reason, actor, and financial adjustment.
- **FR-011**: System MUST reject cancellation requests for bookings whose trip has already departed or completed with `TRIP_ALREADY_STARTED` or `BOOKING_NOT_CANCELLABLE`, and reject repeated cancellation attempts with `BOOKING_ALREADY_CANCELLED`.
- **FR-012**: System MUST transition non-cash/digital payment states to `REFUND_PENDING` upon pre-departure booking cancellation and generate a refund audit record for administrative payout or credit reconciliation.
- **FR-013**: System MUST provide an active trip endpoint (`GET /me/active-trip`) returning the passenger's current in-progress or imminent trip, vehicle details, driver information, boarding status, and live tracking channel reference.
- **FR-014**: System MUST allow a passenger with an active booking to generate a secure share record (`POST /bookings/{bookingId}/share`) returning a unique share ID, a numeric verification code, and an expiration timestamp.
- **FR-015**: System MUST expose a public endpoint (`POST /public/trip-shares/{shareId}/verify`) allowing unauthenticated recipients to verify a share code and view read-only trip status and tracking information.
- **FR-016**: System MUST expire trip shares immediately upon trip completion, booking cancellation, manual revocation, or when the expiration time is reached.
- **FR-017**: System MUST rate-limit verification code guessing attempts on public trip shares to protect against brute-force attacks (`SHARE_RATE_LIMITED`).
- **FR-018**: System MUST expose a public QR resolution endpoint (`GET /public/routes/{identifier}`) returning route metadata, ordered stations, and upcoming scheduled trips without requiring authentication.
- **FR-019**: System MUST represent routes and stations as structured entities where trips belong to routes with an ordered sequence of station stops, and public QR route identifiers resolve to route details and ordered stations with upcoming schedules.
- **FR-020**: System MUST enforce standard error responses conforming to the PRD error contract (`{ success: false, error: { code, message, details } }`) using canonical error codes including `TRIP_NOT_FOUND`, `TRIP_NOT_BOOKABLE`, `SEATS_UNAVAILABLE`, `DUPLICATE_TIME_BOOKING`, `BOOKING_NOT_FOUND`, `BOOKING_NOT_CANCELLABLE`, `BOOKING_ALREADY_CANCELLED`, `TRIP_ALREADY_STARTED`, and `INVALID_PAYMENT_METHOD`.

### Key Entities

- **Route**: Represents a defined transit path between two major points, containing an ordered sequence of station stops. Key attributes include route identifier, operating fleet identifier, route name, route code, origin station, destination station, and QR identifier.
- **Station**: Represents an individual transit stop along a route. Key attributes include station identifier, name, geographic coordinates (latitude, longitude), address, and stop sequence order within the route.
- **Trip**: Represents a scheduled microbus journey operating on a route between origin and destination. Key attributes include trip identifier, fleet identifier, route identifier, bus identifier, scheduled departure time, operational status (SCHEDULED, DEPARTED, COMPLETED, CANCELLED), total capacity, and available seats.
- **Passenger Booking**: Represents a confirmed reservation made by a passenger for one or more seats on a specific trip. Key attributes include booking identifier, fleet identifier, trip identifier, passenger user identifier, passenger contact details, seat count, status (CONFIRMED, CANCELLED), payment method, payment status, boarding state, drop-off state, passenger/driver ratings, cancellation timestamp and reason.
- **Payment Record**: Represents the financial transaction or state associated with a booking. Key attributes include payment method (Cash, Vodafone Cash, etc.), payment status (PENDING, PAID, REFUND_PENDING, REFUNDED), amount, and recorded timestamps.
- **Trip Share**: Represents a temporary, secure sharing grant for a passenger's active trip. Key attributes include share identifier, booking identifier, verification code, expiration timestamp, active status, and access rate limits.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Passengers can complete the trip search, seat selection, and booking creation flow in under 60 seconds on a standard mobile connection.
- **SC-002**: 100% of concurrent booking attempts under maximum contention (e.g., 20 simultaneous requests for the last remaining seat) result in exactly zero overbooked seats, with exactly one successful booking and the remainder cleanly notified of seat unavailability.
- **SC-003**: 100% of cancellation requests made before trip departure successfully restore the exact reserved seat count back to available inventory.
- **SC-004**: 100% of duplicate-time booking attempts return the structured `DUPLICATE_TIME_BOOKING` error with accurate conflicting booking and trip references, and succeed when confirmed with `confirmTimeConflict: true`.
- **SC-005**: 100% of booking list and detail queries enforce strict passenger isolation; no passenger can view or cancel another passenger's booking under any circumstance.
- **SC-006**: Public trip share verification codes withstand brute-force enumeration through rate limiting, locking or throttling after 5 consecutive incorrect code guesses.
- **SC-007**: Public QR route resolution responds with schedule and seat availability data in under 2 seconds.
- **SC-008**: 100% of API error responses conform to the standard structured error envelope and PRD-specified error codes.

## Assumptions

- Authenticated passenger identity and verified phone status are established by the existing passenger authentication subsystem (Spec 002).
- Microbus operational tracking positions are published by driver devices to Firebase Realtime Database; the backend provides the trip context, credentials/channel reference, and verification tokens for mobile clients to subscribe to tracking channels.
- Booking seat counts are whole positive integers (\(\ge 1\)); seat selection within a microbus is by count rather than specific numbered seat assignment unless specified by fleet policy.
- Trips have a fixed capacity determined by the assigned bus capacity; available seats equal total capacity minus the sum of confirmed active booked seats.
- Cash payments are collected in person and confirmed by the driver on board; digital wallet methods record payment reference details, transition to `REFUND_PENDING` on cancellation, and follow business configuration.
- The standard PRD error response format (`{ success: false, error: { code, message, details } }`) is mapped cleanly through the application's global exception filters without disclosing internal database details or cross-tenant information.
