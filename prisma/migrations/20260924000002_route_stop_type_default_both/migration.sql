-- Spec 006 follow-up, correction: the database default must stay BOTH.
-- 20260924000001 moved it to BOARDING, which silently changed the semantics
-- of system-path rows created without an explicit stopType (e.g. landing
-- stops) and broke the passenger-booking contract. New API writes are still
-- restricted to BOARDING | LANDING at the DTO layer; the default is only a
-- legacy backstop until the production BOTH backfill lands.

-- AlterTable
ALTER TABLE "route_stations" ALTER COLUMN "stop_type" SET DEFAULT 'BOTH';
