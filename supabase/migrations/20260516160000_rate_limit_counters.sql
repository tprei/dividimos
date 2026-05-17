-- Rate-limit counter store and increment RPC.
--
-- Provides a Supabase-backed fixed-window token counter used by
-- src/lib/rate-limit.ts. All writes go through the SECURITY DEFINER
-- RPC so the table is never directly writable by authenticated callers.
--
-- RLS is enabled with no public policies — "deny all by default" for
-- any client that is not the service-role admin client used by the RPC.

-- ============================================================
-- 1. Table
-- ============================================================

CREATE TABLE public.rate_limit_counters (
  bucket       text        NOT NULL,
  subject      text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL,
  PRIMARY KEY (bucket, subject)
);

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. RPC: increment_rate_limit
-- ============================================================
-- Atomically increments the counter for (bucket, subject) within
-- the current fixed window. If the window has expired, resets it.
-- Raises 'rate_limited' if count exceeds p_limit after increment.
-- Returns the new count.

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
