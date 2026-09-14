CREATE FUNCTION public.bootstrap() RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := current_user_id();
  RETURN jsonb_build_object(
    'me', ledger_me_json(v_user_id),
    'groups', COALESCE((
      SELECT jsonb_agg(snap ORDER BY (snap ->> 'lastActivityAt')::timestamptz DESC NULLS LAST)
      FROM (
        SELECT ledger_group_snapshot_json(gm.group_id, v_user_id) AS snap
        FROM group_members gm
        WHERE gm.user_id = v_user_id AND gm.status IN ('invited', 'accepted')
      ) s
    ), '[]'::jsonb),
    'serverTime', to_jsonb(now())
  );
END;
$$;

CREATE FUNCTION public.get_group(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := current_user_id();
  PERFORM assert_member_or_invited(p_group_id, v_user_id);
  RETURN ledger_group_snapshot_json(p_group_id, v_user_id);
END;
$$;

CREATE FUNCTION public.get_group_expenses(
  p_group_id uuid,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 30
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_expenses jsonb;
  v_cursor jsonb;
  v_complete boolean;
BEGIN
  v_user_id := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  -- Half a cursor cannot express the strict (created_at, id) boundary.
  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM assert_member(p_group_id, v_user_id);

  WITH page AS (
    SELECT id, created_at,
      row_number() OVER (ORDER BY created_at DESC, id DESC) AS row_no
    FROM expenses
    WHERE group_id = p_group_id
      AND (
        p_before_id IS NULL
        OR (created_at, id) < (p_before_created_at, p_before_id)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit + 1
  )
  SELECT
    COALESCE(jsonb_agg(ledger_expense_summary_json(p.id, v_user_id) ORDER BY p.created_at DESC, p.id DESC)
      FILTER (WHERE p.row_no <= p_limit), '[]'::jsonb),
    count(*) <= p_limit,
    COALESCE((
      SELECT jsonb_build_object('createdAt', to_jsonb(last_row.created_at), 'id', last_row.id)
      FROM page last_row
      WHERE last_row.row_no = p_limit AND (SELECT count(*) FROM page) > p_limit
    ), 'null'::jsonb)
  INTO v_expenses, v_complete, v_cursor
  FROM page p;

  RETURN jsonb_build_object(
    'expenses', v_expenses,
    'nextCursor', v_cursor,
    'complete', v_complete,
    -- Total over the whole group, not the page, so the UI never advertises a
    -- count that only describes what happens to be loaded.
    'total', (SELECT count(*)::integer FROM expenses WHERE group_id = p_group_id)
  );
END;
$$;

/**
 * Cross-group expense history for the caller, scoped to groups where they are
 * an accepted member. Includes deleted rows, matching the bills history.
 */
CREATE FUNCTION public.get_my_expenses(
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_expenses jsonb;
  v_cursor jsonb;
  v_complete boolean;
BEGIN
  v_user_id := current_user_id();

  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  WITH visible AS (
    SELECT e.id, e.created_at
    FROM expenses e
    WHERE e.group_id IN (
      SELECT gm.group_id FROM group_members gm
      WHERE gm.user_id = v_user_id AND gm.status = 'accepted'
    )
  ), page AS (
    SELECT id, created_at,
      row_number() OVER (ORDER BY created_at DESC, id DESC) AS row_no
    FROM visible
    WHERE p_before_id IS NULL
      OR (created_at, id) < (p_before_created_at, p_before_id)
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit + 1
  )
  SELECT
    COALESCE(jsonb_agg(ledger_expense_summary_json(p.id, v_user_id) ORDER BY p.created_at DESC, p.id DESC)
      FILTER (WHERE p.row_no <= p_limit), '[]'::jsonb),
    count(*) <= p_limit,
    COALESCE((
      SELECT jsonb_build_object('createdAt', to_jsonb(last_row.created_at), 'id', last_row.id)
      FROM page last_row
      WHERE last_row.row_no = p_limit AND (SELECT count(*) FROM page) > p_limit
    ), 'null'::jsonb)
  INTO v_expenses, v_complete, v_cursor
  FROM page p;

  RETURN jsonb_build_object(
    'expenses', v_expenses,
    'nextCursor', v_cursor,
    'complete', v_complete,
    'total', (
      SELECT count(*)::integer FROM expenses e
      WHERE e.group_id IN (
        SELECT gm.group_id FROM group_members gm
        WHERE gm.user_id = v_user_id AND gm.status = 'accepted'
      )
    )
  );
END;
$$;

CREATE FUNCTION public.get_expense(p_expense_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_group_id uuid;
  v_out jsonb;
BEGIN
  v_user_id := current_user_id();
  SELECT group_id INTO v_group_id FROM expenses WHERE id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_found';
  END IF;
  PERFORM assert_member(v_group_id, v_user_id);
  SELECT jsonb_build_object(
    'expense', jsonb_build_object(
      'id', e.id,
      'groupId', e.group_id,
      'creatorId', e.creator_id,
      'status', e.status,
      'currentVersionNo', e.current_version_no,
      'occurredOn', to_jsonb(v.occurred_on),
      'createdAt', to_jsonb(e.created_at),
      'deletedAt', to_jsonb(e.deleted_at),
      'deletedBy', e.deleted_by
    ),
    'current', ledger_expense_version_json(e.id, e.current_version_no),
    'versions', COALESCE((
      SELECT jsonb_agg(ledger_expense_version_json(v.expense_id, v.version_no) ORDER BY v.version_no DESC)
      FROM expense_versions v
      WHERE v.expense_id = e.id
    ), '[]'::jsonb),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'participantIndex', ep.participant_index,
        'kind', ep.kind,
        'shareCents', ep.share_cents,
        'paidCents', ep.paid_cents,
        'user', COALESCE(ledger_user_profile_json(ep.user_id), 'null'::jsonb),
        'guest', COALESCE((
          SELECT jsonb_build_object('id', gst.id, 'displayName', gst.display_name, 'claimedBy', gst.claimed_by, 'claimLinkGeneration', COALESCE((SELECT ct.generation FROM guest_credentials.claim_tokens ct WHERE ct.guest_id = gst.id), 0))
          FROM guests gst
          WHERE gst.id = ep.guest_id
        ), 'null'::jsonb)
      ) ORDER BY ep.participant_index ASC)
      FROM current_expense_participants ep
      WHERE ep.expense_id = e.id
    ), '[]'::jsonb),
    'group', (
      SELECT jsonb_build_object('id', gg.id, 'name', gg.name, 'kind', gg.kind)
      FROM groups gg
      WHERE gg.id = e.group_id
    )
  ) INTO v_out
  FROM expenses e
  JOIN expense_versions v ON v.expense_id = e.id AND v.version_no = e.current_version_no
  WHERE e.id = p_expense_id;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.get_activity(p_before_id bigint, p_limit integer DEFAULT 50) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_limit integer;
BEGIN
  v_user_id := current_user_id();
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  RETURN COALESCE((
    SELECT jsonb_agg(ledger_event_json(ev.id) ORDER BY ev.id DESC)
    FROM (
      SELECT ev.id
      FROM group_events ev
      WHERE (p_before_id IS NULL OR ev.id < p_before_id)
        AND ev.group_id IN (
          SELECT gm.group_id FROM group_members gm
          WHERE gm.user_id = v_user_id AND gm.status = 'accepted'
        )
      ORDER BY ev.id DESC
      LIMIT v_limit
    ) ev
  ), '[]'::jsonb);
END;
$$;

CREATE FUNCTION public.get_conversation(
  p_group_id uuid,
  p_message_before_created_at timestamptz DEFAULT NULL,
  p_message_before_id uuid DEFAULT NULL,
  p_event_before_created_at timestamptz DEFAULT NULL,
  p_event_before_id bigint DEFAULT NULL,
  p_limit integer DEFAULT 50
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_messages jsonb;
  v_message_cursor jsonb;
  v_messages_complete boolean;
  v_events jsonb;
  v_event_cursor jsonb;
  v_events_complete boolean;
BEGIN
  v_user_id := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  -- A half-specified cursor cannot express the strict (created_at, id)
  -- boundary, so accepting one half would skip or repeat rows sharing a
  -- timestamp.
  IF (p_message_before_created_at IS NULL) <> (p_message_before_id IS NULL)
     OR (p_event_before_created_at IS NULL) <> (p_event_before_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM assert_member(p_group_id, v_user_id);

  -- Each stream reads p_limit + 1 rows: the surplus row proves another page
  -- exists (a full page alone does not), and is dropped before the cursor is
  -- taken from the last row actually returned.
  WITH page AS (
    SELECT id, created_at,
      row_number() OVER (ORDER BY created_at DESC, id DESC) AS row_no
    FROM chat_messages
    WHERE group_id = p_group_id
      AND (
        p_message_before_id IS NULL
        OR (created_at, id) < (p_message_before_created_at, p_message_before_id)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit + 1
  )
  SELECT
    COALESCE(jsonb_agg(ledger_chat_message_json(p.id) ORDER BY p.created_at DESC, p.id DESC)
      FILTER (WHERE p.row_no <= p_limit), '[]'::jsonb),
    count(*) <= p_limit,
    COALESCE((
      SELECT jsonb_build_object('createdAt', to_jsonb(last_row.created_at), 'id', last_row.id)
      FROM page last_row
      WHERE last_row.row_no = p_limit AND (SELECT count(*) FROM page) > p_limit
    ), 'null'::jsonb)
  INTO v_messages, v_messages_complete, v_message_cursor
  FROM page p;

  WITH page AS (
    SELECT id, created_at,
      row_number() OVER (ORDER BY created_at DESC, id DESC) AS row_no
    FROM group_events
    WHERE group_id = p_group_id
      AND (
        p_event_before_id IS NULL
        OR (created_at, id) < (p_event_before_created_at, p_event_before_id)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit + 1
  )
  SELECT
    COALESCE(jsonb_agg(ledger_event_json(p.id) ORDER BY p.created_at DESC, p.id DESC)
      FILTER (WHERE p.row_no <= p_limit), '[]'::jsonb),
    count(*) <= p_limit,
    COALESCE((
      SELECT jsonb_build_object('createdAt', to_jsonb(last_row.created_at), 'id', last_row.id)
      FROM page last_row
      WHERE last_row.row_no = p_limit AND (SELECT count(*) FROM page) > p_limit
    ), 'null'::jsonb)
  INTO v_events, v_events_complete, v_event_cursor
  FROM page p;

  RETURN jsonb_build_object(
    'messages', v_messages,
    'messageCursor', v_message_cursor,
    'messagesComplete', v_messages_complete,
    'events', v_events,
    'eventCursor', v_event_cursor,
    'eventsComplete', v_events_complete,
    'readWatermark', COALESCE((
      SELECT jsonb_build_object(
        'lastReadAt', to_jsonb(cr.last_read_at),
        'lastReadMessageId', cr.last_read_message_id
      )
      FROM conversation_reads cr
      WHERE cr.user_id = v_user_id
        AND cr.group_id = p_group_id
        AND cr.last_read_message_id IS NOT NULL
    ), 'null'::jsonb)
  );
END;
$$;

CREATE FUNCTION public.get_my_profile() RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := current_user_id();
  RETURN ledger_me_json(v_user_id);
END;
$$;

CREATE FUNCTION public.lookup_user_by_handle(p_handle text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  -- Handles are derived from the email local-part at signup, so a
  -- pre-onboarding handle is guessable. Until the user completes public
  -- profile setup, their OAuth name and avatar are not discoverable.
  SELECT COALESCE(ledger_user_profile_json(u.id), 'null'::jsonb) INTO v_out
  FROM users u
  WHERE u.handle = lower(trim(p_handle))
    AND u.onboarded;
  RETURN COALESCE(v_out, 'null'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.ledger_user_profile_json(uuid) FROM public;
REVOKE ALL ON FUNCTION public.ledger_me_json(uuid) FROM public;
REVOKE ALL ON FUNCTION public.ledger_settlement_json(uuid) FROM public;
REVOKE ALL ON FUNCTION public.ledger_chat_message_json(uuid) FROM public;
REVOKE ALL ON FUNCTION public.ledger_expense_version_json(uuid, integer) FROM public;
REVOKE ALL ON FUNCTION public.ledger_expense_summary_json(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.ledger_event_json(bigint) FROM public;
REVOKE ALL ON FUNCTION public.ledger_group_snapshot_json(uuid, uuid) FROM public;

REVOKE ALL ON FUNCTION public.bootstrap() FROM public;
GRANT EXECUTE ON FUNCTION public.bootstrap() TO authenticated;
REVOKE ALL ON FUNCTION public.get_group(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_group(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_group_expenses(uuid, timestamptz, uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_group_expenses(uuid, timestamptz, uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_expenses(timestamptz, uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_expenses(timestamptz, uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_expense(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_expense(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_activity(bigint, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_activity(bigint, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_conversation(uuid, timestamptz, uuid, timestamptz, bigint, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_conversation(uuid, timestamptz, uuid, timestamptz, bigint, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_profile() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
REVOKE ALL ON FUNCTION public.lookup_user_by_handle(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_user_by_handle(text) TO service_role;
