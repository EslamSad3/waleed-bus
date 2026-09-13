-- Role-specific profile fields. They remain nullable at the shared-user level;
-- fleet-owner and driver onboarding DTOs enforce their own required fields.
ALTER TABLE "users"
ADD COLUMN "nickname" VARCHAR(100),
ADD COLUMN "national_id" VARCHAR(14);

CREATE UNIQUE INDEX "users_national_id_key" ON "users"("national_id");

-- `fleet_owner` is the canonical tenant role used by auth and authorization.
-- Move any memberships/global grants created by the legacy `fleet-owner` seed
-- before removing that duplicate role.
UPDATE "fleet_members" fm
SET "role_id" = canonical."id"
FROM "roles" legacy, "roles" canonical
WHERE legacy."slug" = 'fleet-owner'
  AND canonical."slug" = 'fleet_owner'
  AND fm."role_id" = legacy."id";

DELETE FROM "user_roles" legacy_grant
USING "roles" legacy, "roles" canonical, "user_roles" canonical_grant
WHERE legacy."slug" = 'fleet-owner'
  AND canonical."slug" = 'fleet_owner'
  AND legacy_grant."role_id" = legacy."id"
  AND canonical_grant."role_id" = canonical."id"
  AND canonical_grant."user_id" = legacy_grant."user_id";

UPDATE "user_roles" ur
SET "role_id" = canonical."id"
FROM "roles" legacy, "roles" canonical
WHERE legacy."slug" = 'fleet-owner'
  AND canonical."slug" = 'fleet_owner'
  AND ur."role_id" = legacy."id";

DELETE FROM "roles" WHERE "slug" = 'fleet-owner';
