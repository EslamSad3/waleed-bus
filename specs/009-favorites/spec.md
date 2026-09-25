# Feature Specification: Favorites (Fleet + Bus)

**Feature Branch**: `feature/waleed-call-requirements`

**Created**: 2026-09-24

**Status**: Draft

**Input**: Call requirements plan `waleed-bus-implementation-plan.md` §§17–21, 68, 86, 100.

## Decisions

- Types: `FLEET` (fleetId required, busId null) and `BUS` (busId required) only. No TRIP.
- Passenger self-service: authenticated user with verified phone (mirrors booking); all operations scoped to `actor.id`, never a client-supplied userId.
- Optional stop prefs (`boardingStationId`/`landingStationId`, nullable) validated against a shared route in the favorite's fleet scope: both stops on one route, boarding order before landing, type-compatible. Returned exactly as saved.
- Dedup: `@@unique([userId, fleetId])` + `@@unique([userId, busId])` (Postgres NULL-distinct semantics yield per-type dedup).
- Disabled buses/fleets: cannot be newly favorited (`FAVORITE_TARGET_NOT_AVAILABLE`); existing favorite rows are preserved but flagged `isTargetActive: false` in list responses (no destructive deletion).
- No audit logging (user-private high-volume data; not in the §64 audit list — deliberate).
- No dashboard UI (plan §100 — only if business explicitly requests).
- RLS: `favorites` gets a self-access policy + grants (user-owned pattern like `user_auth_providers`); service uses the system path with strict actor scoping (same justification family as passenger bookings: cross-fleet, user-owned).

## Scenarios

1. Favorite a fleet → 201; duplicate → 409.
2. Favorite an active bus with stop prefs on a shared route → 201 with prefs echoed.
3. Favorite inactive bus / inactive fleet → 422 `FAVORITE_TARGET_NOT_AVAILABLE`.
4. Boarding after landing / incompatible types / stops on different routes → 422 `INVALID_FAVORITE_STOPS`.
5. List returns only the actor's favorites with `isTargetActive` flags.
6. Update prefs / delete; accessing another user's favorite id → 404 (no oracle).
7. Unverified-phone user → 403 `PHONE_NOT_VERIFIED` (mirror booking semantics — verify actual code in implementation).
