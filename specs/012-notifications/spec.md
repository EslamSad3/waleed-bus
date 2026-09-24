# Feature Specification: Notifications (User Inbox)

**Feature Branch**: `feature/waleed-call-requirements`

**Created**: 2026-09-24

**Status**: Draft

**Input**: Call requirements plan `waleed-bus-implementation-plan.md` §§115–124, user scope decision.

## Decisions (scoped per user: DB table + inbox ops)

- Model: `Notification` — `userId`, `category` (BOOKING | PAYMENT | TRIP | PROMO | SYSTEM),
  `title`, `body` (Arabic-first strings composed by the trigger site), optional `data` JSON
  (bookingId/tripId/code — ids only, no PII beyond what the inbox owner already sees),
  optional `dedupeKey` `@@unique` (idempotency: re-emit with same key = no-op, returns existing),
  `isRead` default false + `readAt?`, timestamps. `@@index([userId, isRead, createdAt])`.
- `NotificationService.notify()` is the single emit path (system path; triggers are server-side
  events, never client-supplied userIds). All emits best-effort: wrapped so a notify failure
  NEVER fails the originating booking/payment transaction (catch + log).
- Triggers wired now: booking confirmed (booker + traveler when `passengerUserId ≠ booker`),
  payment marked PAID (booker), booking cancelled (booker + traveler), refund issued (booker).
  Dedupe keys: `booking:{id}:confirmed`, `booking:{id}:paid`, `booking:{id}:cancelled`,
  `booking:{id}:refund`. Traveler variants suffix `:traveler`.
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
  preference center, campaigns. The `category` + `data` shape is the forward-compatible seam.

## Scenarios

1. Booking created → booker inbox has BOOKING confirmed notification; OTHER with linked traveler
   account → traveler also notified.
2. Re-emit same dedupeKey → single row (idempotency).
3. List/unread-count reflect state; mark one read; mark all read; delete one; delete all.
4. Another user's notification id → 404.
5. Notify failure (e.g. DB error) does not fail booking creation.
6. Payment PAID → PAYMENT notification; cancel → TRIP/BOOKING cancelled; refund → PAYMENT refund.
