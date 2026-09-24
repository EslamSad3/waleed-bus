-- Spec 011 follow-up: traveler-vs-booker routing (booker account on every booking).
ALTER TABLE "bookings" ADD COLUMN "booked_by_user_id" UUID;
