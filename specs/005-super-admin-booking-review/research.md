# Research & Technical Decisions: Super Admin Booking Review Flow

**Feature**: `005-super-admin-booking-review`  
**Date**: 2026-09-14  
**Status**: Completed  

---

## Technical Decisions Summary

### R-01: Global Cross-Fleet Access via `SystemPrismaService` vs Tenant Context Isolation

- **Context**: The existing booking endpoints (`BookingsController`) are scoped to individual fleets (`/fleets/:fleetId/bookings`) and execute under PostgreSQL Row Level Security (`TenantContextService.withFleetContext`). Super Admins, however, need global oversight across all fleets to review booking activity, resolve cross-fleet passenger disputes, and reconcile payments.
- **Decision**: Platform Super Admin booking endpoints will live under `@Platform()` and `@Controller('admin/bookings')`. They will use `SystemPrismaService` (privileged connection bypassing RLS) directly within the platform path.
- **Rationale**: Constitution Principle V and VII explicitly state that platform administration operations are served by the privileged system path (table owner) guarded by `super_admin`. Super Admins do not hold memberships in individual tenant fleets. Using `SystemPrismaService` guarantees unhindered platform-wide visibility while leaving tenant isolation untouched for regular tenant endpoints.
- **Alternatives Considered**:
  - *Injecting a wildcard tenant context*: Rejected because RLS policies require a valid fleet UUID foreign key.
  - *Iterating through each fleet in separate tenant transactions*: Rejected because it prevents global cursor pagination and cross-fleet sorting/filtering.

---

### R-02: Multi-Criteria Search & Filtering with Cursor Pagination

- **Context**: The platform may contain thousands of bookings. Admins need to filter by fleet, trip, passenger name/phone, dates, booking status, payment status, payment method, and flagged incident reports.
- **Decision**: Implement cursor-based pagination using the standard `buildCursorArgs` / `toCursorPage` utility (`items` + `nextCursor`), with Prisma filters mapped from query DTOs (`fleetId`, `tripId`, `passengerUserId`, `passengerPhone`, `passengerName`, `status`, `paymentStatus`, `paymentMethod`, `createdFrom`/`createdTo`, `departureFrom`/`departureTo`, `hasReports`).
- **Rationale**: Constitution Principle VI strictly forbids offset-based pagination. Cursor pagination maintains constant $O(1)$ query performance across arbitrary depths. Filters map directly into Prisma `where` clauses (e.g. `contains` with `mode: 'insensitive'` for name/phone searches; `trip.departureTime` range checks; and `reports: { some: {} }` for `hasReports=true`).
- **Alternatives Considered**:
  - *Offset pagination (`page`/`pageSize`)*: Rejected as explicitly forbidden by Constitution Principle VI.

---

### R-03: Single-Booking Full Hierarchy & Inline Audit Trail Assembly

- **Context**: When inspecting a disputed booking, the Super Admin needs all relevant context: passenger profile, trip/route details, vehicle registration, driver details, payment status, operational boarding/drop-off status, ratings, driver reports, and the history of actions taken on the booking.
- **Decision**: The single booking endpoint (`GET /admin/bookings/:id`) loads the full relation graph via Prisma `include` (`passenger`, `trip` with `route`, `bus`, `driver`, `reports`, `shares`). In parallel, it queries `SystemPrismaService.auditLog` for entries where `resource = 'bookings'` and `resourceId = id`, ordered by `createdAt desc` with a limit of 20, returning the audit events inline under an `auditTrail` property.
- **Rationale**: Verified in Clarification Q5. Combining the core booking hierarchy with recent administrative history gives support and operations staff immediate situational awareness without requiring multiple network roundtrips.
- **Alternatives Considered**:
  - *Returning only booking entity data and requiring separate audit log calls*: Rejected because it degrades admin dashboard usability and complicates dispute investigation.

---

### R-04: Offline Wallet Payment Verification with Strict Exact-Match Rule

- **Context**: Passengers frequently pay via Vodafone Cash, InstaPay, or manual digital wallets where confirmation happens outside automated credit card webhooks. Super Admins verify payments by checking external transaction logs and recording them in the system.
- **Decision**: Provide `POST /admin/bookings/:id/payment/verify` accepting `{ reference: string, amount: number, notes?: string }`. The system strictly validates that `amount === booking.totalAmount`. On match, it sets `paymentStatus = 'PAID'`, `paidAt = now()`, `paymentMarkedBy = actor.id`, and stores the reference and notes.
- **Rationale**: Confirmed in Clarification Q2. In scheduled transportation, a ticket booking is valid only upon full fare settlement. Disallowing partial or mismatched payment amounts prevents operational confusion at boarding time and guarantees accurate revenue accounting.
- **Alternatives Considered**:
  - *Allowing partial payments with a `PARTIALLY_PAID` status*: Rejected to avoid operational complications for bus drivers who would have to calculate cash balances at pickup.

---

### R-05: Refund Processing with Cumulative Balance Tracking

