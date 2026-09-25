-- Spec 011/012 hardening (review round 4):
-- 1. promotion_targets.user_id -> users(id) ON DELETE CASCADE, so a targeted
--    promotion can never reference a nonexistent user. Orphan rows (writes
--    from before existence validation) reference users that can never redeem
--    and are dropped first; the service now validates targets pre-write.
-- 2. notifications.trip_id / promotion_id ON DELETE SET NULL -> RESTRICT, so
--    the notifications_ref_check CHECK can never observe a nulled reference.
--    Trips use soft lifecycle (status) and promotions are expired, never
--    hard-deleted, so RESTRICT matches the application contract.

-- 1. Drop dead targeting rows, then enforce the FK.
DELETE FROM "promotion_targets" pt
WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u.id = pt.user_id);

ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. SET NULL -> RESTRICT on notification references.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_trip_id_fkey";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_trip_id_fkey"
  FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notifications" DROP CONSTRAINT "notifications_promotion_id_fkey";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_promotion_id_fkey"
  FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
