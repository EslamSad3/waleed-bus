# Feature Specification: Notifications (User Inbox)

**Feature Branch**: `feature/waleed-call-requirements`

**Created**: 2026-09-24

**Status**: Draft

**Input**: Call requirements plan `waleed-bus-implementation-plan.md` §§115–124, user scope decision.

## Decisions (scoped per user: DB table + inbox ops)

- Model: `Notification` — `userId`, `category` (TEXT | TRIP | DISCOUNT_CODE per call §§43-44;
  corrected on external review — the earlier BOOKING/PAYMENT/PROMO/SYSTEM set plus `data` JSONB
  diverged from the required contract and have been replaced by explicit nullable `tripId` /
  `promotionId` references with FKs, plus a `notifications_category_check` CHECK constraint),
  `title`, `body` (Arabic-first strings composed by the trigger site),
  optional `dedupeKey` `@@unique` (idempotency: re-emit with same key = no-op, returns existing),
  `isRead` default false + `readAt?`, timestamps. `@@index([userId, isRead, createdAt])`.
- `NotificationService.notify()` is the single emit path (system path; triggers are server-side
  events, never client-supplied userIds). All emits best-effort: wrapped so a notify failure
  NEVER fails the originating booking/payment transaction (catch + log).
- Only trigger wired now: call §42 USER-scoped promo assignment — creating a non-global
  promotion emits one DISCOUNT_CODE row per target user (post-commit, best-effort,
  dedupeKey `promo:{promotionId}:assigned:{userId}`). Global codes emit nothing.
  (Earlier booking/payment/cancel/refund triggers removed on external review: outside
  the call contract.)
- Passenger inbox API (verified-phone users, actor-scoped, cursor pagination):
  `GET /notifications` (filter `unread=true|false`), `GET /notifications/unread-count`,
  `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`, `DELETE /notifications/:id`,
  `DELETE /notifications` (delete all mine). Foreign ids → 404 (no oracle).
- Platform ops: `GET /platform/notifications` (cursor, filter by userId/category) — delivery
  visibility (§117). No platform compose in this release (out of scope; campaign model later).
- RLS: `notifications` gets self-access policy + grants (user-owned pattern like favorites);
  service uses the system path with strict actor scoping (cross-user triggers: booker vs traveler).
- No audit logging (user-private high-volume; same rationale as favorites).
- Out of scope (later): WhatsApp/SMS providers, templates engine, scheduling/retries/DLQ,
  preference center, campaigns. The `category` + explicit `tripId`/`promotionId` shape is the forward-compatible seam.

## Scenarios

1. Seeded TEXT (no refs) + TRIP (tripId, promotionId null) rows served with explicit references.
2. Creating a USER-scoped promotion → each target user gains one DISCOUNT_CODE row (promotionId set); non-targeted users see nothing new (no oracle).
3. Duplicate promo creation (409) emits no second notification.
4. Updating targets A,B → A,B,C notifies C only (newly-added); A keeps a single row.
5. Re-emit same dedupeKey → single row (idempotency, P2002 path returns existing).
6. List/unread-count reflect state; mark one read; mark all read; delete one; delete all.
7. Another user's notification id → 404.
8. Unknown category / missing or cross-category refs → 422 INVALID_NOTIFICATION_CATEGORY / INVALID_NOTIFICATION_REF (mirrored by DB CHECK notifications_ref_check).
