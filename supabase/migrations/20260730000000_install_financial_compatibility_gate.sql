-- ============================================================
-- Issue #477 preparatory migration: financial compatibility gate.
--
-- Per the #477 spec's "Compatibility and maintenance gate" section,
-- the eventual invariant cutover (fee-basis-point rename, graph_revision
-- CAS, mutation-token trigger guards) is a breaking schema change that
-- an already-running old application build must never observe mid-write.
-- The spec requires two forward migrations, not a prose-only flag:
--
--   1. (this migration) install a private financial_internal schema,
--      an owner-only compatibility-state singleton, and a preparatory
--      auth.users BEFORE DELETE gate that blocks account deletion while
--      the deployment operator has flagged financial maintenance.
--   2. (future migration) the full invariant cutover, deployed only
--      after this preparatory migration is live/verified in production
--      and the operator has drained/reopened through the gate below.
--
-- financial_internal is never exposed to PostgREST: the schema and every
-- object in it are revoked from PUBLIC/anon/authenticated/service_role.
-- The only entry points are SECURITY DEFINER functions restricted to the
-- table owner (called from a privileged, non-PostgREST database
-- connection by the deployment operator, matching the spec's "trusted
-- account-delete control-plane" language) and the BEFORE DELETE trigger
-- itself, which runs as that same owner regardless of caller.
--
-- Advisory lock 477000001 is a fixed, single-purpose key: the trigger
-- takes it SHARED for the lifetime of every in-flight auth.users
-- deletion (so a deletion already past this gate finishes its cascade
-- undisturbed), while the maintenance setter takes it EXCLUSIVE before
-- flipping the flag, so it blocks until every already-admitted deletion
-- has drained and any deletion that arrives after closure re-reads
-- maintenance = true and is rejected with PST09.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS financial_internal;

REVOKE ALL ON SCHEMA financial_internal FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE financial_internal.financial_compatibility_state (
  id boolean PRIMARY KEY CHECK (id),
  maintenance boolean NOT NULL,
  required_schema_version int4 NOT NULL CHECK (required_schema_version >= 1),
  minimum_native_version_code int4 NOT NULL CHECK (minimum_native_version_code >= 1),
  updated_at timestamptz NOT NULL
);

ALTER TABLE financial_internal.financial_compatibility_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON financial_internal.financial_compatibility_state
  FROM PUBLIC, anon, authenticated, service_role;

-- Effective pre-cutover baseline: no maintenance, schema version 1 (the
-- current, pre-#477 shape), native version code 1 (android/app/build.gradle
-- versionCode as of this migration). The future invariant migration is the
-- only migration permitted to advance required_schema_version /
-- minimum_native_version_code.
INSERT INTO financial_internal.financial_compatibility_state
  (id, maintenance, required_schema_version, minimum_native_version_code, updated_at)
VALUES (true, false, 1, 1, pg_catalog.now());

-- Owner-only maintenance setter. Never GRANTed to any role: only a
-- privileged direct database connection (the table owner or a superuser)
-- can invoke it, which is the deployment operator's control-plane
-- connection, never the application via PostgREST.
CREATE OR REPLACE FUNCTION financial_internal.set_financial_maintenance(p_maintenance boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(477000001::bigint);

  UPDATE financial_internal.financial_compatibility_state
  SET maintenance = p_maintenance,
      updated_at = pg_catalog.now()
  WHERE id = true;
END;
$$;

REVOKE ALL ON FUNCTION financial_internal.set_financial_maintenance(boolean)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION financial_internal.set_financial_maintenance(boolean) IS
  'Issue #477 preparatory gate: owner-only maintenance flag setter. Takes '
  'advisory lock 477000001 EXCLUSIVE, so it blocks until every auth.users '
  'deletion already admitted through the gate below has drained.';

-- Preparatory auth.users BEFORE DELETE gate. This is the ONLY BEFORE
-- DELETE trigger on auth.users; its name is prefixed so it remains
-- lexically first if a future migration adds sibling BEFORE DELETE
-- triggers on this table. The future invariant migration performs an
-- in-place, same-identity, same-order redefinition of this function body
-- (adding the account-teardown inventory/lock work) without renaming the
-- trigger, preserving firing order.
CREATE OR REPLACE FUNCTION financial_internal.auth_users_teardown_maintenance_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_maintenance boolean;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(477000001::bigint);

  SELECT maintenance INTO v_maintenance
  FROM financial_internal.financial_compatibility_state
  WHERE id = true;

  IF v_maintenance THEN
    RAISE EXCEPTION USING ERRCODE = 'PST09', MESSAGE = 'financial_maintenance';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION financial_internal.auth_users_teardown_maintenance_gate()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION financial_internal.auth_users_teardown_maintenance_gate() IS
  'Issue #477 preparatory gate: blocks auth.users deletion (and its '
  'public.users ON DELETE CASCADE) while financial maintenance is active. '
  'Holds advisory lock 477000001 SHARED for the deletion''s full '
  'transaction so an already-admitted deletion always finishes its cascade.';

DROP TRIGGER IF EXISTS "000_financial_maintenance_gate" ON auth.users;
CREATE TRIGGER "000_financial_maintenance_gate"
  BEFORE DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION financial_internal.auth_users_teardown_maintenance_gate();

COMMENT ON TABLE financial_internal.financial_compatibility_state IS
  'Issue #477: owner-only singleton read by the deployment operator''s '
  'signed compatibility manifest (see src/app/api/runtime/financial-compatibility) '
  'and by the auth.users teardown gate above. Never exposed to PostgREST.';
