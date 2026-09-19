SET lock_timeout = '5s';

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('group-avatars', 'group-avatars', false, 1048576)
ON CONFLICT (id) DO UPDATE
SET public = false, file_size_limit = 1048576;

CREATE FUNCTION public.set_group_avatar(
  p_group_id uuid, p_actor_id uuid, p_emoji text, p_photo_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind group_kind;
  v_ledger_version bigint;
  v_previous_photo_id uuid;
BEGIN
  IF p_group_id IS NULL OR p_actor_id IS NULL
     OR (p_emoji IS NULL AND p_photo_id IS NULL)
     OR (p_emoji IS NOT NULL AND p_photo_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_emoji IS NOT NULL AND p_emoji NOT IN (
    E'\U0001F3E0', E'\U0001F37B', E'\U0001F355', E'\U0001F3D6\uFE0F',
    E'\u2708\uFE0F', E'\u26BD', E'\U0001F389', E'\U0001F431'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, p_actor_id);

  SELECT kind INTO v_kind FROM groups WHERE id = p_group_id;
  IF v_kind = 'dm' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
  END IF;

  IF p_photo_id IS NOT NULL THEN
    SELECT avatar_photo_id INTO v_previous_photo_id
      FROM groups WHERE id = p_group_id;
  END IF;

  UPDATE groups
  SET avatar_emoji = p_emoji,
      avatar_photo_id = p_photo_id,
      ledger_version = ledger_version + 1
  WHERE id = p_group_id
  RETURNING ledger_version INTO v_ledger_version;

  PERFORM broadcast_group(
    p_group_id,
    v_ledger_version,
    COALESCE((
      SELECT max(ev.id) FROM group_events ev WHERE ev.group_id = p_group_id
    ), 0)
  );

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'previousPhotoId', v_previous_photo_id
  );
END;
$$;

CREATE FUNCTION public.get_group_avatar(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_kind group_kind;
  v_emoji text;
  v_photo_id uuid;
BEGIN
  v_user_id := current_user_id();
  PERFORM assert_member(p_group_id, v_user_id);

  SELECT kind, avatar_emoji, avatar_photo_id
    INTO v_kind, v_emoji, v_photo_id
  FROM groups WHERE id = p_group_id;
  IF v_kind = 'dm' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
  END IF;

  IF v_photo_id IS NOT NULL THEN
    RETURN jsonb_build_object('kind', 'photo', 'photoId', v_photo_id::text);
  ELSIF v_emoji IS NOT NULL THEN
    RETURN jsonb_build_object('kind', 'emoji', 'emoji', v_emoji);
  END IF;
  RETURN jsonb_build_object('kind', 'initials');
END;
$$;

REVOKE ALL ON FUNCTION public.set_group_avatar(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_group_avatar(uuid, uuid, text, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_group_avatar(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_group_avatar(uuid) TO authenticated;
