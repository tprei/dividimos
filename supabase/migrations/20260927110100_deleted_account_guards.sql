CREATE OR REPLACE FUNCTION public.current_user_id() RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'unauthenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'account_deleted';
  END IF;
  RETURN v_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.current_user_id() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_push_subscription(
  p_user_id uuid, p_channel text, p_endpoint_digest bytea, p_subscription_encrypted text
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_previous_owner uuid;
  v_id uuid;
  v_deleted_at timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_endpoint_digest IS NULL OR length(p_subscription_encrypted) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_channel NOT IN ('web', 'fcm') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  SELECT deleted_at INTO v_deleted_at FROM public.users WHERE id = p_user_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'account_deleted';
  END IF;
  SELECT user_id INTO v_previous_owner FROM public.push_subscriptions
  WHERE endpoint_digest = p_endpoint_digest;
  INSERT INTO public.push_subscriptions(user_id, channel, endpoint_digest, subscription_encrypted)
  VALUES (p_user_id, p_channel, p_endpoint_digest, p_subscription_encrypted)
  ON CONFLICT (endpoint_digest) DO UPDATE
  SET user_id = EXCLUDED.user_id, channel = EXCLUDED.channel,
      subscription_encrypted = EXCLUDED.subscription_encrypted, updated_at = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('subscriptionId', v_id,
    'transferred', v_previous_owner IS NOT NULL AND v_previous_owner <> p_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_push_subscription(uuid, text, bytea, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_subscription(uuid, text, bytea, text) TO service_role;