- **Context**: When passengers cancel bookings or trips are disrupted, refunds must be processed. Bookings may have been partially cancelled (e.g. 1 out of 3 seats cancelled per spec 004) or customer service may issue partial credits.
- **Decision**: Provide `POST /admin/bookings/:id/payment/refund` accepting `{ refundReference: string, refundAmount: number, reason: string, notes?: string }`. The system validates that `refundAmount <= (booking.totalAmount - booking.refundedAmount)`. It increments `booking.refundedAmount` by `refundAmount`. If `booking.refundedAmount === booking.totalAmount`, status becomes `REFUNDED`; otherwise it becomes `PARTIALLY_REFUNDED`.
- **Rationale**: Confirmed in Clarification Q1. This provides complete flexibility for full and partial refund tracking, prevents over-refunding beyond the original payment amount, and integrates seamlessly with spec 004's partial seat cancellation.
- **Alternatives Considered**:
  - *Full refunds only*: Rejected because it prevents partial seat refunds and goodwill dispute credits.

---

### R-06: Administrative Force Cancellation & Reinstatement with Atomic Seat Protection

- **Context**: Super Admins may need to force-cancel bookings due to emergency route closures, safety incidents, or passenger misconduct. Conversely, admins may need to reinstate a mistakenly cancelled booking.
- **Decision**:
  - **Force Cancellation** (`POST /admin/bookings/:id/cancel`): Takes `{ reason: string, releaseSeats?: boolean }`. In an interactive transaction with row locking (`SELECT ... FOR UPDATE` on Trip), if `releaseSeats` is `true` (default) and trip has not departed, increments `trip.availableSeats` by `booking.seats`. Marks `booking.status = 'CANCELLED'`. If payment was `PAID`, transitions payment status to `REFUND_PENDING` (for wallet/digital methods) or cancels it (for unpaid cash).
  - **Reinstatement** (`POST /admin/bookings/:id/reinstate`): Takes `{ reason: string }`. In an interactive transaction with row locking on Trip, checks `trip.availableSeats >= booking.seats`. If insufficient, throws `ConflictException('SEATS_UNAVAILABLE')`. Otherwise decrements `trip.availableSeats` by `booking.seats` and sets `booking.status = 'CONFIRMED'`.
- **Rationale**: Confirmed in Clarification Q4. Microbuses have strict legal and physical capacity limits. Strict concurrency locking prevents overbooking race conditions when administrative actions occur simultaneously with passenger mobile bookings.
- **Alternatives Considered**:
  - *Allowing administrative overbooking*: Rejected because physical microbuses cannot safely carry excess standing passengers.

---

### R-07: Driver Operational State Overrides

- **Context**: In real-world microbus transit, driver mobile phones may lose battery or cellular signal, leaving passengers who boarded marked as absent or drop-off unrecorded.
- **Decision**: Provide `PATCH /admin/bookings/:id/operational` accepting `{ boarded?: boolean, dropStatus?: 'DROPPED_OFF' | 'NOT_DROPPED_OFF', dropStationId?: string, dropReason?: string, justification: string }`. The endpoint updates the operational columns, saves `boardedBy = actor.id` if changed, and records the override in the platform audit log.
- **Rationale**: Resolves operational disputes and ensures rating eligibility and journey completion records reflect actual passenger travel.
- **Alternatives Considered**:
  - *Requiring driver app to resubmit*: Rejected because if a trip is already completed or the driver device is lost, historical operational data could never be corrected.

---

### R-08: Closed-Loop Incident Report Resolution Lifecycle

- **Context**: Drivers submit incident reports regarding passenger conduct or fare disputes (`PassengerReport` per PRD §15). Super Admins reviewing bookings need to act on these reports.
- **Decision**: Enhance `PassengerReport` with `status` (`PENDING`, `RESOLVED`, `DISMISSED`), `resolutionNote`, `resolvedAt`, and `resolvedBy`. Provide `PATCH /admin/bookings/:id/reports/:reportId` allowing Super Admins to resolve or dismiss the report with an administrative note.
- **Rationale**: Confirmed in Clarification Q3. Transforms driver incident reporting from a passive log into a closed-loop compliance and safety resolution process.
- **Alternatives Considered**:
  - *Read-only driver notes without resolution status*: Rejected because operations staff cannot track which incidents have been addressed.

---

### R-09: Platform Auditing and Secret Redaction

- **Context**: Privileged Super Admin actions on bookings, payments, and incidents must be auditable to comply with Constitution Principle VII.
- **Decision**: Every administrative mutation (payment verification, refund, status change, cancellation, reinstatement, operational override, report resolution) calls `AuditService.log(...)` with the Super Admin's `actorUserId`, `action`, `resource: 'bookings'`, and sanitized metadata. Inputs are sanitized to ensure no banking tokens, passwords, or sensitive credentials are ever persisted in `audit_logs`.
- **Rationale**: Constitution Principle VII non-negotiable requirement: every privileged mutation must be logged without secrets.
- **Alternatives Considered**:
  - *Relying only on database timestamps*: Rejected because timestamps do not capture the actor, reason, or historical state transition details.
