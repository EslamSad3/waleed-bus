# Quickstart: Fleet Owner & Bus Driver Flows

**Feature**: `003-fleet-owner-driver-flows` | Validates plan.md + data-model.md + contracts/ end-to-end on real PostgreSQL. No implementation code here — scenarios only; `/speckit-tasks` turns them into red→green work.

## Prerequisites

```bash
pnpm install
pnpm db:up                  # embedded PG :5433 (.pgdata-dev)
pnpm db:create-role
pnpm db:migrate:deploy      # includes <ts>_fleet_owner_driver (roles, assignments, reports, booking cols)
pnpm db:setup-rls && pnpm db:check-rls
pnpm db:seed
pnpm start:dev              # :3000, Swagger /docs
```

## Scenario A — Owner manages fleet (envelope + RLS)

1. Seed owner + fleet + bus + driver membership (via seed/dev script or platform endpoints as super_admin).
2. `POST /auth/login {loginType:"FLEET_OWNER", phone, password}` → 200 token pair; wrong password AND foreign `loginType` → identical 401 `AUTHENTICATION_FAILED`.
3. `GET /fleet/buses` (fleet selector) → 200 cursor page; same id with another fleet's selector → 404.
4. `POST /fleet/buses` → 201; duplicate `registrationNumber` → 409 `CONFLICTING_ASSIGNMENT`.
5. `POST /fleet/buses/{id}/driver {driverUserId}` → 200 assignment; re-POST same pair → 200 no-op; assign second bus to same driver → prior row ENDED, new ACTIVE.
6. `POST /fleet/buses/{id}/disable` with a DEPARTED trip on it → 409 `BUS_ACTION_NOT_ALLOWED`; reactivate → 200.

## Scenario B — Driver operates a trip (idempotent, assignment-anchored)

1. `POST /auth/login {loginType:"DRIVER", phone, password}` → 200. Membership-free first login provisions a personal fleet (US5); owners-with-fleets attempting DRIVER login → 401.
2. `GET /driver/bus`, `/driver/fleet` (name + phone + owner contact, Q5-B), `/driver/trips/current` → 200.
3. `GET /driver/trips/{id}/passengers` → manifest with §9 fields only; same trip as unassigned driver → 404 `TRIP_ACCESS_DENIED`.
4. Board → 200; repeat → 200 same; drop-off `DROPPED_OFF {stationId}` → 200; conflicting re-drop → 409 `INVALID_DROPOFF_STATE`.
5. Cash payment `{CASH, PAID}` → 200 with authoritative amount; repeat → 200; method mismatch → 409 `PAYMENT_NOT_ALLOWED`.
6. Rate passenger + report note → 200; duplicate rating change → 409. `POST .../complete` is DEFERRED to the trips-lifecycle round (not in this slice).
7. Independent driver: `POST /driver/bus/claim {busId}` → 200 self-assign on owned fleet; fleet driver attempting claim → 403.

## Scenario C — Isolation matrix (must stay green)

- Owner A reads bus/trip/driver/report of fleet B → 404. Driver A operates trip of fleet B → 404. Unassigned driver reads manifest → 404. Passenger token on `/driver/*`, `/fleet/*` → 403. Personal fleets invisible across tenants both directions (→ 403 without membership). Raw `app_tenant` SQL without context → zero rows.

## Regression gates

```bash
pnpm typecheck && pnpm lint
pnpm test && pnpm test:e2e        # incl. new fleet-owner.e2e-spec.ts + driver-ops.e2e-spec.ts
pnpm test:cov                     # lines 80 / functions 70 / statements 75 / branches 70
pnpm docs:generate                # commit refreshed docs/openapi.json
```
