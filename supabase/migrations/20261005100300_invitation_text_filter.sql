CREATE OR REPLACE FUNCTION public.invite_member(p_group_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_creator_id uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := public.current_user_id();

  IF p_group_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM public.lock_group(p_group_id);
  PERFORM public.assert_member(p_group_id, v_actor);
  PERFORM public.assert_dm_pair_allowed(p_group_id, p_user_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id AND u.onboarded AND u.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;
  SELECT creator_id, ledger_version INTO v_creator_id, v_ledger_version FROM public.groups WHERE id = p_group_id;

  IF EXISTS (SELECT 1 FROM public.group_member_exclusions WHERE group_id = p_group_id AND user_id = p_user_id) THEN
    IF v_actor = v_creator_id THEN
      DELETE FROM public.group_member_exclusions WHERE group_id = p_group_id AND user_id = p_user_id;
    ELSE
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
    END IF;
  END IF;

  SELECT status INTO v_status FROM public.group_members WHERE group_id = p_group_id AND user_id = p_user_id;
  IF FOUND THEN
    IF v_status = 'accepted' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_member';
    ELSIF v_status = 'invited' THEN
      SELECT ledger_version INTO v_ledger_version FROM public.groups WHERE id = p_group_id;
      RETURN jsonb_build_object(
        'groupId', p_group_id,
        'ledgerVersion', v_ledger_version,
        'eventId', NULL
      );
    END IF;
  END IF;
  PERFORM public.assert_user_contact_allowed(v_actor, p_user_id);

  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = v_actor
      AND (public.has_objectionable_text(u.name)
           OR public.has_objectionable_text(u.handle))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'objectionable_content';
  END IF;

  IF (
    SELECT count(*)
    FROM public.group_members gm
    WHERE gm.user_id = p_user_id
      AND gm.status = 'invited'
      AND gm.invited_by = v_actor
  ) >= 10 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invite_limit';
  END IF;

  IF NOT public.increment_rate_limit('invites_sent', v_actor::text, 100, 3600) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invite_rate_limited';
  END IF;

  INSERT INTO public.group_members (group_id, user_id, status, invited_by)
  VALUES (p_group_id, p_user_id, 'invited', v_actor);

  SELECT ledger_version INTO v_ledger_version FROM public.groups WHERE id = p_group_id;

  v_event_id := public.emit_event(
    p_group_id,
    'member_invited',
    v_actor,
    p_subject_user_id => p_user_id,
    p_payload => jsonb_build_object('userIds', jsonb_build_array(p_user_id))
  );

  PERFORM public.broadcast_group(p_group_id, v_ledger_version, v_event_id);
  PERFORM public.broadcast_user(p_user_id, p_group_id);

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.invite_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invite_member(uuid, uuid) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.accept_invitation(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_event_id bigint;
  v_invited_by uuid;
  v_creator uuid;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

  IF EXISTS (
    SELECT 1 FROM group_member_exclusions
    WHERE group_id = p_group_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  SELECT status, invited_by INTO v_status, v_invited_by FROM group_members
  WHERE group_id = p_group_id AND user_id = v_actor
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'invited' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_invited';
  END IF;

  PERFORM public.assert_user_contact_allowed(v_actor, v_invited_by);

  SELECT creator_id INTO v_creator FROM public.groups WHERE id = p_group_id;
  PERFORM public.assert_user_contact_allowed(v_actor, v_creator);

  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = v_actor
      AND (public.has_objectionable_text(u.name)
           OR public.has_objectionable_text(u.handle))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'objectionable_content';
  END IF;

  UPDATE group_members
  SET status = 'accepted', accepted_at = now()
  WHERE group_id = p_group_id AND user_id = v_actor;

  -- Shared-history latch: joining a group whose facts already exist makes
  -- them shared from this moment.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = p_group_id
    AND financial_history_shared_at IS NULL
    AND (EXISTS (SELECT 1 FROM public.expenses WHERE group_id = p_group_id)
         OR EXISTS (SELECT 1 FROM public.settlements WHERE group_id = p_group_id));

  SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;

  v_event_id := emit_event(
    p_group_id,
    'member_joined',
    v_actor,
    p_subject_user_id => v_actor,
    p_payload => '{}'::jsonb
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);
  IF v_invited_by IS NOT NULL THEN
    PERFORM broadcast_user(v_invited_by, p_group_id);
  END IF;

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_invitation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation(uuid) TO service_role, authenticated;
