# AGENTS.md — bus_api

NestJS 12 + TypeScript ESM + Prisma 7 + Vitest. Package manager is **pnpm** (lockfile `pnpm-lock.yaml`). `type: module`, `module/moduleResolution: nodenext` — relative imports **must use `.js` suffix** (e.g. `./app.bootstrap.js`).

## Commands

```bash
pnpm install          # postinstall runs `prisma generate`
pnpm start:dev        # API on :PORT (default 3000), Swagger at /docs
pnpm build            # `nest build` (tsc) -> dist/
pnpm typecheck        # `tsc --noEmit`
pnpm lint             # `oxlint src/ test/`
pnpm format           # prettier --write src/test (singleQuote, trailingComma all)
pnpm test             # unit specs only, no DB
pnpm test:e2e         # embedded PG + migrations + RLS, all e2e suites serially
pnpm test:cov         # unit + e2e with coverage gate (lines 80 / functions 70 / statements 75 / branches 70)
pnpm docs:generate    # rebuild docs/openapi.json — run + commit whenever routes/DTOs change
```

Focused verification: `pnpm vitest run <path/to.spec.ts>` (unit) or `pnpm vitest run --config ./vitest.config.e2e.ts <path/to.e2e-spec.ts>` (single e2e file). CI order: `typecheck -> lint -> test:cov -> build` (`.github/workflows/ci.yml`, runs on PRs to `main` and pushes to `main` against `postgres:16`).

## Database (two connections — do not mix up)

- `DATABASE_URL` = RLS-enforced `app_tenant` role (all normal tenant traffic). `DIRECT_URL` = privileged table owner (migrations, seed, platform path only).
- Never append `?schema=public` to PG URLs — breaks Prisma 7.10 migration engine.
- `prisma.config.ts` routes `migrate` commands to `DIRECT_URL` automatically.
- Local dev order (embedded PostgreSQL on port 5433, data in gitignored `.pgdata-dev`, no Docker needed):
  `pnpm db:up` → `pnpm db:create-role` → `pnpm db:migrate:deploy` → `pnpm db:setup-rls` → `pnpm db:seed`
- After editing `prisma/schema.prisma`: `pnpm db:migrate:diff` → save SQL to `prisma/migrations/<timestamp>_<name>/migration.sql` → `pnpm db:migrate:deploy` → `pnpm db:check-rls`.
- E2E (`test/global-setup.ts`): boots embedded PG into `.pgdata-test`, creates role, runs `prisma migrate deploy` as owner, applies RLS. Refuses non-localhost URLs. `TEST_USE_EMBEDDED=0` + `TEST_DATABASE_URL`/`TEST_DIRECT_URL` targets external local PG instead. `fileParallelism: false` — suites share one DB, keep serial.
- Missing/invalid env fails fast via `loadConfig()` (`Invalid configuration: ...`); `NODE_ENV=test` switches DB URLs to `TEST_*`.

## Architecture gotchas

- Entry: `src/main.ts` → `createApp()` (`src/app.bootstrap.ts`) → `AppModule`. Vercel entry is root `server.js`, which **must import `dist/app.bootstrap.js`** (tsc output carries decorator metadata; esbuild-bundled `src/*.ts` does not) and must `init()` + export Express instance, never `listen()`. `vercel.json` runs `pnpm build` first.
- Two Prisma clients (`src/prisma/prisma.module.ts`, global): `TenantPrismaService` (default for buses/trips/bookings/memberships/sessions) vs `SystemPrismaService` (migrations/seed + super_admin platform endpoints: roles, permissions, users, fleet CRUD, audit). `FleetPathService` is the only decision point — fleet-scoped code never picks a client itself.
- Tenant context: `TenantContextService.withFleetContext({userId, fleetId})` opens one interactive transaction pinned to a connection and sets `app.user_id`/`app.fleet_id` transaction-local first; RLS policies fail closed on missing context. Adding a fleet-owned table requires `fleet_id` + FK + index **plus** policy + grants in `prisma/sql/rls/*.sql` (`db:check-rls` enforces). `FORCE RLS` is deliberately off (would break owner path). FK checks bypass RLS — always load e.g. a booking's trip inside the same tenant transaction so cross-fleet rows 404.
- Auth: NestJS HS256 JWT only (no Supabase Auth; Supabase is just a PG host). Claims `{sub, email, app_role, authVersion, sessionId}` — `app_role` is custom, never PG `role`. Access ~15m; refresh = 48-byte random stored SHA-256-hashed, rotated each use, reuse → 401. Security-sensitive changes bump `authVersion` and revoke sessions. Last active `super_admin` cannot be demoted/deactivated/deleted; system role is immutable.
- HTTP shape: global `EnvelopeInterceptor` wraps success as `{statusCode, data}`; errors via `AllExceptionsFilter`. Global validation pipe from `src/common/validation/validation-pipe.ts`. `GET /` = public service info; `/docs` = Swagger (serverless falls back to pinned CDN copy).
- OpenAPI: `src/openapi/openapi.document.ts` is the single source for both `/docs` and checked-in `docs/openapi.json`; generation spec is excluded from default `pnpm test`. Cursor pagination + envelope + bearer security are asserted in `openapi.document.spec.ts`.
- Generated Prisma client lives in `src/generated/` (gitignored, prettier-ignored) — never edit; rerun `pnpm db:generate`.
- Env on Vercel/Supabase: both DB URLs need `?sslmode=no-verify` (pooler); required: `DATABASE_URL, DIRECT_URL, JWT_SECRET (≥32 chars), JWT_ISSUER, JWT_AUDIENCE, JWT_EXPIRES_IN (e.g. 15m)`. Verify deploy with `vercel curl <url>/health` (plain curl hits SSO redirect).
