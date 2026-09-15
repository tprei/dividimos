CREATE TABLE public.rate_limit_counters (
  bucket text NOT NULL,
  subject text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (bucket, subject),
  CONSTRAINT rate_limit_counters_bucket_bounds
    CHECK (btrim(bucket) <> '' AND octet_length(bucket) BETWEEN 1 AND 64),
  CONSTRAINT rate_limit_counters_subject_bounds
    CHECK (btrim(subject) <> '' AND octet_length(subject) BETWEEN 1 AND 512),
  CONSTRAINT rate_limit_counters_count_bounds
    CHECK (count BETWEEN 1 AND 1001)
);
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

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

CREATE FUNCTION public.cleanup_expired_rate_limit_counters()
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

-- Push subscription ownership.
--
-- A physical endpoint (web push URL or FCM token) belongs to exactly one
-- account. Claiming is a single statement so two concurrent registrations of
-- the same device cannot both win, and re-registering a device under a second
-- account moves the row instead of leaving the first account subscribed.
--
-- Called with the service role from the push API routes after they authenticate
-- the session; never exposed to authenticated clients.

CREATE FUNCTION public.claim_push_subscription(
  p_user_id uuid,
  p_channel text,
  p_endpoint_digest bytea,
  p_subscription_encrypted text
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_previous_owner uuid;
  v_id uuid;
BEGIN
  IF p_user_id IS NULL
    OR p_endpoint_digest IS NULL
    OR length(p_subscription_encrypted) = 0
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_channel NOT IN ('web', 'fcm') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;

  SELECT user_id INTO v_previous_owner
  FROM push_subscriptions
  WHERE endpoint_digest = p_endpoint_digest;

  -- The unique endpoint_digest makes this the whole transfer: the losing
  -- account's row is overwritten, not duplicated.
  INSERT INTO push_subscriptions (
    user_id, channel, endpoint_digest, subscription_encrypted
  ) VALUES (
    p_user_id, p_channel, p_endpoint_digest, p_subscription_encrypted
  )
  ON CONFLICT (endpoint_digest) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        channel = EXCLUDED.channel,
        subscription_encrypted = EXCLUDED.subscription_encrypted,
        updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'subscriptionId', v_id,
    'transferred', v_previous_owner IS NOT NULL AND v_previous_owner <> p_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_push_subscription(uuid, text, bytea, text) FROM public;
REVOKE ALL ON FUNCTION public.claim_push_subscription(uuid, text, bytea, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_subscription(uuid, text, bytea, text) TO service_role;
