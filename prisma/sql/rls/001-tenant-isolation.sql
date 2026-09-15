-- ============================================================================
-- Tenant isolation foundation (RLS) — applied by scripts/db-setup-rls.ts
-- as the privileged owner. Idempotent: safe to re-run.
--
-- Design (see docs/ARCHITECTURE.md):
--  * Normal tenant request paths connect as role `app_tenant` (non-owner,
--    no BYPASSRLS). RLS is enforced for it on every table below.
--  * The table owner (DIRECT_URL) is the explicitly privileged system path
--    used only by migrations, seed, and super-admin platform endpoints.
--    FORCE ROW LEVEL SECURITY is intentionally NOT used, otherwise the
--    privileged owner path itself would break.
--  * Tenant context travels via transaction-local settings set by the API
--    inside each request transaction:
--      app.user_id  -> authenticated user uuid
--      app.fleet_id -> authorized fleet uuid
--    Missing/empty settings evaluate to NULL -> policies fail CLOSED.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Baseline hardening
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 1. Helper functions (SECURITY DEFINER, pinned search_path)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.is_fleet_member(p_user_id uuid, p_fleet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.fleet_members fm
    JOIN public.users u ON u.id = fm.user_id
    WHERE fm.user_id = p_user_id
      AND fm.fleet_id = p_fleet_id
      AND fm.status = 'ACTIVE'
      AND u.is_active
  );
$$;

CREATE OR REPLACE FUNCTION app.has_global_role(p_user_id uuid, p_role_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.slug = p_role_slug
      AND r.is_active
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Helpers to keep policy creation idempotent
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.__set_policy(p_table text, p_name text, p_ddl text)
RETURNS void
LANGUAGE plpgsql
SET search_path = app, public
AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_name, p_table);
  EXECUTE p_ddl;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Fleet-owned entity tables: policies keyed on fleet_id + membership
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['buses', 'trips', 'bookings', 'bus_assignments', 'passenger_reports'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    PERFORM app.__set_policy(t, 'tenant_isolation', format($ddl$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL
        USING (
          fleet_id = NULLIF(current_setting('app.fleet_id', true), '')::uuid
          AND app.is_fleet_member(NULLIF(current_setting('app.user_id', true), '')::uuid, fleet_id)
        )
        WITH CHECK (
          fleet_id = NULLIF(current_setting('app.fleet_id', true), '')::uuid
          AND app.is_fleet_member(NULLIF(current_setting('app.user_id', true), '')::uuid, fleet_id)
        )
    $ddl$, t));
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Identity & membership tables
-- ---------------------------------------------------------------------------
-- users: a request may only see/update its own identity row
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS self_rows ON public.users;
CREATE POLICY self_rows ON public.users
  FOR ALL
  USING (id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- sessions: only the owning user may see their sessions (writes via system path)
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS self_rows ON public.sessions;
CREATE POLICY self_rows ON public.sessions
  FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- fleet_members: see own rows or rows of fleets you belong to;
-- writes require an ACTIVE membership in the target fleet (app layer checks
-- the members.manage permission on top of this).
ALTER TABLE public.fleet_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS member_rows ON public.fleet_members;
CREATE POLICY member_rows ON public.fleet_members
  FOR ALL
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR app.is_fleet_member(NULLIF(current_setting('app.user_id', true), '')::uuid, fleet_id)
  )
  WITH CHECK (
    app.is_fleet_member(NULLIF(current_setting('app.user_id', true), '')::uuid, fleet_id)
    OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

-- fleets: readable if you hold a membership row in them (writes via system path)
ALTER TABLE public.fleets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS member_fleets ON public.fleets;
CREATE POLICY member_fleets ON public.fleets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.fleet_members fm
      WHERE fm.fleet_id = fleets.id
        AND fm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );

-- global role assignments: self rows only (writes via system path)
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS self_rows ON public.user_roles;
CREATE POLICY self_rows ON public.user_roles
  FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- phone_verification_challenges: self rows only
ALTER TABLE public.phone_verification_challenges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS self_challenges ON public.phone_verification_challenges;
CREATE POLICY self_challenges ON public.phone_verification_challenges
  FOR ALL
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- user_auth_providers: self rows only
ALTER TABLE public.user_auth_providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS self_providers ON public.user_auth_providers;
CREATE POLICY self_providers ON public.user_auth_providers
  FOR ALL
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- trip_shares: readable/writable by members of the fleet owning the underlying booking
ALTER TABLE public.trip_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_shares ON public.trip_shares;
CREATE POLICY booking_shares ON public.trip_shares
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = trip_shares.booking_id
        AND b.fleet_id = NULLIF(current_setting('app.fleet_id', true), '')::uuid
        AND app.is_fleet_member(NULLIF(current_setting('app.user_id', true), '')::uuid, b.fleet_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = trip_shares.booking_id
        AND b.fleet_id = NULLIF(current_setting('app.fleet_id', true), '')::uuid
        AND app.is_fleet_member(NULLIF(current_setting('app.user_id', true), '')::uuid, b.fleet_id)
    )
  );

