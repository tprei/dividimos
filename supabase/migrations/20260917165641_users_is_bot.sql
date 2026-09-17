SET lock_timeout = '5s';

-- Platform-verified bot accounts. Only the service role writes this column:
-- no RPC takes it as a parameter, so a signed-in client can never claim the
-- badge for itself.
ALTER TABLE public.users
  ADD COLUMN is_bot boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.ledger_user_profile_json(p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', u.id,
    'handle', u.handle,
    'name', u.name,
    'avatarUrl', u.avatar_url,
    'isBot', u.is_bot
  ) INTO v_out
  FROM public.users u
  WHERE u.id = p_user_id;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.ledger_user_profile_json(uuid) FROM public;

CREATE OR REPLACE FUNCTION public.ledger_me_json(p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', u.id,
    'handle', u.handle,
    'name', u.name,
    'avatarUrl', u.avatar_url,
    'isBot', u.is_bot,
    'email', u.email,
    'pixKeyType', u.pix_key_type,
    'pixKeyHint', u.pix_key_hint,
    'onboarded', u.onboarded,
    'notificationPreferences', u.notification_preferences
  ) INTO v_out
  FROM public.users u
  WHERE u.id = p_user_id;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.ledger_me_json(uuid) FROM public;

CREATE OR REPLACE FUNCTION public.update_profile(
  p_name text DEFAULT NULL,
  p_handle text DEFAULT NULL,
  p_notification_preferences jsonb DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_name text;
  v_handle text;
  v_user public.users;
BEGIN
  v_actor := public.current_user_id();

  IF p_name IS NOT NULL THEN
    v_name := btrim(p_name);
    IF length(v_name) < 1 OR length(v_name) > 80 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_name';
    END IF;
  END IF;

  IF p_handle IS NOT NULL THEN
    v_handle := lower(btrim(p_handle));
    IF v_handle !~ '^[a-z0-9_]{3,30}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_handle';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users WHERE handle = v_handle AND id <> v_actor) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'handle_taken';
    END IF;
  END IF;

  IF p_notification_preferences IS NOT NULL THEN
    IF jsonb_typeof(p_notification_preferences) <> 'object' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_notification_preferences';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_notification_preferences) AS k(key)
      WHERE k.key NOT IN ('expenses', 'settlements', 'nudges', 'groups', 'messages')
        OR jsonb_typeof(p_notification_preferences -> k.key) <> 'boolean'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_notification_preferences';
    END IF;
  END IF;

  UPDATE public.users
  SET
    name = COALESCE(v_name, name),
    handle = COALESCE(v_handle, handle),
    notification_preferences = notification_preferences || COALESCE(p_notification_preferences, '{}'::jsonb),
    onboarded = true,
    updated_at = now()
  WHERE id = v_actor
  RETURNING * INTO v_user;

  RETURN jsonb_build_object(
    'id', v_user.id,
    'handle', v_user.handle,
    'name', v_user.name,
    'avatarUrl', v_user.avatar_url,
    'isBot', v_user.is_bot,
    'email', v_user.email,
    'pixKeyType', v_user.pix_key_type,
    'pixKeyHint', v_user.pix_key_hint,
    'onboarded', v_user.onboarded,
    'notificationPreferences', v_user.notification_preferences
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_profile(text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.update_profile(text, text, jsonb) TO authenticated;
