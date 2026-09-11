# Contracts: Bus Driver (`/driver/*`)

All responses use the platform envelope `{statusCode, data}`; errors use `{statusCode, code, message, details?}` (see `errors.md`). Every trip/passenger op re-anchors on the in-transaction trip row (research R-02): the caller's active `bus_assignments` row must match `(fleetId=trip.fleetId, busId=trip.busId, driver=caller)`, else 404 `TRIP_ACCESS_DENIED`. Mutations are convergent — repeats return 200 with current state; conflicting terminal writes return 409.

Auth: `POST /auth/login` shared body — driver variant `{loginType:"DRIVER", phone, password}`. Failures generic.

## Context reads (permission `driver.context.read` via ACTIVE driver membership)

```http
GET /me
PATCH /me                    # {name?, picture?}
GET /driver/bus              # active assignment + bus row (404 when unassigned)
GET /driver/bus/{busId}      # must equal assigned bus, else 404
GET /driver/fleet            # {id, name, phone, owner: {id, name, phoneNumber}} (clarify Q5-B: fleet name + phone + owner contact)
GET /driver/trips?status=&cursor=&limit=
GET /driver/trips/current    # nearest DEPARTED (fallback SCHEDULED-today) trip on assigned bus, else 404
GET /driver/trips/{tripId}   # assignment-guarded single trip
```

## Passengers (permission `driver.passengers.read`)

```http
GET /driver/trips/{tripId}/passengers
```

Returns per booking (PRD §9 only): `{bookingId, name, pickupAddress?, phoneNumber, seatCount, boardingStatus, dropOffStatus}`. Pickup address/phone expose ONLY here, only to the assigned driver (RLS + in-tx assignment check; no bulk export endpoint).

## Operations (permission `driver.trips.operate`)

```http
POST /driver/trips/{tripId}/passengers/{bookingId}/board
# → 200 {boardingStatus:"BOARDED", boardedAt} | repeat → 200 same | booking cancelled/foreign → 404/409

POST /driver/trips/{tripId}/passengers/{bookingId}/dropoff
# {status:"DROPPED_OFF", stationId} | {status:"NOT_DROPPED_OFF", reason}
# reason required for NOT_DROPPED_OFF; terminal per booking; conflicts → 409 INVALID_DROPOFF_STATE

POST /driver/trips/{tripId}/passengers/{bookingId}/payment
# {method:"CASH", status:"PAID"} — amount read-only from booking record; requires boarded + unpaid;
# repeat PAID → 200; otherwise 409 PAYMENT_NOT_ALLOWED

POST /driver/trips/{tripId}/passengers/{bookingId}/rating
# {rating: 1..5} — requires COMPLETED trip; one write (repeat same → 200, change → 409 RATING_NOT_ALLOWED)

POST /driver/trips/{tripId}/passengers/{bookingId}/report
# {note} (1..2000 chars) — requires booking on assigned non-cancelled trip; else 409 REPORT_NOT_ALLOWED

POST /driver/bus/claim
# {busId} — self-assign an owned-fleet bus (independent drivers; 403 unless the caller owns the fleet)
```

> `POST .../complete` (DEPARTED → COMPLETED) is DEFERRED to the trips-lifecycle round — not in this slice.

## Passenger-side rating (existing booking surface)

```http
POST /bookings/{bookingId}/rating   # {busRating 1..5, driverRating 1..5} — own booking, COMPLETED trip,
                                    # bus/driver belong to trip; one write per side
```
