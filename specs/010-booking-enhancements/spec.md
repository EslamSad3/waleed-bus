# Feature Specification: Booking Enhancements (Limits, For-Other, Note)

**Feature Branch**: `feature/waleed-call-requirements`

**Created**: 2026-09-24

**Status**: Draft

**Input**: Call requirements plan `waleed-bus-implementation-plan.md` §§27–38, 87–88, 96, 101.

## Decisions

- Platform default max seats = 5 (`PLATFORM_DEFAULT_MAX_BOOKING_SEATS`; no config model exists — a constant documented in code; dashboard displays it as the default).
- `User.maxBookingSeats` nullable override; effective = override ?? 5. Enforced **inside** the booking transaction (`BOOKING_SEAT_LIMIT_EXCEEDED`, 422) alongside the existing capacity check.
- `Booking.bookingFor` SELF|OTHER (default SELF); `Booking.note` nullable (≤1000 chars), visible wherever booking details are authorized (passenger item, admin detail).
- SELF: snapshot from the account (existing behavior preserved); client-supplied name/phone ignored.
- OTHER: requires `passengerName` + `passengerPhone`; `passengerUserId` resolved to the active account with that phone when one exists, else null. Booking still works without an account.
- Snapshot semantics unchanged (plain columns written at booking time; later phone changes/reuse never rewrite history) — covered by a dedicated e2e scenario.
- Notification routing to the traveler (vs booker) lands with Release 6 (notifications don't exist yet).
- Existing concurrency protection untouched; new validations run inside the same transaction before seat reservation.

## Scenarios (§111–114)

1. Default user: book 5 → success; book 6 → `BOOKING_SEAT_LIMIT_EXCEEDED`.
2. Override 8: book 8 → success; 9 → rejected. Override 1 works.
3. SELF: `passengerUserId` = actor; snapshot = account values.
4. OTHER with account phone: `passengerUserId` = other user; snapshot = submitted values.
5. OTHER without account: `passengerUserId` null; booking works.
6. OTHER missing name/phone → 400.
7. Phone-change scenario: A books with phone X → A changes to Y → B registers X → old booking still shows X.
8. Invalid boarding/landing combos → existing `INVALID_TRIP_STOPS` (unchanged).
9. Admin sets per-user override via user update; user payloads expose override + effective limit.