-- throttle_counters: internal system rate-limiting only, locked out from tenant role
ALTER TABLE public.throttle_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS system_only ON public.throttle_counters;
CREATE POLICY system_only ON public.throttle_counters
  FOR ALL
  USING (false);

-- ---------------------------------------------------------------------------
-- 5. RBAC reference data: readable by any authenticated context,
--    writable only through the privileged system path.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roles', 'permissions', 'role_permissions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    PERFORM app.__set_policy(t, 'authenticated_read', format($ddl$
      CREATE POLICY authenticated_read ON public.%I
        FOR SELECT
        USING (
          NULLIF(current_setting('app.user_id', true), '') IS NOT NULL
        )
    $ddl$, t));
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Audit log: insert-only for the tenant role; reading is a
--    platform-administration concern served by the system path.
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS insert_own ON public.audit_logs;
CREATE POLICY insert_own ON public.audit_logs
  FOR INSERT
  WITH CHECK (actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- 7. Grants for app_tenant (least privilege; owner keeps full control)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public, app TO app_tenant;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_tenant;

GRANT SELECT ON public.users TO app_tenant;
GRANT UPDATE (name, picture) ON public.users TO app_tenant;

GRANT SELECT ON public.sessions, public.user_roles TO app_tenant;
GRANT SELECT ON public.roles, public.permissions, public.role_permissions TO app_tenant;
GRANT SELECT ON public.fleets TO app_tenant;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_members TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.buses, public.trips, public.bookings TO app_tenant;
-- Stops and trip lines are platform-owned catalog data, never tenant-scoped.
REVOKE ALL ON public.lines, public.routes, public.stations, public.route_stations FROM app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_shares TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.phone_verification_challenges, public.user_auth_providers TO app_tenant;

-- Spec 003: assignments are written by owner assignment flows (INSERT + status
-- updates; no service path deletes — the DELETE grant keeps the family
-- uniform). Reports are append-only: drivers INSERT, owners SELECT.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bus_assignments TO app_tenant;
GRANT SELECT, INSERT ON public.passenger_reports TO app_tenant;

GRANT INSERT ON public.audit_logs TO app_tenant;

-- ---------------------------------------------------------------------------
-- 8. Status domain constraints (application-layer tokens, enforced in DB too)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fleet_members_status_check') THEN
    ALTER TABLE public.fleet_members
      ADD CONSTRAINT fleet_members_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trips_status_check') THEN
    ALTER TABLE public.trips
      ADD CONSTRAINT trips_status_check CHECK (status IN ('SCHEDULED', 'DEPARTED', 'COMPLETED', 'CANCELLED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_status_check') THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_status_check CHECK (status IN ('CONFIRMED', 'CANCELLED'));
  END IF;
  ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check;
  ALTER TABLE public.bookings ADD CONSTRAINT bookings_payment_status_check CHECK (payment_status IS NULL OR payment_status IN ('PENDING', 'PAID', 'CANCELLED', 'REFUND_PENDING', 'UNPAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED'));
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'passenger_reports_status_check') THEN
    ALTER TABLE public.passenger_reports
      ADD CONSTRAINT passenger_reports_status_check CHECK (status IN ('PENDING', 'RESOLVED', 'DISMISSED'));
  END IF;
END $$;
