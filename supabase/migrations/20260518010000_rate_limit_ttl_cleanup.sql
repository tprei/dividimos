-- TTL cleanup for rate_limit_counters.
--
-- Rows accumulate indefinitely when IP-keyed subjects are added (PR 2/3).
-- Two complementary cleanup mechanisms:
--
--   A) Probabilistic inline cleanup (0.1% chance per increment_rate_limit call)
--      — runs transparently inside the existing RPC; no external scheduling
--        needed, works on all Supabase tiers including free.
--
--   B) Explicit RPC cleanup_expired_rate_limit_counters() callable by
--      service_role for on-demand / ops invocations.
--
-- Both purge rows where window_start < now() - INTERVAL '24 hours'.

-- ============================================================
-- 1. Explicit cleanup RPC (Option C — manual / ops primitive)
-- ============================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_rate_limit_counters()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.rate_limit_counters
   WHERE window_start < now() - INTERVAL '24 hours';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_rate_limit_counters() TO service_role;

-- ============================================================
-- 2. Inline probabilistic cleanup inside increment_rate_limit
--    (Option B — 0.1% chance, transparent, no scheduler needed)
-- ============================================================

CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_bucket          text,
  p_subject         text,
  p_limit           integer,
  p_window_seconds  integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now    timestamptz := now();
  v_count  integer;
  v_start  timestamptz;
BEGIN
  -- Probabilistic cleanup: ~0.1% of calls purge stale rows (> 24 hours old).
  -- Uses random() which is seeded per-session and cheap; no external scheduler needed.
  IF random() < 0.001 THEN
    DELETE FROM public.rate_limit_counters
     WHERE window_start < v_now - INTERVAL '24 hours';
  END IF;

  SELECT window_start, count
    INTO v_start, v_count
    FROM public.rate_limit_counters
   WHERE bucket  = p_bucket
     AND subject = p_subject
     FOR UPDATE;

  IF NOT FOUND OR v_start < v_now - (p_window_seconds * interval '1 second') THEN
    INSERT INTO public.rate_limit_counters (bucket, subject, window_start, count)
    VALUES (p_bucket, p_subject, v_now, 1)
    ON CONFLICT (bucket, subject) DO UPDATE
      SET window_start = EXCLUDED.window_start,
          count        = 1;
    v_count := 1;
  ELSE
    UPDATE public.rate_limit_counters
       SET count = count + 1
     WHERE bucket  = p_bucket
       AND subject = p_subject
    RETURNING count INTO v_count;
  END IF;

  IF v_count > p_limit THEN
    RAISE EXCEPTION 'rate_limited: % per % seconds exceeded', p_limit, p_window_seconds;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_rate_limit(text, text, integer, integer) TO service_role;
