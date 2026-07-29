-- ============================================================
-- Grant anon/authenticated/service_role base table privileges in public.
--
-- Why this exists
-- ---------------
-- The app's own client code reads and writes public tables directly
-- through PostgREST as the authenticated user -- e.g.
--   src/app/app/bills/page.tsx            -> expenses, expense_shares
--   src/app/app/page.tsx                  -> balances
--   src/app/app/groups/[id]/page.tsx      -> expenses, settlements, balances, groups
--   src/components/group/group-detail-content.tsx -> (same)
--   src/components/groups/groups-list-content.tsx  -> groups, expenses
--   src/components/bill/recent-contacts.tsx        -> expense_shares, expense_payers
-- and the integration test suite's adminClient (service_role) reads/writes
-- the same tables for fixture setup and teardown. For any of these to
-- reach an RLS policy (or, for service_role, to act as the trusted
-- BYPASSRLS admin), the three PostgREST roles must first hold the base
-- table privileges.
-- A hosted Supabase project applies exactly these grants automatically
-- during project bootstrap; the local `supabase start` / `db reset`
-- bootstrap does not replay them for tables created by this repo's own
-- migrations, so locally all three roles end up with only
-- REFERENCES/TRIGGER/TRUNCATE and every DML statement returns
-- `permission denied for table X` (PostgreSQL 42501) before RLS is even
-- consulted.
--
-- This restores parity with hosted production.
--
-- Safety
-- ------
-- Every table in public has RLS enabled (verified). RLS is the
-- authorization layer that decides which rows anon/authenticated may see
-- or write; the table grant only lets a statement reach that layer.
-- Backend-only tables (expense_graph_save_operations,
-- settlement_operations, rate_limit_counters, the allocation plan
-- tables, etc.) have RLS on with zero policies, so anon/authenticated
-- still see and write nothing there. service_role is BYPASSRLS by
-- design (it is the trusted admin used by server code and tests).
-- This grant is therefore safe to apply broadly and cannot bypass:
--   * RLS for anon/authenticated (privilege check first, then RLS), or
--   * issue #477's expense-graph mutation-token guard (a trigger-level
--     check that runs for EVERY role including service_role, and whose
--     function-level REVOKEs on begin_expense_graph_direct_mutation
--     etc. are orthogonal to table-level DML grants).
--
-- ALTER DEFAULT PRIVILEGES covers tables added by future migrations.
-- ============================================================

-- Current tables: standard Supabase DML (SELECT/INSERT/UPDATE/DELETE) to
-- all three PostgREST roles, matching hosted Supabase's bootstrap.
-- Deliberately NOT TRUNCATE/REFERENCES/TRIGGER/MAINTAIN (those are
-- already present / owner-only).
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO anon, authenticated, service_role;

-- Future tables created in public by later migrations inherit the same.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
