# Architecture — Multi-Tenant Fleet API

NestJS owns authentication, authorization, and business logic. Supabase is used
ONLY as the PostgreSQL host and Row Level Security (RLS) layer — no Supabase
Auth, no Supabase tokens.

```
NestJS
  ├─ JwtAuthGuard        verifies HS256 JWT (secret, iss, aud, exp, alg)
  ├─ TenantContextGuard  resolves the fleet selector → VERIFIED FleetMember context
  ├─ PermissionGuard     evaluates @RequirePermission / @RequireAnyPermission / @Platform
  └─ Controller/Service
        │
        ├─ FleetPathService ── tenant path  → TenantPrismaService (role app_tenant)
        │                     └─ transaction: set_config('app.user_id'/'app.fleet_id', …, true)
        │                        → PostgreSQL RLS policies (fail-closed)
        └─ platform path      → SystemPrismaService (table owner)
                                 super_admin only, explicit fleetId filter, audited
```

## The two database paths

| Path | Role | Used by | Enforcement |
|---|---|---|---|
| **Tenant** (default) | `app_tenant` — LOGIN, NOSUPERUSER, NOBYPASSRLS, minimal grants | every normal tenant request (buses/trips/bookings, own memberships, own sessions) | PostgreSQL RLS policies; missing context ⇒ zero rows |
| **System** (privileged) | table owner (`DIRECT_URL`) | migrations, seed, platform endpoints (`roles`, `permissions`, `users`, fleet CRUD, audit reads) + super_admin fleet data | application authorization (`@Platform` + super_admin claim) + audit log |

`FleetPathService` is the single decision point between the paths — fleet-scoped
services never choose a connection themselves.

## Tenant context

`TenantContextService.withFleetContext({userId, fleetId}, fn)` opens ONE
interactive Prisma transaction (pinned connection — safe with pgBouncer
transaction pooling) and executes
`SELECT set_config('app.user_id', $1, true), set_config('app.fleet_id', $2, true)`
first. `true` = transaction-local, so pooled connections never leak context.
Policies read the settings with `current_setting('app.x', true)`; absent or
empty values cast to NULL and fail CLOSED.

`app.is_fleet_member(user, fleet)` is a SECURITY DEFINER, `STABLE` function
(pinned `search_path = app, public`) that re-verifies ACTIVE membership + active
user — defeating spoofed GUC values and policy recursion. `EXECUTE` is granted
to `app_tenant` only.

## RLS specifics and deliberate deviations

- `FORCE ROW LEVEL SECURITY` is intentionally NOT used: it would apply policies
  to the table owner and break the privileged system path. Enforcement for
  `app_tenant` comes from it being a non-owner with no BYPASSRLS (verified by
  `scripts/check-rls.ts` at test time and runnable against any environment).
- PostgreSQL foreign-key checks run as the table owner and therefore BYPASS
  RLS. The database accepts, e.g., a booking pointing at another fleet's trip.
  The API guarantees integrity instead: booking creation loads the trip inside
  the same tenant transaction — cross-fleet trips are invisible ⇒ 404.
- Adding a new fleet-owned table: add `fleet_id` + FK + index, then add policy
  + grants in `prisma/sql/rls/*.sql`. `scripts/check-rls.ts` fails if any
  public table lacks RLS or a policy.

## Authentication

- Login/refresh use the system path by design (credential check precedes any
  identity context). Access tokens: HS256, 15 min, claims
  `{sub, email, app_role, authVersion, sessionId}` — `app_role` is a CUSTOM
  claim (never PostgreSQL's `role`). Login body returns tokens only; no
  authorization claims are duplicated.
- Refresh tokens are random 48-byte values, stored SHA-256-hashed, rotated on
  every refresh; reuse of a rotated token fails with 401.
- `authVersion` lives on the user row and inside the JWT; any
  security-sensitive change (global role change, deactivation, password
  change, membership role/status change) bumps it and revokes all sessions
  transactionally — stale elevated JWTs die immediately.
- Self-lockout protection: the last active `super_admin` cannot be demoted,
  deactivated, or deleted; the system role cannot be deleted/disabled/edited.

## Environment

See `.env.example`. `DATABASE_URL` = tenant role, `DIRECT_URL` = owner
(migrations, seed, system path). Never append `?schema=public` — it breaks
Prisma 7's migration engine on this stack.

## Migrations (no shadow database)

1. Edit `prisma/schema.prisma`.
2. `npm run db:migrate:diff` → save SQL into
   `prisma/migrations/<timestamp>_<name>/migration.sql`.
3. `npm run db:migrate:deploy` (runs as owner), then `npm run db:setup-rls` if
   new tenant tables need policies.

## Testing

- Unit: `pnpm test` (vitest, no DB required).
- E2E: `pnpm test:e2e` — boots an embedded user-space PostgreSQL 18 into
  `.pgdata-test` (no Docker, no admin rights), applies migrations + RLS, and
  runs serially. Set `TEST_USE_EMBEDDED=0` to target an external localhost
  instance via `TEST_DATABASE_URL`/`TEST_DIRECT_URL` (remote URLs are refused).
- The four suites: RLS foundation (raw `app_tenant` connections), auth,
  RBAC administration, tenant isolation (the 14-test matrix from `specs/001`).
