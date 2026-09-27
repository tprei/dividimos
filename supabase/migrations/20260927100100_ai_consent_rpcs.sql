CREATE OR REPLACE FUNCTION public.ledger_me_json(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
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
    'notificationPreferences', u.notification_preferences,
    'aiConsentVersion', u.ai_consent_version,
    'aiConsentGrantedAt', u.ai_consent_granted_at
  ) INTO v_out
  FROM public.users u
  WHERE u.id = p_user_id;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.ledger_me_json(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_ai_consent(
  p_expected_user_id uuid,
  p_version integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_user_id();
  IF p_expected_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'unauthenticated';
  END IF;
  IF p_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  UPDATE public.users
  SET ai_consent_granted_at = CASE
        WHEN ai_consent_version = p_version THEN ai_consent_granted_at
        ELSE now()
      END,
      ai_consent_version = p_version,
      updated_at = now()
  WHERE id = v_actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;

  RETURN public.ledger_me_json(v_actor);
END;
$$;

REVOKE ALL ON FUNCTION public.set_ai_consent(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_ai_consent(uuid, integer)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_ai_consent(
  p_expected_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_user_id();
  IF p_expected_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'unauthenticated';
  END IF;

  UPDATE public.users
  SET ai_consent_version = NULL,
      ai_consent_granted_at = NULL,
      updated_at = now()
  WHERE id = v_actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;

  RETURN public.ledger_me_json(v_actor);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_ai_consent(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_ai_consent(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.require_ai_consent(p_version integer)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_version integer;
  v_granted_at timestamptz;
BEGIN
  v_actor := public.current_user_id();
  IF p_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT u.ai_consent_version, u.ai_consent_granted_at
    INTO v_version, v_granted_at
  FROM public.users u
  WHERE u.id = v_actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;
  IF v_version IS DISTINCT FROM p_version OR v_granted_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ai_consent_required';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.require_ai_consent(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.require_ai_consent(integer)
  TO authenticated;
