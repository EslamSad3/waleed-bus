# Tasks: 008 Discovery + VIP

- [x] Spec 008 written
- [x] RED: `src/fleet-owner/discovery.service.spec.ts` (6 tests)
- [x] Schema: `VipTier`; `Fleet.vipTierId?` (nullable, untiered sorts last)
- [x] Migration `20260924000004_vip_tiers` (local-first diff; deployed local + test)
- [x] GREEN: `VipTierService` + `/vip-tiers` platform CRUD (`fleets.*`) + audit
- [x] `PATCH /fleets/:id/vip` assign/clear + audit (`VIP_TIER_NOT_AVAILABLE`)
- [x] `DiscoveryService`: public `GET /public/discovery/fleet-owners` (owner/fleet/geography match, VIP-ordered, cursor) + `GET .../:fleetId/buses` (active only + driver)
- [x] RLS: `vip_tiers` catalog-excluded + revoked; `db:check-rls` green
- [x] Boundary: discovery + vip-tier services allowlisted + justified (§11)
- [x] OpenAPI public allowlist extended; `docs:generate` regenerated
- [x] E2E `test/discovery-vip.e2e-spec.ts` (9 tests)
- [x] `typecheck + lint + test` (248 unit) green
- [ ] Dashboard: VIP tiers page + fleet assignment UI (bus_dashboard branch)
- [ ] Follow-up: trigram index evaluation for Arabic LIKE at scale (plan §66); prod deploy of migration `...00004`
