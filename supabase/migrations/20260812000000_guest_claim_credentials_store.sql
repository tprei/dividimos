-- Issue #581 (store foundation): replace the plaintext, group-readable
-- expense_guests.claim_token bearer with an opaque, creator-issued
-- credential stored only as a domain-separated SHA-256 digest in a
-- non-exposed, owner-only schema.
--
-- This migration is intentionally additive: it installs the credential
-- store, its owner-only generator/digest/lookup helpers, and hardens
-- expense_guests claim-state transitions. It changes no public behavior:
-- the legacy uuid claim_token column and the uuid claim_guest_spot
-- signature remain until the cutover migration. No application caller can
-- read or write guest_credentials -- it grants nothing to any API role,
-- carries no RLS policies, and is absent from Realtime.
--
-- The later guest-credential-rpcs migration installs issue_guest_claim_token
-- / resolve_guest_claim_token / claim_guest_spot(text) and drops the uuid
-- overload; the final drop-legacy migration removes the claim_token column.

-- ============================================================
-- 1. pgcrypto preflight. pgcrypto must live in the `extensions` schema
--    (the repository convention; every function body is schema-qualified
--    and runs with search_path = '').
-- ============================================================
DO $$
DECLARE
  v_schema text;
BEGIN
  SELECT n.nspname
    INTO v_schema
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'pgcrypto';

  IF v_schema IS NULL THEN
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
  ELSIF v_schema <> 'extensions' THEN
    RAISE EXCEPTION 'pgcrypto installed in unexpected schema %', v_schema;
  END IF;
END $$;

-- Assert the exact callables exist before any function body references them.
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'extensions.gen_random_bytes(integer) not found';
  END IF;
  IF pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'extensions.digest(bytea,text) not found';
  END IF;
END $$;

-- ============================================================
-- 2. Non-exposed credential schema + digest table.
-- ============================================================
CREATE SCHEMA IF NOT EXISTS guest_credentials AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA guest_credentials
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS guest_credentials.expense_guest_claim_tokens (
  guest_id         uuid        PRIMARY KEY
    REFERENCES public.expense_guests(id) ON DELETE CASCADE,
  token_version    smallint    NOT NULL CHECK (token_version = 1),
  token_generation integer     NOT NULL CHECK (token_generation > 0),
  token_digest     bytea       NOT NULL CHECK (octet_length(token_digest) = 32),
  issued_at        timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS expense_guest_claim_tokens_digest_uq
  ON guest_credentials.expense_guest_claim_tokens(token_digest);

ALTER TABLE guest_credentials.expense_guest_claim_tokens ENABLE ROW LEVEL SECURITY;
-- No RLS policies: the table is owner-only. Definer functions owned by
-- postgres are the sole read/write path.
REVOKE ALL ON TABLE guest_credentials.expense_guest_claim_tokens
  FROM PUBLIC, anon, authenticated, service_role;

-- The credential table is never part of the Realtime publication: it lives
-- in a schema that grants no USAGE to any API role, is never the target of
-- an `ALTER PUBLICATION ... ADD TABLE`, and supabase_realtime is a per-table
-- publication (not FOR ALL TABLES), so the table is never auto-published.

-- ============================================================
-- 3. Owner-only helpers: generator, digest, lookup.
--    Each is SECURITY DEFINER SET search_path = '' and grants EXECUTE to
--    no API role. The later issue/resolve/claim RPCs are the only callers.
-- ============================================================

-- Sole CSPRNG + base64url formatting point. Emits the canonical
-- 'gst1_' + 43 unpadded base64url chars (32 random bytes).
CREATE OR REPLACE FUNCTION guest_credentials.generate_guest_claim_token()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT 'gst1_' || pg_catalog.translate(
    pg_catalog.rtrim(pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), '='),
    '+/', '-_')
$$;
REVOKE ALL ON FUNCTION guest_credentials.generate_guest_claim_token()
  FROM PUBLIC, anon, authenticated, service_role;

