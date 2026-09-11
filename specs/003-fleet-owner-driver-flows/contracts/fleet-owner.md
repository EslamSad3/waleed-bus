# Contracts: Fleet Owner (`/me`, `/fleet/*`)

All responses use the platform envelope `{statusCode, data}`; errors use `{statusCode, code, message, details?}` (see `errors.md`). Cursor pagination `?cursor=&limit=` on all list endpoints. Fleet scope travels via `:fleetId` route param or `x-fleet-id` header and is re-verified in-transaction; cross-fleet ids → 404.

Auth: `POST /auth/login` shared body — owner variant `{loginType:"FLEET_OWNER", phone, password}`. Failures generic (`AUTHENTICATION_FAILED`); account-type mismatch indistinguishable.

## Profile

```http
GET /me
PATCH /me          # {name?, picture?} — phone/password change out of scope (platform flow)
```

## Buses (permission `fleet.buses.*`)

```http
GET /fleet/buses
GET /fleet/buses/{busId}
POST /fleet/buses                # {registrationNumber, plateNumber?, capacity}
PATCH /fleet/buses/{busId}       # {plateNumber?, capacity?}
POST /fleet/buses/{busId}/disable
POST /fleet/buses/{busId}/reactivate
POST /fleet/buses/{busId}/driver   # {driverUserId} — assign (ends prior active row)
DELETE /fleet/buses/{busId}/driver # unassign (row → ENDED)
```

- Disable guard: 409 `BUS_ACTION_NOT_ALLOWED` when the bus has a `DEPARTED` trip.
- Unique `registrationNumber` per fleet → 409 `CONFLICTING_ASSIGNMENT` (mapped via `translatePrismaError`).

## Trips (permission `fleet.trips.read`)

```http
GET /fleet/trips
GET /fleet/trips/{tripId}
```

Read-only in v1 (trip creation stays with the existing platform flow).

## Drivers roster (permission `fleet.drivers.*`)

```http
POST /fleet/drivers              # {userId | {name, phoneNumber, password}, roleSlug?} — create user (dashboard-origin rule relaxes to owner-invite here; confirm in specify) + ACTIVE membership + authVersion bump + audit
GET /fleet/drivers               # cursor page of fleet memberships holding driver-capable roles
GET /fleet/drivers/{driverId}
PATCH /fleet/drivers/{driverId}  # {roleSlug?, status?} — bumps authVersion, revokes sessions
DELETE /fleet/drivers/{driverId} # ends membership + active assignment; bumps authVersion
```

Driver bus assignment is managed via the `/fleet/buses/{busId}/driver` aliases above (same service).

## Reports (permission `fleet.reports.read`)

```http
GET /fleet/reports?type=passenger_reports|ratings&tripId=&from=&to=
```

v1 shape (confirm in specify): `{reports: PassengerReport[], ratingSummary: {busAvg, driverAvg, count}}` scoped to owned fleet.

## Business-service seam (PRD §7 future request/approval)

`FleetOwnerService` exposes `applyBusChange/applyDriverChange` behind a `FleetChangeApplier` interface; controllers call the service, never Prisma. The future approval flow swaps the applier implementation — no controller changes.
