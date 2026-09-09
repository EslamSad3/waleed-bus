# Authorization Matrix

Roles and permissions are **database rows** — nothing below is hard-coded. The
matrix describes the SEEDED example roles (see `prisma/seed.ts`) and the two
special paths; administrators can create any role/permission combination at
runtime via the API.

| Capability (permission key) | fleet-owner | fleet-manager | driver | super_admin |
|---|---|---|---|---|
| Fleet read (`fleets.read`) | ✓ | ✗ | ✗ | ✓ (platform path) |
| Fleet update (`fleets.update`) | ✓ | ✗ | ✗ | ✓ (platform path) |
| Fleet create/delete | ✗ | ✗ | ✗ | ✓ (platform path) |
| Members read (`members.read`) | ✓ | ✓ | ✗ | ✓ (any fleet, platform path) |
| Members manage (`members.manage`) | ✓ | ✓ | ✗ | ✓ (any fleet, platform path) |
| Buses / Trips / Bookings full CRUD | ✓ | ✓ | ✗ | ✓ (any fleet, platform path) |
| Trips / Bookings read | ✓ | ✓ | ✓ | ✓ |
| Users manage (platform, `users.*`) | ✗ | ✗ | ✗ | ✓ |
| Roles manage (platform, `roles.*`) | ✗ | ✗ | ✗ | ✓ |
| Permissions manage (platform, `permissions.*`) | ✗ | ✗ | ✗ | ✓ |
| Audit read (`audit.read`) | ✗ | ✗ | ✗ | ✓ |

## How a request is authorized

1. **JwtAuthGuard** — cryptographic verification + live checks (user active,
   `authVersion` match, session not revoked/expired).
2. **TenantContextGuard** — the `fleetId` route param / `x-fleet-id` header is
   a selector only; the guard loads the caller's ACTIVE membership. No
   membership ⇒ 403. Verified `super_admin` gets a PLATFORM context.
3. **PermissionGuard** — WHAT the caller may do:
   - `@Platform()` routes: verified `super_admin` role only;
   - fleet-scoped routes: the caller's fleet role must hold the required
     permission keys (ALL, or ANY with `@RequireAnyPermission`).
4. **FleetPathService / RLS** — WHICH data the caller may act upon: the tenant
   path sets transaction-local context and PostgreSQL RLS is the final
   boundary; the platform path is super-admin-only, explicit, and audited.

## Example dynamic role

A "Dispatcher" role holding exactly `buses.read`, `trips.read`,
`bookings.read`, `trips.update` would let its members move trips between
statuses while remaining unable to read audit logs or manage members —
enforced identically to the seeded roles because authorization is fully
data-driven (no enums).