-- Sole validation + domain-separated SHA-256 hashing point. Rejects
-- anything that is not exactly the canonical 48-byte v1 token. No trimming,
-- case folding, or URL decoding: a malformed input is PST02, never a hash.
CREATE OR REPLACE FUNCTION guest_credentials.guest_claim_token_digest(p_claim_token text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_claim_token IS NULL
     OR char_length(p_claim_token) <> 48
     OR p_claim_token !~ '^gst1_[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_token_format';
  END IF;
  RETURN extensions.digest(
    pg_catalog.convert_to('dividimos-guest-claim-v1:' || p_claim_token, 'UTF8'),
    'sha256');
END;
$$;
REVOKE ALL ON FUNCTION guest_credentials.guest_claim_token_digest(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Sole indexed lookup. Calls the digest helper (so PST02 propagates), then
-- resolves guest/expense/group + the stored digest/generation. Validates the
-- found row's version/digest-length/generation AFTER the lookup, raising
-- PST07 for a corrupt matching digest -- never folding token_version = 1
-- into the WHERE predicate, which would silently report corruption as a miss.
-- A well-formed miss returns zero rows. Never returns token text or profiles.
CREATE OR REPLACE FUNCTION guest_credentials.lookup_guest_claim_token(p_claim_token text)
RETURNS TABLE (
  guest_id         uuid,
  expense_id       uuid,
  group_id         uuid,
  token_digest     bytea,
  token_generation integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_digest bytea := guest_credentials.guest_claim_token_digest(p_claim_token);
  v_found  RECORD;
BEGIN
  SELECT t.guest_id, t.token_version, octet_length(t.token_digest) AS digest_len,
         t.token_generation, t.token_digest,
         eg.expense_id, e.group_id
    INTO v_found
    FROM guest_credentials.expense_guest_claim_tokens t
    JOIN public.expense_guests eg ON eg.id = t.guest_id
    JOIN public.expenses e        ON e.id = eg.expense_id
   WHERE t.token_digest = v_digest;

  IF NOT FOUND THEN
    RETURN;  -- zero rows: well-formed miss
  END IF;

  IF v_found.token_version <> 1
     OR v_found.digest_len <> 32
     OR v_found.token_generation IS NULL
     OR v_found.token_generation <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'credential_state_corrupt';
  END IF;

  RETURN QUERY
  SELECT v_found.guest_id, v_found.expense_id, v_found.group_id,
         v_found.token_digest, v_found.token_generation;
END;
$$;
REVOKE ALL ON FUNCTION guest_credentials.lookup_guest_claim_token(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 4. expense_guests claim-state hardening.
-- ============================================================

-- claimed_by and claimed_at must always agree (both null or both set).
ALTER TABLE public.expense_guests
  DROP CONSTRAINT IF EXISTS expense_guests_claim_state_consistent;
ALTER TABLE public.expense_guests
  ADD CONSTRAINT expense_guests_claim_state_consistent
  CHECK ((claimed_by IS NULL) = (claimed_at IS NULL));

-- Replacing ON DELETE SET NULL with NO ACTION DEFERRABLE INITIALLY DEFERRED:
-- a consumed guest must never be silently reset to unclaimed (that would
-- allow a second claim). Account teardown must delete the protected
-- group/expense/guest graph first; the deferrable FK fails at commit if not.
ALTER TABLE public.expense_guests
  DROP CONSTRAINT IF EXISTS expense_guests_claimed_by_fkey;
ALTER TABLE public.expense_guests
  ADD CONSTRAINT expense_guests_claimed_by_fkey
  FOREIGN KEY (claimed_by) REFERENCES public.users(id)
  ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

-- Monotonic claim transition: null/null may become non-null/non-null exactly
-- once (through the trusted claim RPC); once claimed, claimed_by/claimed_at
-- are immutable. No auth.uid() bypass. Direct guest DML is revoked in the
-- final cutover migration; this trigger is the shape/monotonicity backstop.
CREATE OR REPLACE FUNCTION guest_credentials.enforce_expense_guest_claim_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.claimed_by IS NOT NULL OR NEW.claimed_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'claim_state_corrupt';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.claimed_by IS NULL THEN
    -- Allow null/null to stay, or a single transition to both non-null.
    IF (NEW.claimed_by IS NULL) <> (NEW.claimed_at IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'claim_state_corrupt';
    END IF;
    RETURN NEW;
  END IF;

  -- Already claimed: both columns are immutable.
  IF NEW.claimed_by IS NOT DISTINCT FROM OLD.claimed_by
     AND NEW.claimed_at IS NOT DISTINCT FROM OLD.claimed_at THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'claim_state_corrupt';
END;
$$;
REVOKE ALL ON FUNCTION guest_credentials.enforce_expense_guest_claim_transition()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_expense_guest_claim_transition ON public.expense_guests;
CREATE TRIGGER enforce_expense_guest_claim_transition
  BEFORE INSERT OR UPDATE ON public.expense_guests
  FOR EACH ROW EXECUTE FUNCTION guest_credentials.enforce_expense_guest_claim_transition();
