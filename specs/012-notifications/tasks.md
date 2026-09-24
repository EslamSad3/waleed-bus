# Tasks: 012 Notifications (User Inbox)

- [x] Spec 012 written (scoped: table + inbox ops per user decision)
- [x] RED: `src/notifications/notifications.service.spec.ts` (idempotency P2002, best-effort)
- [x] Schema: `Notification` (+ `User.notifications` back-ref); migration in `...00007`
- [x] GREEN: `NotificationsService` (notify/notifyBestEffort, list/unread-count/read/read-all/delete/delete-all); dedupeKey unique idempotency
- [x] Triggers (post-commit, best-effort): ~~booking confirmed (booker + traveler), payment PAID, cancel (passenger + force), refund issued~~ — REMOVED on external review (outside the call contract); replaced by the call §42 USER-scoped promo-assignment trigger (one DISCOUNT_CODE row per target user, dedupeKey idempotent)
- [x] Traveler-vs-booker routing: `Booking.bookedByUserId` (migration `...00008_booking_booker`, set on create)
- [x] Passenger inbox API + platform read-only ops list
- [x] RLS: `owner_notifications` self policy + grants; `db:check-rls` green
- [x] Boundary: `SYSTEM_PRISMA_JUSTIFICATIONS.md` §14 + allowlist
- [x] E2E `test/notifications.e2e-spec.ts` rewritten (5 tests: TEXT/TRIP explicit refs, §42 targeted-promo flow + no-oracle for others, duplicate-create emits nothing, read/read-all/delete/delete-all, 404 oracle)
- [x] `typecheck + lint + test` green; `docs:generate` regenerated
- [x] Dashboard: `/notifications` ops visibility (category badges, filters)
- [ ] Later (out of scope): providers, templates, scheduling/retries/DLQ, preference center, campaigns
