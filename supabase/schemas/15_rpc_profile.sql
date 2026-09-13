CREATE FUNCTION public.complete_onboarding(
  p_handle text,
  p_name text,
  p_pix_key_encrypted text,
  p_pix_key_hint text,
  p_pix_key_type public.pix_key_type
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_handle text;
  v_name text;
  v_completed boolean;
  v_constraint text;
BEGIN
  v_actor := current_user_id();

  v_handle := lower(btrim(p_handle));
  IF v_handle IS NULL OR v_handle !~ '^[a-z0-9_]{3,30}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_handle';
  END IF;

  v_name := btrim(p_name);
  IF v_name IS NULL OR length(v_name) < 1 OR length(v_name) > 80 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_name';
  END IF;

  IF COALESCE(btrim(p_pix_key_encrypted), '') = ''
     OR COALESCE(btrim(p_pix_key_hint), '') = ''
     OR p_pix_key_type IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  BEGIN
    UPDATE users
    SET
      name = v_name,
      handle = v_handle,
      pix_key_encrypted = p_pix_key_encrypted,
      pix_key_hint = p_pix_key_hint,
      pix_key_type = p_pix_key_type,
      onboarded = true,
      updated_at = now()
    WHERE id = v_actor AND onboarded = false;
    v_completed := FOUND;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'users_handle_key' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'handle_taken';
      END IF;
      RAISE;
  END;

  IF v_completed THEN
    RETURN jsonb_build_object('kind', 'completed');
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE id = v_actor AND onboarded = true) THEN
    RETURN jsonb_build_object('kind', 'already_completed');
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
END;
$$;

REVOKE ALL ON FUNCTION public.complete_onboarding(text, text, text, text, public.pix_key_type) FROM public;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(text, text, text, text, public.pix_key_type) TO authenticated;
