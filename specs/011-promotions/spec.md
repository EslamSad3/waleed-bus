# Feature Specification: Promotions (Promo Codes)

**Feature Branch**: `feature/waleed-call-requirements`

**Created**: 2026-09-24

**Status**: Draft

**Input**: Call requirements plan `waleed-bus-implementation-plan.md` §§104–114.

## Decisions

- Models: `Promotion` (code unique, case-insensitive normalized to UPPER-TRIM) + `PromotionUsage`
  (one row per booking that consumed a code; `@@unique([promotionId, bookingId])`).
- Types: `FIXED` only — fixed EGP amount, never percentage-based (call §39; corrected on
  external review — the earlier PERCENTAGE support + `PROMO_DEFAULT_TYPE` were a requirements
  mismatch and have been removed, including the `max_discount_amount` column and the DB
  `promotions_type_check` CHECK constraint enforcing `type = 'FIXED'`).
  Discount = min(fixedAmount, gross). Floor at 0.
- Scope: `isGlobal` (default true) — a global code is usable by every user; non-global codes carry
  an allowlist (`PromotionTarget` userIds) for user-segment assignment (§109). Non-targeted user
  attempting a targeted code → treated as unknown code (no oracle).
- Once-per-user: `maxUsesPerUser` default 1 (enforced ON by default per user decision). Global
  kill-switch `PROMO_ENFORCE_ONCE_PER_USER` (default `true`); when `false`, per-user counting is
  skipped but total caps still apply. Platform can raise `maxUsesPerUser` per code (§104 "extend").
- `maxTotalUses` (nullable = unlimited) enforced in the booking tx with a `FOR UPDATE` row lock
  on the promotion (serializes concurrent checkouts per code).
- Windows: `startsAt`/`expiresAt` nullable. Inactive / not-yet-valid / expired code at checkout →
  ignored silently: booking proceeds at FULL price with `promoStatus` echoed (`EXPIRED`,
  `NOT_STARTED`, `INACTIVE`, `UNKNOWN`). Exhausted total cap → 422 `PROMO_EXHAUSTED`. Already
  consumed by this user (and enforcement on) → 422 `PROMO_ALREADY_USED`. No stacking: exactly one
  code per booking.
- Booking snapshot: `Booking.promotionId?`, `promoCode` (verbatim code text), `discountAmount`
  (default 0); `totalAmount` remains the value actually paid (§104 "booking tracks value paid").
  Cancelled booking → usage row STAYS (audit truth); refund math unchanged (refunds operate on
  paid total).
- Platform CRUD: `POST /platform/promotions`, `GET /platform/promotions` (cursor),
  `PATCH /platform/promotions/:id` (edit windows/caps/active; code immutable after create),
  force-expire via `isActive=false` (`POST .../:id/expire` convenience = same),
  `GET /platform/promotions/:id/usages` (cursor, per-user consumption dashboard).
- Passenger: `GET /promotions/active` — readonly list of ACTIVE, currently-valid GLOBAL codes
  (code text + type + value + expiry; no usage internals). `promoCode` field on booking
  create DTO; `POST /promotions/validate` dry-run preview (discount for a trip/seats, no writes).
- Validation: code 3–32 chars `[A-Z0-9_-]` (normalized); FIXED value > 0 (positive EGP amount); non-FIXED type rejected at the DTO boundary (400); DB CHECK `promotions_type_check` enforces FIXED.
  `maxUsesPerUser >= 1`; `startsAt < expiresAt` when both set.
- RLS: promotions/usages are platform-managed, no fleet scoping → NO RLS policies (like fleets);
  services use the system path. Passenger reads go through the system path with no user input
  beyond the code string (target membership checked app-side, no oracle).
- No audit logging for passenger apply (high-volume); platform create/update/expire → audit log
  (actor + code).

## Scenarios

1. Create FIXED code → 201 with targetUserIds echoed; non-FIXED type → 400; non-positive value → 422.
2. Checkout with valid global code → 201, `discountAmount` correct, `promoCode` snapshot stored,
   usage row written; second checkout same user+code → 422 `PROMO_ALREADY_USED`.
3. Global code usable by a second user → 201 (each user once).
4. Expired code at checkout → 201 at FULL price, `promoStatus: EXPIRED`, no usage row.
5. Exhausted `maxTotalUses` → 422 `PROMO_EXHAUSTED`.
6. `PROMO_ENFORCE_ONCE_PER_USER=false` → same user can reuse until total cap.
7. Validate endpoint previews discount without writes.
8. Force-expire → subsequent checkout ignores code at full price.
9. Usage dashboard lists per-user consumption rows.
