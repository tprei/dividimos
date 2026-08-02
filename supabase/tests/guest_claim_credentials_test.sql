-- Issue #581: catalog contract for the guest-claim credential store.
-- Asserts the non-exposed boundary: the guest_credentials schema and its
-- table/helpers grant nothing to any API role, carry no RLS policies, are
-- absent from Realtime, and every function is owner-controlled
-- SECURITY DEFINER with search_path pinned. Queries the live catalog.
BEGIN;
SELECT plan(18);

-- Schema exists and grants no USAGE/CREATE to API roles.
SELECT has_schema('guest_credentials', 'guest_credentials schema exists');
SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, ARRAY[]::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'guest_credentials'
       AND r.rolname IN ('anon', 'authenticated', 'service_role')
       AND a.privilege_type = 'USAGE'
  ),
  'guest_credentials grants no USAGE to API roles'
);

-- Table exists, has RLS, no policies, no API-role privileges, not in Realtime.
SELECT has_table('guest_credentials', 'expense_guest_claim_tokens',
  'credential table exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class
     WHERE relname = 'expense_guest_claim_tokens'
       AND relnamespace = 'guest_credentials'::regnamespace),
  'credential table has RLS enabled'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'guest_credentials'
       AND tablename = 'expense_guest_claim_tokens'),
  0,
  'credential table has zero RLS policies'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.relname = 'expense_guest_claim_tokens'
       AND c.relnamespace = 'guest_credentials'::regnamespace
       AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
  ),
  'credential table grants no privileges to API roles'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'guest_credentials'
       AND tablename = 'expense_guest_claim_tokens'
  ),
  'credential table is not in supabase_realtime'
);
SELECT col_is_pk('guest_credentials', 'expense_guest_claim_tokens', 'guest_id',
  'credential table PK is guest_id');

-- Helpers exist with exact signatures.
SELECT has_function('guest_credentials', 'generate_guest_claim_token',
  ARRAY[]::text[], 'generate_guest_claim_token() exists');
SELECT has_function('guest_credentials', 'guest_claim_token_digest',
  ARRAY['text'], 'guest_claim_token_digest(text) exists');
SELECT has_function('guest_credentials', 'lookup_guest_claim_token',
  ARRAY['text'], 'lookup_guest_claim_token(text) exists');
SELECT has_function('guest_credentials', 'enforce_expense_guest_claim_transition',
  ARRAY[]::text[], 'enforce_expense_guest_claim_transition() exists');

-- No helper grants EXECUTE to authenticated or service_role (the table has no
-- business being callable by anyone but the postgres-owned RPCs).
SELECT ok(
  NOT has_function_privilege('authenticated',
    'guest_credentials.generate_guest_claim_token()', 'EXECUTE'),
  'authenticated cannot EXECUTE generate_guest_claim_token'
);
SELECT ok(
  NOT has_function_privilege('service_role',
    'guest_credentials.lookup_guest_claim_token(text)', 'EXECUTE'),
  'service_role cannot EXECUTE lookup_guest_claim_token'
);

-- Every helper is postgres-owned SECURITY DEFINER with search_path pinned.
SELECT ok(
  (SELECT bool_and(p.prosecdef
     AND p.proowner = 'postgres'::regrole
     AND p.proconfig IS NOT NULL
     AND 'search_path=""' = ANY(p.proconfig))
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'guest_credentials'
      AND p.proname IN (
        'generate_guest_claim_token', 'guest_claim_token_digest',
        'lookup_guest_claim_token', 'enforce_expense_guest_claim_transition')),
  'all four helpers are postgres-owned SECURITY DEFINER with search_path pinned'
);

-- Monotonic-claim trigger attached BEFORE INSERT OR UPDATE on expense_guests.
SELECT has_trigger('public', 'expense_guests', 'enforce_expense_guest_claim_transition',
  'expense_guests has the monotonic-claim trigger');

-- claimed_by FK is now NO ACTION DEFERRABLE.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'expense_guests_claimed_by_fkey'
       AND conrelid = 'public.expense_guests'::regclass
       AND confdeltype = 'a'   -- NO ACTION
       AND condeferrable
  ),
  'expense_guests_claimed_by_fkey is NO ACTION DEFERRABLE'
);

-- Claim-state consistency CHECK exists.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'expense_guests_claim_state_consistent'
       AND conrelid = 'public.expense_guests'::regclass
       AND contype = 'c'
  ),
  'expense_guests_claim_state_consistent CHECK exists'
);

SELECT * FROM finish();
ROLLBACK;
