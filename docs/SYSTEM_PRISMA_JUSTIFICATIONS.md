# SystemPrismaService Justifications & Boundary Invariants

This document formalizes the architectural boundary between the two database paths in the Waleed Bus platform (`app_tenant` via RLS vs `table owner` via `SystemPrismaService`) and provides explicit justifications for every direct usage of `SystemPrismaService`.

---

## 1. The Two-Path Architectural Invariant

The platform enforces database access through two distinct database connections:

```
                      HTTP Request
                           │
                    Global Guard Chain
            (JwtAuthGuard → TenantContextGuard → PermissionGuard)
                           │
                       Controller
                           │
                   Application Service
                           │
                    FleetPathService
                     /          \
                    /            \
          Tenant Path           System Path
      (TenantPrismaService)  (SystemPrismaService)
               │                     │
      PostgreSQL RLS          PostgreSQL Owner
     (app_tenant role)      (DIRECT_URL connection)
```

1. **Tenant Path (`TenantPrismaService`)**:
   - Connection string: `DATABASE_URL` (role `app_tenant`).
   - Permissions: `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`.
   - Context: Transaction-local `set_config('app.user_id', ..., true)` and `set_config('app.fleet_id', ..., true)`.
   - Security: Enforced by PostgreSQL Row-Level Security (RLS) policies and `app.is_fleet_member()` security-definer helper.
   - Fails **closed** if configuration parameters are missing or invalid.

2. **System Path (`SystemPrismaService`)**:
   - Connection string: `DIRECT_URL` (table owner).
   - Permissions: Superuser / table owner privileges, bypasses RLS.
   - Guarded exclusively by application-level authorization (`@Platform()` decorator, `super_admin` claim check, and audit logging).

`FleetPathService.run()` is the **canonical gate** for fleet operations:
- If `membershipId !== null`: routes through `TenantContextService` with RLS.
- If `membershipId === null`: permits `SystemPrismaService` **only** if the caller has the `super_admin` role; otherwise throws `403 ForbiddenException`.

---

## 2. Catalog of Legitimate SystemPrismaService Usages

Any direct injection or usage of `SystemPrismaService` outside of `FleetPathService` must be documented and justified below:

### 1. Authentication & Credentials (`auth.service.ts`, `passenger-auth/passenger.service.ts`)
- **Operations**: `login()`, `loginDriver()`, `rotateRefreshToken()`, OTP challenge generation, social login token verification.
- **Justification**: Credential verification inherently precedes tenant context. The caller does not yet possess a verified JWT or tenant membership. Looking up users by email/phone to verify password hashes (`argon2`) must query the global user catalog.
- **Defense-in-depth**: Timing-safe dummy hashing for non-existent users; strict failure counting on login attempts via `throttle_counters`.

### 2. Platform Admin Bookings (`admin-bookings/` sub-services)
- **Operations**:
  - `AdminBookingsQueryService.findAll()` & `.findOne()`
  - `AdminPaymentService.verifyPayment()`, `.failPayment()`, `.processRefund()`
  - `AdminBookingLifecycleService.forceCancel()`, `.reinstate()`, `.overrideOperational()`
  - `AdminReportService.resolveReport()`
- **Justification**: Platform administrators (`super_admin`) have operational oversight across all fleets. Admin endpoints are decorated with `@Platform()`, which `PermissionGuard` restricts strictly to active `super_admin` users.
- **Defense-in-depth**: Every mutation logs to the immutable audit trail with actor details, timestamps, and state deltas.

### 3. Passenger Self-Service Bookings (`passenger-booking.service.ts`)
- **Operations**: `createPassengerBooking()`, `findPassengerBookings()`, `findPassengerBookingById()`, `cancelPassengerBooking()`, `findActivePassengerTrip()`.
- **Justification**: Passengers are platform consumers whose bookings cross multiple independent bus fleets. Because PostgreSQL tenant RLS restricts queries to a single `app.fleet_id`, querying a passenger's bookings across different operators via the tenant path would return zero rows.
- **Defense-in-depth (OWASP BOLA Protection)**:
  - Caller must possess a verified phone number (`phoneVerifiedAt !== null`).
  - Read and cancel operations strictly enforce `passengerUserId === actor.id`. Foreign bookings return a uniform `404 BOOKING_NOT_FOUND` (no existence oracle).
  - Seat reservations acquire an interactive PostgreSQL row lock (`FOR UPDATE OF t`) on the target trip.

### 4. Passenger Trip Ratings (`passenger-rating.service.ts`)
- **Operations**: `rateByPassenger()`.
- **Justification**: Similar to passenger bookings, passengers submitting trip ratings do not hold membership in the bus operator's fleet.
- **Defense-in-depth**:
  - Ownership is validated by matching the passenger's verified phone number against `booking.passengerPhone`. Mismatches return `404 BOOKING_NOT_FOUND`.
  - Only `COMPLETED` trips may be rated. Convergent update semantics ensure idempotent retries without rating manipulation.

### 5. Driver Fleet Card Read-Only Display (`driver-ops.service.ts`)
- **Operations**: `fleetCard()`.
- **Justification**: Drivers operate under tenant RLS context. Because the `users` table RLS policy restricts visibility strictly to `id = app.user_id` (self-only), a driver cannot read the fleet owner's name through the tenant path.
- **Defense-in-depth**: The fleet record itself is first loaded via the tenant RLS path (verifying driver membership in the fleet). Only after the fleet is verified, the owner's display name is enriched read-only via `this.system.user.findUnique({ select: { name: true } })`.

### 6. Platform Audit Trail (`audit.service.ts`)
- **Operations**: `AuditService.log()`, `AuditService.findMany()`.
- **Justification**: The audit trail records security, governance, and observability events across all tenants. Writing via the system path ensures audit records cannot be tampered with or suppressed by tenant-level RLS restrictions. Reading audit logs is restricted to platform administration.
