# Spec 001 — Multi-Tenant Fleet API Foundation (Auth, RBAC, RLS)

**Status**: approved (implementation plan ratified 2026-09-06)
**Source**: security architecture brief (NestJS-owned auth + Supabase-as-Postgres + RLS)

## Problem

Build the production-ready core of a group bus transportation platform API: authentication,
dynamic RBAC, fleet (tenant) membership, and PostgreSQL RLS — such that a future application
query bug can never leak data across fleets.

## Architecture Summary

```
NestJS (login, JWT issue/verify, RBAC, fleet authorization)
   → verified identity + membership → tenant context
      → DB transaction with transaction-local GUCs
         → PostgreSQL RLS (Supabase) = final boundary
```

- Supabase is ONLY PostgreSQL + RLS. No Supabase Auth.
- Two DB paths: `app_tenant` role (RLS-enforced, normal requests) and owner role
  (migrations, seed, `super_admin` platform endpoints — explicit + audited).
- JWT: HS256, `{sub, email, app_role, authVersion, sessionId}`; response body is
  `{accessToken}` only. `authVersion` bump + session revocation kills stale tokens.
- Roles/permissions are DB rows; only `super_admin` is a predefined system role.
- Fleet = tenant; `FleetMember` (user, fleet, role, status) is the central authorization object.

## Data Model

User, Role, Permission, RolePermission, UserRole, Fleet, FleetMember, Session, AuditLog,
Bus, Trip, Booking (fleet-owned: `fleet_id` + FK indexes; uniqueness: role slug, permission
key, membership pair, role-permission pair).

## API Surface

- `POST /auth/login` (@Public), `POST /auth/refresh` (@Public), `POST /auth/logout`, `GET /auth/me`
- Roles CRUD + `PUT /roles/:id/permissions` (platform, super admin)
- Permissions CRUD (platform, super admin)
- Users CRUD + global role assignment (platform, super admin)
- Fleets CRUD (platform), `GET /fleets/mine`
- `POST/PATCH/DELETE/GET /fleets/:fleetId/members(/:memberId)` (super admin platform path OR
  fleet-scoped `members.manage`)
- Buses / Trips / Bookings: fleet-scoped CRUD under `/fleets/:fleetId/...`
- `GET /audit-logs` (platform)

## Security Requirements

- Guards (global order): JwtAuthGuard → TenantContextGuard → PermissionGuard. `@Public()` opts out.
- Permission decorators: `@RequirePermission`, `@RequireAnyPermission`, `@RequireAllPermissions`.
- Client `fleetId` (param, header, body, query) is a selector, never proof of authorization.
- Cross-tenant misses return 404 (no existence oracle). IDOR/BOLA blocked.
- Transactions for: role-permission updates, membership changes, role changes, user
  suspension, authVersion bumps. Self-lockout protection per constitution §VII.
- Audit all privileged ops (actor, target, action, resource, ip, ua, success, timestamp); never
  log secrets.
- RLS: enable+force on all fleet-owned tables; `app.is_fleet_member` SECURITY DEFINER helper;
  fail-closed policies; `REVOKE ALL ... FROM PUBLIC`; app_tenant has no schema CREATE.

## Acceptance Criteria (tests)

1. Fleet A user reads Fleet A buses; 2. cannot read Fleet B buses; 3. cannot update Fleet B trip;
4. cannot delete Fleet B booking; 5. fleetId in body cannot bypass; 6. fleetId in URL cannot
bypass; 7. known foreign UUIDs cannot bypass RLS; 8. `trips.read` without `trips.update` ⇒ 403;
9. forged `app_role` JWT fails signature verification; 10. expired JWT ⇒ 401; 11. role change
invalidates old elevated token; 12. suspended membership ⇒ no fleet access; 13. inactive user
⇒ no protected access; 14. SUPER_ADMIN platform path is separate from tenant path.
Plus: verified payload contains `app_role`; auth body does not duplicate role; unauthenticated
DB context sees zero rows; `check-rls` script passes; unit coverage ≥ 80%.

## Out of Scope

Docker, public registration, caching layers, payment/reporting domains, driver mobile apps.
