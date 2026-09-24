# Tasks: 010 Booking Enhancements

- [x] Spec 010 written
- [x] RED: `src/bookings/booking-limits.spec.ts` (6 tests)
- [x] Schema: `User.maxBookingSeats?`, `Booking.bookingFor` (default SELF), `Booking.note?`
- [x] Migration `20260924000006_booking_enhancements` (local-first; deployed local + test)
- [x] GREEN: limit enforced in booking tx (`BOOKING_SEAT_LIMIT_EXCEEDED`); OTHER requires name+phone, resolves account by phone or null; SELF snapshots from account; note persisted; responses (create/list/detail) carry bookingFor/note/passengerUserId
- [x] Users admin: `maxBookingSeats` in UpdateUserDto (DTO guards type; service enforces ≥1 with `INVALID_BOOKING_SEAT_LIMIT`); `SafeUser` gains override + `effectiveMaxBookingSeats`
- [x] Admin list/detail DTOs carry bookingFor/note (+ detail gains snapshot/stop scalars it was missing)
- [x] E2E `test/booking-enhancements.e2e-spec.ts` (6 tests incl. phone-change/reuse snapshot scenario)
- [x] `typecheck + lint + test` (266 unit) green; `docs:generate` regenerated
- [x] Dashboard: user limit editor (default/override/effective), booking detail snapshot block, error codes
- [ ] Follow-up: prod deploy of migration `...00006`; traveler-vs-booker notification routing lands with Release 6
