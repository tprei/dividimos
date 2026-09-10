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
