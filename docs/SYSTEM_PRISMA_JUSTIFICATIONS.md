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
- **Operational & Durability Semantics**: Audit logging is explicitly designed as non-blocking, non-transactional observability and governance logging. Audit writes occur over an independent database connection outside the business mutation transactions so that audit persistence failures never roll back user business transactions or compromise platform availability.

### 7. Global Trip-Line Catalog (`routes/trip-lines.service.ts`, `routes/routes.service.ts`, `routes/geography.service.ts`)
- **Operations**: Stop (station) CRUD, governorate listing, markaz/locality dictionary CRUD, trip-line (Line) CRUD, direction stop replacement, public stop/route resolution.
- **Justification**: The commercial catalog — `governorates`, `markazes`, `localities`, `stations`, `lines`, `routes`, `route_stations` — is platform-global reference data with no `fleet_id` column. Row-Level Security policies are fleet-scoped by design, so these tables are invisible to (and unguarded by) the tenant path. All mutating endpoints are `@Platform()`-guarded and require explicit `stations.*` / `routes.*` permissions; every mutation is audit-logged. Public read paths (`GET /public/routes/*`) expose only the generic catalog, never fleet data.

### 8. Bus → Trip-Line Assignment Validation (`fleet-owner/bus-trip-line.service.ts`)
- **Operations**: `assign()`, `unassign()`.
- **Justification**: A fleet owner or super admin binds one of their buses to a commercial trip line. Buses are fleet-scoped and updated strictly inside `FleetPathService.run()` (tenant RLS path), but the target `lines` row is global catalog data that the tenant connection cannot see. The system path is used only for a read-only existence/`isActive` check of the trip line before the fleet-scoped mutation; a missing or inactive line fails closed with `409 TRIP_LINE_NOT_AVAILABLE`. The assignment itself is audit-logged.

### 10. Vehicle Brand Dictionary (`buses/vehicle-brand.service.ts`)
- **Operations**: Brand list/create/update, active-brand validation for bus assignment.
- **Justification**: `vehicle_brands` is platform-global catalog data with no `fleet_id` column (same trust level as §7). All endpoints are `@Platform()`-guarded with `buses.*` permissions; mutations are audit-logged. Bus assignment validation is a read-only existence/`isActive` check before the fleet-scoped bus mutation.

### 11. Passenger Discovery + VIP Tiers (`fleet-owner/discovery.service.ts`, `fleet-owner/vip-tier.service.ts`)
- **Operations**: Public fleet-owner search (name/geography match, VIP-ordered, cursor-paginated), public per-fleet active-bus listing with driver enrichment, VIP tier CRUD.
- **Justification**: Discovery serves passengers who hold no fleet membership, so the fleet-member-scoped tenant path cannot serve it; the directory (`fleets`, `users`) and catalog (`stations`, `localities`, `markazes`, `governorates`, `vip_tiers`, `vehicle_brands`) rows are read-only projections that expose no seats, payments, or secrets. Writes (tier CRUD, fleet assignment) are `@Platform()`-guarded with `fleets.*` permissions and audit-logged.

### 12. Passenger Favorites (`favorites/favorites.service.ts`)
- **Operations**: Fleet/bus favorite CRUD scoped to the authenticated passenger.
- **Justification**: Same family as §3 — passengers hold no fleet membership, so the fleet-member-scoped tenant path cannot serve user-owned cross-fleet data. Defense in depth: verified-phone gate, all queries scoped to `actor.id`, foreign ids uniformly 404 (no oracle), plus a database-level `owner_favorites` self-access RLS policy on `public.favorites`.

### 9. Platform Fleet-Owner Administration (`fleet-owner/fleet-owners-admin.service.ts`)
- **Operations**: Super-admin listing, inspection, and lifecycle management of fleet-owner accounts and their fleets.
- **Justification**: `super_admin` platform administration operates across all fleets (same trust level as §2). The `users` table RLS policy is self-only (`id = app.user_id`), so no tenant-path query can enumerate other users; owner accounts are global rows. All operations run behind `@Platform()` + permission guards and are audit-logged.

