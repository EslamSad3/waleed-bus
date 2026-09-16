-- Driver onboarding carries an operational display name, optional identity
-- reference, and profile image. These remain optional for passenger accounts.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "nickname" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "national_id" VARCHAR(14);
