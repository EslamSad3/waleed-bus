# Feature Specification: Fleet-Owner Discovery + VIP Tiers

**Feature Branch**: `feature/waleed-call-requirements`

**Created**: 2026-09-24

**Status**: Draft

**Input**: Call requirements plan `waleed-bus-implementation-plan.md` §§13–16, 45–52, 85, 90, 97.

## Decisions (frozen)

- VIP attaches to `Fleet` (`Fleet.vipTierId?`), ordered by tier rank ASC (nulls last), then fleet name, then id. Same-branch decision 2026-09-24.
- Discovery search is **public** (same funnel as `GET /trips/search`, also public) — no seat-availability filter; grouped by fleet, never buses at top level.
- Bus discovery excludes inactive buses; booking search remains the separate bookability funnel (§49).

## User Scenarios

### Story 1 — VIP tiers (P1)

Super-admin manages `VipTier` (`name` unique, `rank` unique, `isActive`): list ordered by rank, create, rename/re-rank, activate/deactivate. Assigns a tier to a fleet (`PATCH /fleets/:id/vip`, nullable to clear). All mutations audited.

**Acceptance**:
1. Create tiers rank 1..3 → listed in rank order.
2. Duplicate rank → 409.
3. Assign unknown/inactive tier → 422 `VIP_TIER_NOT_AVAILABLE`.
4. Assign to unknown fleet → 404. Clear with `vipTierId: null`.

### Story 2 — Owner discovery search (P1)

`GET /public/discovery/fleet-owners?q=…` matches fleet name, owner name/nickname, and route geography (station/locality/markaz/governorate names, Arabic case-insensitive partial). Returns distinct fleets with owner name + vip rank, VIP-ordered, cursor-paginated. Empty `q` returns all active fleets in VIP order.

**Acceptance**:
1. `q=<owner name fragment>` → owner present exactly once (DISTINCT despite many trips).
2. `q=<governorate/city Arabic fragment>` → fleets serving it present.
3. VIP rank 1 fleet sorts before rank 2 and untiered, regardless of name.
4. Inactive fleet / inactive owner excluded.
5. `limit` + `nextCursor` paginate without duplicates.

### Story 3 — Owner buses (P1)

`GET /public/discovery/fleet-owners/:fleetId/buses` returns active buses with vehicle fields (spec 007) + assigned driver (`{id,name,phone}` or null). Unknown/inactive fleet → 404. Inactive bus never returned.

## Constraints

- Public reads use the system path (catalog data, no fleet_id) — boundary allowlist + justification required.
- VIP/search writes (tiers, assignment) are `@Platform()` + `fleets.*` permissions, audited.
- No TS enums; `{statusCode,data}` envelope; cursor pagination only; TDD red → green.
