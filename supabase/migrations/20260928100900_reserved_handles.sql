-- complete_onboarding, update_profile, and handle_new_user accepted official-looking handles like admin or suporte, including lookalikes and token matches; they now raise handle_taken, and new users get their automatic handle from their name with a random suffix on collisions
CREATE OR REPLACE FUNCTION public.is_reserved_handle(p_handle text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public, pg_temp
AS $function$
WITH norms AS (
  SELECT
    regexp_replace(lower(p_handle), '[0-9_]', '', 'g') AS plain,
    regexp_replace(translate(lower(p_handle), '013457', 'oieast'), '[0-9_]', '', 'g') AS leet
)
SELECT n.plain IN (
  'admin', 'administrador', 'suporte', 'support', 'ajuda', 'help',
  'dividimos', 'oficial', 'official', 'staff', 'equipe', 'sistema',
  'system', 'root', 'moderador', 'moderator', 'seguranca', 'security',
  'pix', 'bacen', 'bancocentral'
) OR n.leet IN (
  'admin', 'administrador', 'suporte', 'support', 'ajuda', 'help',
  'dividimos', 'oficial', 'official', 'staff', 'equipe', 'sistema',
  'system', 'root', 'moderador', 'moderator', 'seguranca', 'security',
  'pix', 'bacen', 'bancocentral'
) OR n.plain LIKE ANY (ARRAY[
  'admin%', 'suporte%', 'support%', 'atendimento%', 'staff%',
  'moderador%', 'moderator%', 'seguranca%', 'security%'
]) OR n.leet LIKE ANY (ARRAY[
  'admin%', 'suporte%', 'support%', 'atendimento%', 'staff%',
  'moderador%', 'moderator%', 'seguranca%', 'security%'
]) OR position('dividimo' in n.plain) > 0
   OR position('dividimo' in n.leet) > 0
   OR EXISTS (
  SELECT 1
  FROM unnest(string_to_array(lower(p_handle), '_')) AS t(token)
  WHERE regexp_replace(t.token, '[0-9_]', '', 'g') IN (
    'admin', 'suporte', 'support', 'staff', 'moderador', 'moderator',
    'atendimento', 'seguranca', 'security', 'pix', 'bacen', 'bancocentral',
    'dividimos'
  ) OR regexp_replace(translate(t.token, '013457', 'oieast'), '[0-9_]', '', 'g') IN (
    'admin', 'suporte', 'support', 'staff', 'moderador', 'moderator',
    'atendimento', 'seguranca', 'security', 'pix', 'bacen', 'bancocentral',
    'dividimos'
  )
)
FROM norms n
$function$;

REVOKE ALL ON FUNCTION public.is_reserved_handle(p_handle text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_reserved_handle(p_handle text) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_onboarding(p_handle text, p_name text, p_pix_key_encrypted text, p_pix_key_hint text, p_pix_key_type pix_key_type)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF COALESCE(p_pix_key_encrypted, '') !~ '^[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]+={0,2}$'
     OR length(COALESCE(p_pix_key_encrypted, '')) > 256
     OR length(COALESCE(p_pix_key_hint, '')) > 80 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF is_reserved_handle(v_handle)
     AND NOT EXISTS (SELECT 1 FROM users WHERE id = v_actor AND handle = v_handle) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'handle_taken';
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
$function$;

REVOKE ALL ON FUNCTION public.complete_onboarding(text, text, text, text, pix_key_type) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(text, text, text, text, pix_key_type)
  TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.update_profile(p_name text DEFAULT NULL::text, p_handle text DEFAULT NULL::text, p_notification_preferences jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF v_handle IS NOT NULL THEN
    IF public.is_reserved_handle(v_handle)
       AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_actor AND handle = v_handle) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'handle_taken';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users WHERE handle = v_handle AND id <> v_actor) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'handle_taken';
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
$function$;

REVOKE ALL ON FUNCTION public.update_profile(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_profile(text, text, jsonb)
  TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  generated_handle TEXT;
  base TEXT;
  raw_name TEXT;
  user_name TEXT;
  attempt INT := 0;
  v_constraint TEXT;
BEGIN
  raw_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', '')
  );

  IF raw_name IS NULL THEN
    base := 'usuario';
  ELSE
    base := left(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              translate(
                lower(raw_name),
                'àáâãäåçèéêëìíîïñòóôõöùúûüýÿŉāăąćĉċčďēĕėęěĝğġģĥĩīĭįĵķĺļľńņňōŏőŕŗřśŝşšţťũūŭůűųŵŷźżž',
                'aaaaaaceeeeiiiinooooouuuuyynaaaccccdeeeeegggghiiiijklllnnnooorrrssssttuuuuuuwyzzz'
              ),
              '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', '_', 'g'
            ),
            '[^a-z0-9_]', '', 'g'
          ),
          '_+', '_', 'g'
        ),
        '^_+|_+$', '', 'g'
      ),
      30
    );
  END IF;

  IF char_length(base) < 3 THEN
    base := 'usuario';
  END IF;
  IF public.is_reserved_handle(base) THEN
    base := 'usuario';
  END IF;

  generated_handle := base;
  IF EXISTS (SELECT 1 FROM public.users WHERE handle = generated_handle)
     OR public.is_reserved_handle(generated_handle) THEN
    generated_handle := NULL;
  END IF;
  WHILE generated_handle IS NULL AND attempt < 20 LOOP
    attempt := attempt + 1;
    generated_handle := left(base, 26) || (1000 + floor(random() * 9000))::int::text;
    IF EXISTS (SELECT 1 FROM public.users WHERE handle = generated_handle)
       OR public.is_reserved_handle(generated_handle) THEN
      generated_handle := NULL;
    END IF;
  END LOOP;
  IF generated_handle IS NULL THEN
    generated_handle := left(base, 22) || (100000 + floor(random() * 900000))::int::text;
  END IF;

  user_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(split_part(NEW.email, '@', 1), ''),
    'user'
  );
  user_name := left(user_name, 80);

  LOOP
    BEGIN
      INSERT INTO public.users (id, email, handle, name, avatar_url)
      VALUES (
        NEW.id,
        NEW.email,
        generated_handle,
        user_name,
        NEW.raw_user_meta_data->>'avatar_url'
      );
      RETURN NEW;
    EXCEPTION
      WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint <> 'users_handle_key' THEN
          RAISE;
        END IF;
        attempt := attempt + 1;
        IF attempt > 20 THEN
          generated_handle := left(base, 22) || (100000 + floor(random() * 900000))::int::text;
        ELSE
          generated_handle := left(base, 26) || (1000 + floor(random() * 9000))::int::text;
        END IF;
    END;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
