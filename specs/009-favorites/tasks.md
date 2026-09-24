# Tasks: 009 Favorites

- [x] Spec 009 written
- [x] RED: `src/favorites/favorites.service.spec.ts` (6 tests)
- [x] Schema: `Favorite` + per-type uniques; `User.favorites` relation
- [x] Migration `20260924000005_favorites` (local-first; deployed local + test)
- [x] GREEN: `FavoritesService` (verified-phone gate, target checks, stop-pref route validation, actor scoping, 404-no-oracle) + `/favorites` CRUD controller + module
- [x] Uniques: BUS rows keep `fleetId` NULL (fleet derived at read) — storing it collided with FLEET rows under `(userId, fleetId)`
- [x] RLS: `owner_favorites` self-policy + grants in 001 SQL; `db:check-rls` green
- [x] Boundary: `favorites/favorites.service.ts` allowlisted + justified (§12)
- [x] E2E `test/favorites.e2e-spec.ts` (9 tests; guard-level PROFILE_INCOMPLETE documented vs service PHONE_NOT_VERIFIED defense)
- [x] Test hygiene: `resetDatabase` += favorites, vehicle_brands, vip_tiers
- [x] `typecheck + lint + test` (254 unit) green; `docs:generate` regenerated
- [ ] Dashboard: none (plan §100 — mobile-facing only)
- [ ] Follow-up: prod deploy of migration `...00005` + RLS policy apply
