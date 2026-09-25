# Tasks: 008 Discovery + VIP

- [x] Spec 008 written
- [x] RED: `src/fleet-owner/discovery.service.spec.ts` (6 tests)
- [x] Schema: `VipTier`; `Fleet.vipTierId?` (nullable, untiered sorts last)
- [x] Migration `20260924000004_vip_tiers` (local-first diff; deployed local + test)
- [x] GREEN: `VipTierService` + `/vip-tiers` platform CRUD (`fleets.*`) + audit
- [x] `PATCH /fleets/:id/vip` assign/clear + audit (`VIP_TIER_NOT_AVAILABLE`)
- [x] `DiscoveryService`: public `GET /public/discovery/fleet-owners` (owner/fleet/geography match, owner-grouped with nested fleets[], VIP-ordered, bounded limit, NO cursor) + `GET .../:fleetId/buses` (active only + driver)
- [x] Review round 2-3: two-stage owner selection (all light matches → distinct owners by best ACTIVE rank → full rows for chosen owners; inactive tier = untiered); deterministic tiebreak rank → name → owner.id; crowd-out gap e2e + inactive-tier unit test
- [x] RLS: `vip_tiers` catalog-excluded + revoked; `db:check-rls` green
- [x] Boundary: discovery + vip-tier services allowlisted + justified (§11)
- [x] OpenAPI public allowlist extended; `docs:generate` regenerated
- [x] E2E `test/discovery-vip.e2e-spec.ts` (10 tests incl. crowd-out gap)
- [ ] Known scale limit: stage-1 loads all matching fleets into Node (correct at current scale; next optimization is DB-side owner aggregation + search indexes)
- [x] `typecheck + lint + test` green
- [ ] Dashboard: VIP tiers page + fleet assignment UI (bus_dashboard branch)
- [ ] Follow-up: trigram index evaluation for Arabic LIKE at scale (plan §66); prod deploy of migration `...00004`
