# Bus Fleet API

Multi-tenant group bus transportation platform REST API.

- **NestJS 12 + TypeScript (ESM)** owns authentication, JWT issuance/verification, and
  dynamic RBAC. No Supabase Auth — Supabase (or any PostgreSQL) is only the
  database host and Row Level Security layer.
- **A fleet is the tenant.** Every fleet-owned table (`buses`, `trips`, `bookings`,
  …) carries `fleet_id` and is protected by **PostgreSQL RLS policies that fail
  closed** — application-level filtering alone is never trusted.
- Roles and permissions are **database rows** (only `super_admin` is a predefined
  system role); `app_role` travels as a custom JWT claim; stale tokens are killed
  via short-lived access tokens, rotating refresh sessions, and `authVersion`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and
[docs/AUTHORIZATION_MATRIX.md](docs/AUTHORIZATION_MATRIX.md) for the permission
model. The ratified principles live in `.specify/memory/constitution.md`; the
feature spec in `specs/001-multi-tenant-foundation/`.

## API documentation (OpenAPI)

Swagger UI is served at `/docs` from the running API. The machine-readable
contract is checked in as [docs/openapi.json](docs/openapi.json) — regenerate
and commit it whenever routes or DTOs change:

```bash
pnpm docs:generate   # rebuilds docs/openapi.json from route/DTO metadata
```

The document and `/docs` share one builder (`src/openapi/openapi.document.ts`), so
they can never diverge. The generated file is asserted by
`src/openapi/openapi.document.spec.ts` (tags, bearer security, path parameters,
cursor-pagination parameters, DTO constraints/enums, envelope-shaped success
responses, and no duplicated role data in auth responses).


## Quick start

```bash
pnpm install          # also generates the Prisma client
cp .env.example .env  # then adjust values

pnpm db:up            # start the embedded dev PostgreSQL (port 5433, no Docker)
pnpm run db:create-role   # create the RLS-enforced app_tenant role
pnpm run db:migrate:deploy
pnpm run db:setup-rls     # policies, grants, helper functions
pnpm run db:seed          # permission catalog + super admin (from .env)

pnpm start:dev        # API on :PORT (default 3000) — Swagger at /docs
```

## Tests (TDD)

```bash
pnpm test         # unit tests (no database required)
pnpm test:e2e     # boots an embedded PostgreSQL into .pgdata-test, applies
                  # migrations + RLS, then runs 4 suites serially:
                  #   - rls-foundation  (raw app_tenant connections, fail-closed)
                  #   - auth            (login/refresh/logout, JWT attacks)
                  #   - rbac            (roles/permissions/users/members admin)
                  #   - tenant-isolation (the 14-test cross-tenant matrix)
pnpm test:cov     # coverage gate (>= 80%)
pnpm typecheck
pnpm lint
```

E2E refuses non-localhost database URLs. Set `TEST_USE_EMBEDDED=0` to target an
external local PostgreSQL via `TEST_DATABASE_URL` / `TEST_DIRECT_URL`.

## Database workflow (no shadow database)

```bash
# after editing prisma/schema.prisma:
pnpm run db:migrate:diff   # generate SQL; save under prisma/migrations/<ts>_<name>/
pnpm run db:migrate:deploy # apply as the owner
pnpm run db:check-rls      # verify every table has RLS + a policy
```
