-- Issue #475: harden the rate-limit primitive before any route spends it.
--
-- Two defects in the existing SECURITY DEFINER RPC make it unsafe to guard a
-- paid boundary:
--
--   1. Cold-start race: `increment_rate_limit` performs a `SELECT ... FOR
--      UPDATE` that finds no row, then an `INSERT ... ON CONFLICT DO UPDATE`.
--      PostgreSQL does not gap-lock an absent row, so two concurrent
--      transactions for a brand-new (bucket, subject) can both pass the
--      SELECT and both be admitted at count 1. The over-limit branch also
--      `RAISE`s, rolling back the increment, so a rejected attempt is never
--      recorded — an attacker who always loses the race never gets counted.
--   2. Both prior migrations grant EXECUTE to service_role without first
--      revoking PostgreSQL's default PUBLIC EXECUTE grant. Because `public`
--      is exposed through PostgREST, an untrusted client can currently call
--      `increment_rate_limit` directly with a victim's (bucket, subject) and
--      an attacker-chosen window/limit, resetting or manipulating another
--      user's counter.
--
-- This migration replaces the function body with one atomic
-- `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` statement (no
-- preliminary SELECT, no branch that rolls back), changes its return type
-- from `integer` to `boolean` (a bare true/false decision, no message
-- parsing), and locks every object down to `service_role` only.
--
-- Forward-only: does not edit 20260516160000_rate_limit_counters.sql or
-- 20260518010000_rate_limit_ttl_cleanup.sql (see #478).

-- ============================================================
-- 1. Lock the table before any normalization, constraint, function, or ACL
--    change. This is the very first statement in the transaction so the
--    still-public old function cannot race the cleanup/constraint below.
-- ============================================================
BEGIN;

LOCK TABLE public.rate_limit_counters IN ACCESS EXCLUSIVE MODE;

-- ============================================================
-- 2. Normalize existing rows to the new bounded contract before adding the
--    checks that would otherwise reject them.
-- ============================================================

-- Delete keys the supported wrapper can never produce (blank or over the
-- new byte bounds). These rows are unreachable garbage, not live counters.
DELETE FROM public.rate_limit_counters
 WHERE btrim(bucket) = ''
    OR btrim(subject) = ''
    OR octet_length(bucket) > 64
    OR octet_length(subject) > 512;

-- Clamp any impossible preexisting count to the new saturated-rejected
-- sentinel (1001), preserving window_start so every remaining supported
-- limit (max 1000) still fails closed for that window.
UPDATE public.rate_limit_counters
   SET count = 1001
 WHERE count < 1 OR count > 1001;

-- ============================================================
-- 3. Add named bounded checks.
-- ============================================================

ALTER TABLE public.rate_limit_counters
  ADD CONSTRAINT rate_limit_counters_bucket_bounds
    CHECK (btrim(bucket) <> '' AND octet_length(bucket) BETWEEN 1 AND 64),
  ADD CONSTRAINT rate_limit_counters_subject_bounds
    CHECK (btrim(subject) <> '' AND octet_length(subject) BETWEEN 1 AND 512),
  ADD CONSTRAINT rate_limit_counters_count_bounds
    CHECK (count BETWEEN 1 AND 1001);

-- ============================================================
-- 4. Replace increment_rate_limit with the atomic boolean contract.
--
-- PostgreSQL cannot change a function's return type with CREATE OR REPLACE,
-- so this drops and recreates it inside the same migration transaction.
-- DROP FUNCTION deliberately omits CASCADE: any unexpected dependent object
-- must stop this migration, not be silently swept away.
-- ============================================================

DROP FUNCTION public.increment_rate_limit(text, text, integer, integer);

CREATE FUNCTION public.increment_rate_limit(
  p_bucket          text,
  p_subject         text,
  p_limit           integer,
  p_window_seconds  integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now   timestamptz := now();
  v_count integer;
BEGIN
  -- Validate before any cleanup or counter mutation. SQL is the trust
  -- boundary: the TypeScript wrapper performs the same checks first, but
  -- this function must not trust any caller.
  IF p_bucket IS NULL OR btrim(p_bucket) = '' OR octet_length(p_bucket) > 64
     OR p_subject IS NULL OR btrim(p_subject) = '' OR octet_length(p_subject) > 512
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1000
     OR p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400
  THEN
    RAISE EXCEPTION 'invalid_rate_limit_arguments' USING ERRCODE = '22023';
  END IF;

  -- Probabilistic cleanup: ~0.1% of calls purge stale rows (> 24 hours old).
  -- Runs only after argument validation, through the trusted function owner.
  IF random() < 0.001 THEN
    DELETE FROM public.rate_limit_counters
     WHERE window_start < v_now - INTERVAL '24 hours';
  END IF;

  -- One atomic UPSERT: no preliminary SELECT, so there is no absent-row gap
  -- for a second cold-start transaction to race into. The primary key
  -- constraint itself serializes concurrent inserts for the same key.
  INSERT INTO public.rate_limit_counters AS counters (bucket, subject, window_start, count)
  VALUES (p_bucket, p_subject, v_now, 1)
  ON CONFLICT (bucket, subject) DO UPDATE
    SET window_start =
          CASE
            WHEN counters.window_start <= v_now - (p_window_seconds * interval '1 second')
              THEN v_now
            ELSE counters.window_start
          END,
        count =
          CASE
            WHEN counters.window_start <= v_now - (p_window_seconds * interval '1 second')
              THEN 1
            WHEN counters.count < 1 OR counters.count >= p_limit
              THEN p_limit + 1
            ELSE counters.count + 1
          END
  RETURNING counters.count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

-- ============================================================
-- 5. Pin owner/search_path on the cleanup RPC too (behavior/signature
--    unchanged, only ownership and grants tighten).
-- ============================================================

ALTER FUNCTION public.cleanup_expired_rate_limit_counters() OWNER TO postgres;
ALTER FUNCTION public.cleanup_expired_rate_limit_counters() SET search_path = '';

-- ============================================================
-- 6. Privilege boundary. Revoke the default PUBLIC EXECUTE grant every
--    PostgreSQL function receives on creation before selectively granting
--    only to service_role.
-- ============================================================

ALTER FUNCTION public.increment_rate_limit(text, text, integer, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.increment_rate_limit(text, text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(text, text, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_expired_rate_limit_counters()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rate_limit_counters()
  TO service_role;

REVOKE ALL ON TABLE public.rate_limit_counters
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rate_limit_counters
  TO service_role;

-- ============================================================
-- 7. Reload PostgREST's schema cache so it observes the new boolean return
--    type and ACL contract at commit.
-- ============================================================

NOTIFY pgrst, 'reload schema';

COMMIT;
