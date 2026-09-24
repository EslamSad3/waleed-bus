# Tasks: 011 Promotions

- [x] Spec 011 written (global + targeted, once-per-user default ON)
- [x] RED: `src/promotions/promotion-math.spec.ts` (10 tests)
- [x] Schema: `Promotion`, `PromotionTarget`, `PromotionUsage`, `Booking.promotionId/promoCode/discountAmount`
- [x] Migration `20260924000007_release6_promos_notifications` (local-first; deployed local)
- [x] GREEN: platform CRUD + expire + usages dashboard; passenger active/validate; checkout apply with FOR UPDATE lock, soft-fail to full price, hard-fail EXHAUSTED/ALREADY_USED; no stacking
- [x] Booking integration: `promoCode` DTO, tx resolution, usage row, response snapshot (`promoStatus`), admin list/detail/refund carry promo
- [x] Config `PROMO_ENFORCE_ONCE_PER_USER` (default true) + `PROMO_DEFAULT_TYPE`; `.env.example`
- [x] Boundary: `SYSTEM_PRISMA_JUSTIFICATIONS.md` §13 + allowlist
- [x] E2E `test/promotions.e2e-spec.ts` (11 tests: global-once-per-user, expiry/exhaust/cap, validate, expire, usages, readonly list)
- [x] RLS: platform tables excluded + revoked (catalog pattern); `db:check-rls` green
- [x] `typecheck + lint + test` (279 unit) green; `docs:generate` regenerated
- [x] Dashboard: `/promotions` CRUD + expire + usage viewer; booking detail promo line
- [ ] Follow-up: prod deploy of migrations `...00007/00008`
