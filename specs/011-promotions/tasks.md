# Tasks: 011 Promotions

- [x] Spec 011 written (global + targeted, once-per-user default ON)
- [x] RED: `src/promotions/promotion-math.spec.ts` (10 tests)
- [x] Schema: `Promotion`, `PromotionTarget`, `PromotionUsage`, `Booking.promotionId/promoCode/discountAmount`
- [x] Migration `20260924000007_release6_promos_notifications` (local-first; deployed local)
- [x] GREEN: platform CRUD + expire + usages dashboard; passenger active/validate; checkout apply with FOR UPDATE lock, soft-fail to full price, hard-fail EXHAUSTED/ALREADY_USED; no stacking
- [x] Booking integration: `promoCode` DTO, tx resolution, usage row, response snapshot (`promoStatus`), admin list/detail/refund carry promo
- [x] Config `PROMO_ENFORCE_ONCE_PER_USER` (default true); `.env.example`
- [x] Boundary: `SYSTEM_PRISMA_JUSTIFICATIONS.md` §13 + allowlist
- [x] Review round 2-4 hardening: targetUserIds in platform responses; updatePromotion newly-added-only §42 notify; PATCH empty-target invariant (non-global + [] → 422); @ArrayUnique on both DTOs; target eligibility gate (exist + active, FK `promotion_targets.user_id → users(id)` CASCADE in migration `...00010`); `GET /users/target-options` server-side eligible search; promo emits awaited via allSettled
- [x] E2E `test/promotions.e2e-spec.ts` (15 tests: + PATCH empty-target 422 + targets preserved, unknown-target 422, duplicate-ids 400)
- [x] RLS: platform tables excluded + revoked (catalog pattern); `db:check-rls` green
- [x] `typecheck + lint + test` (279 unit) green; `docs:generate` regenerated
- [x] Dashboard: `/promotions` CRUD + expire + usage viewer with audience selector (all / specific via server-side eligible search); booking detail promo line
- [ ] Follow-up: prod deploy of migrations `...00007/00008`
