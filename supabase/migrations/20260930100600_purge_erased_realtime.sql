-- Erased chat fanout stayed replayable: realtime.messages keeps every
-- broadcast row for days and a member could re-read the original content (and
-- a deleted account's name, handle, avatar and message text) from their own
-- user topic via broadcast replay. The app client never subscribes with
-- replay, so purging the stored rows has no functional impact.

-- Verbatim copy of the previous erase_chat_message body. delete_account calls
-- this helper directly so erasing every message costs no realtime scan.
CREATE OR REPLACE FUNCTION public.erase_chat_message_content(p_message_id uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_group_id uuid;
  v_message jsonb;
  v_rec record;
BEGIN
  SELECT group_id INTO v_group_id FROM public.chat_messages WHERE id = p_message_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  PERFORM public.lock_group(v_group_id);
  UPDATE public.chat_messages
  SET content = NULL, erased_at = COALESCE(erased_at, now())
  WHERE id = p_message_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  v_message := public.ledger_chat_message_json(p_message_id);
  FOR v_rec IN
    SELECT gm.user_id
    FROM public.group_members gm
    WHERE gm.group_id = v_group_id AND gm.status = 'accepted'
    FOR SHARE OF gm
  LOOP
    PERFORM realtime.send(
      jsonb_build_object('group_id', v_group_id, 'message', v_message),
      'message', 'user:' || v_rec.user_id::text, true);
  END LOOP;
  PERFORM realtime.send(jsonb_build_object('group_id', v_group_id),
    'chat_activity', 'group:' || v_group_id::text, true);
  RETURN v_message;
END;
$$;

REVOKE ALL ON FUNCTION public.erase_chat_message_content(uuid) FROM PUBLIC, anon, authenticated;

-- The inserted_at guard keeps rows written by the current transaction, so the
-- erasure broadcast itself is still delivered live; only earlier fanout rows
-- are replayable and get purged.
CREATE OR REPLACE FUNCTION public.purge_realtime_message(p_message_id uuid) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  DELETE FROM realtime.messages
  WHERE event = 'message'
    AND payload->'message'->>'id' = p_message_id::text
    AND payload->'message'->>'content' IS NOT NULL
    AND inserted_at < now();
$$;

REVOKE ALL ON FUNCTION public.purge_realtime_message(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.erase_chat_message(p_message_id uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_message jsonb;
BEGIN
  v_message := public.erase_chat_message_content(p_message_id);
  PERFORM public.purge_realtime_message(p_message_id);
  RETURN v_message;
END;
$$;

REVOKE ALL ON FUNCTION public.erase_chat_message(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_chat_message(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_account(p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_at timestamptz;
  v_groups uuid[];
  v_group_id uuid;
  v_room_id uuid;
  v_message_id uuid;
  v_refusal jsonb;
  v_handle text;
  v_constraint text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 27110200));
  PERFORM 1 FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;

  SELECT COALESCE(array_agg(g.id ORDER BY g.id), ARRAY[]::uuid[]) INTO v_groups
  FROM public.groups g
  WHERE g.creator_id = p_user_id OR g.dm_user_a = p_user_id OR g.dm_user_b = p_user_id
    OR EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = g.id AND gm.user_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.group_balances gb WHERE gb.group_id = g.id AND gb.kind = 'user' AND gb.participant_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.chat_messages m WHERE m.group_id = g.id AND m.sender_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.group_events ev WHERE ev.group_id = g.id AND (ev.actor_id = p_user_id OR ev.subject_user_id = p_user_id));
  FOREACH v_group_id IN ARRAY v_groups LOOP
    PERFORM public.lock_group(v_group_id);
  END LOOP;

  FOR v_room_id IN
    SELECT r.id FROM public.assignment_rooms r
    WHERE r.host_user_id = p_user_id OR EXISTS (
      SELECT 1 FROM public.assignment_room_participants p WHERE p.room_id = r.id AND p.user_id = p_user_id
    ) ORDER BY r.id
  LOOP
    PERFORM 1 FROM public.assignment_rooms WHERE id = v_room_id FOR UPDATE;
  END LOOP;

  SELECT deleted_at INTO v_deleted_at FROM public.users WHERE id = p_user_id;
  IF v_deleted_at IS NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', g.id,
      'name', CASE WHEN g.kind = 'dm' THEN 'Conversa com ' || u.name ELSE g.name END
    ) ORDER BY g.id), '[]'::jsonb) INTO v_refusal
    FROM public.group_balances gb
    JOIN public.groups g ON g.id = gb.group_id
    LEFT JOIN public.users u ON u.id = CASE WHEN g.dm_user_a = p_user_id THEN g.dm_user_b ELSE g.dm_user_a END
    WHERE gb.kind = 'user' AND gb.participant_id = p_user_id;
    IF jsonb_array_length(v_refusal) > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'outstanding_balance',
        DETAIL = jsonb_build_object('groups', v_refusal)::text;
    END IF;
  END IF;

  LOOP
    v_handle := 'deleted_' || encode(extensions.gen_random_bytes(11), 'hex');
    BEGIN
      UPDATE public.users SET
        name = 'Conta excluída', email = '', handle = v_handle,
        avatar_url = NULL, pix_key_type = NULL, pix_key_hint = NULL, pix_key_encrypted = NULL,
        onboarded = false, is_bot = false,
        notification_preferences = '{"expenses":false,"settlements":false,"nudges":false,"groups":false,"messages":false}'::jsonb,
        deleted_at = COALESCE(deleted_at, now()), updated_at = now()
      WHERE id = p_user_id RETURNING deleted_at INTO v_deleted_at;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint <> 'users_handle_key' THEN RAISE; END IF;
    END;
  END LOOP;

  UPDATE public.groups g SET creator_id = successor.user_id
  FROM LATERAL (
    SELECT gm.group_id, gm.user_id,
      row_number() OVER (PARTITION BY gm.group_id ORDER BY gm.accepted_at NULLS LAST, gm.created_at, gm.user_id) AS position
    FROM public.group_members gm
    JOIN public.users u ON u.id = gm.user_id
    WHERE gm.user_id <> p_user_id AND gm.status = 'accepted' AND u.deleted_at IS NULL
  ) successor
  WHERE g.creator_id = p_user_id AND successor.group_id = g.id AND successor.position = 1;

  DELETE FROM public.group_members WHERE user_id = p_user_id;
  UPDATE public.group_invite_links SET is_active = false WHERE created_by = p_user_id AND is_active;
  DELETE FROM public.push_subscriptions WHERE user_id = p_user_id;
  DELETE FROM public.conversation_reads WHERE user_id = p_user_id;
  DELETE FROM public.vendor_charges WHERE user_id = p_user_id;
  DELETE FROM public.rate_limit_counters WHERE subject = p_user_id::text;
  UPDATE public.guests SET display_name = 'Conta excluída' WHERE claimed_by = p_user_id;
  UPDATE public.expense_versions v
  SET payload = jsonb_set(v.payload, '{participants}', (
    SELECT jsonb_agg(
      CASE WHEN g.id IS NOT NULL
        THEN p.value || jsonb_build_object('displayName', 'Conta excluída')
        ELSE p.value
      END ORDER BY p.ordinality)
    FROM jsonb_array_elements(v.payload->'participants') WITH ORDINALITY AS p(value, ordinality)
    LEFT JOIN public.guests g
      ON p.value->>'kind' = 'guest' AND g.id = (p.value->>'guestId')::uuid AND g.claimed_by = p_user_id
  ))
  WHERE v.expense_id IN (SELECT expense_id FROM public.guests WHERE claimed_by = p_user_id);
  UPDATE public.group_events
  SET payload = jsonb_set(payload, '{displayName}', to_jsonb('Conta excluída'::text))
  WHERE kind = 'guest_claimed' AND subject_user_id = p_user_id AND payload ? 'displayName';
  UPDATE public.group_events SET notified_at = now()
  WHERE actor_id = p_user_id AND notified_at IS NULL;
  DELETE FROM public.user_blocks WHERE blocker_id = p_user_id OR blocked_id = p_user_id;
  DELETE FROM public.dm_opt_outs WHERE user_id = p_user_id OR other_user_id = p_user_id;

  DELETE FROM guest_credentials.assignment_room_members m
  USING public.assignment_room_participants p
  WHERE m.room_id = p.room_id AND m.participant_id = p.id AND p.user_id = p_user_id;

  WITH removed AS (
    DELETE FROM public.assignment_room_claims c
    USING public.assignment_room_participants p, public.assignment_rooms r
    WHERE c.room_id = p.room_id AND c.participant_id = p.id
      AND r.id = c.room_id AND r.status <> 'finalized' AND p.user_id = p_user_id
    RETURNING c.room_id, c.item_id
  )
  UPDATE public.assignment_room_items i SET revision = i.revision + 1
  WHERE EXISTS (SELECT 1 FROM removed x WHERE x.room_id = i.room_id AND x.item_id = i.id);

  UPDATE public.assignment_room_participants
  SET display_name = 'Conta excluída', removed_at = COALESCE(removed_at, now())
  WHERE user_id = p_user_id;

  FOR v_room_id IN
    SELECT r.id FROM public.assignment_rooms r
    WHERE r.host_user_id = p_user_id AND r.status <> 'finalized' ORDER BY r.id
  LOOP
    UPDATE public.assignment_rooms SET status = 'cancelled', closed_at = COALESCE(closed_at, now()), revision = revision + 1
    WHERE id = v_room_id;
    PERFORM public.broadcast_assignment_room(v_room_id);
    DELETE FROM public.assignment_rooms WHERE id = v_room_id;
  END LOOP;

  FOR v_room_id IN
    SELECT DISTINCT p.room_id FROM public.assignment_room_participants p
    WHERE p.user_id = p_user_id ORDER BY p.room_id
  LOOP
    UPDATE public.assignment_rooms SET revision = revision + 1 WHERE id = v_room_id;
    PERFORM public.broadcast_assignment_room(v_room_id);
  END LOOP;

  FOR v_message_id IN
    SELECT m.id FROM public.chat_messages m
    WHERE m.sender_id = p_user_id AND m.erased_at IS NULL
    ORDER BY m.group_id, m.created_at, m.id
  LOOP
    PERFORM public.erase_chat_message_content(v_message_id);
  END LOOP;

  -- One realtime scan for the whole account instead of one per erased message.
  DELETE FROM realtime.messages
  WHERE inserted_at < now() AND payload::text LIKE '%' || p_user_id::text || '%';

  FOREACH v_group_id IN ARRAY v_groups LOOP
    PERFORM public.broadcast_user(gm.user_id, v_group_id)
    FROM public.group_members gm WHERE gm.group_id = v_group_id;
    PERFORM realtime.send(jsonb_build_object('group_id', v_group_id),
      'chat_activity', 'group:' || v_group_id::text, true);
  END LOOP;
  RETURN jsonb_build_object('userId', p_user_id, 'deletedAt', to_jsonb(v_deleted_at));
END;
$$;

REVOKE ALL ON FUNCTION public.delete_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_account(uuid) TO service_role;
