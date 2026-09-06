-- 002-supabase-api-lockout.sql
-- The Supabase Data API (PostgREST) must never be a data path: this API's
-- contract is exclusively the NestJS service connecting as `app_tenant`
-- (RLS-enforced) or the owner for migrations/platform admin.
--
-- Supabase provisions default privileges that expose public-schema tables to
-- its API roles; `service_role` additionally holds BYPASSRLS. Revoke all of it.
-- Guarded so this is a no-op on plain PostgreSQL where the roles don't exist.
-- Idempotent: re-run after migrations adds tables (or just re-run db:setup-rls).

DO $$
DECLARE
  t text;
  api_roles text := 'anon, authenticated, service_role';
  has_api_roles boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')
  ) INTO has_api_roles;
  IF NOT has_api_roles THEN
    RAISE NOTICE 'no Supabase API roles present — nothing to revoke';
    RETURN;
  END IF;

  -- Every current application table.
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %s', t, api_roles);
  END LOOP;

  -- Sequences too (id/serial successors), for completeness.
  FOR t IN
    SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM %s', t, api_roles);
  END LOOP;

  -- Cut schema reachability so PostgREST cannot even introspect `public`,
  -- and block the app helper functions in schema `app`.
  EXECUTE format('REVOKE USAGE ON SCHEMA public FROM %s', api_roles);
  EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM %s', api_roles);
  EXECUTE format('REVOKE USAGE ON SCHEMA app FROM %s', api_roles);

  -- Keep future tables created by the owner (migrations run as `postgres`)
  -- locked out of the Data API as well.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role';
END $$;
