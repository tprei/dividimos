-- The assignment_room_opened event reaches only builds that know the kind:
-- installed Android decoders validate event kinds against a closed list, so
-- the two feed RPCs drop the kind (predicates run before cursor paging so
-- completeness and cursors stay consistent) and the snapshot's
-- lastActivityAt aggregate ignores it, so announcing never lights the unread
-- activity bell without a feed row. lastEventId stays unfiltered: the
-- realtime event_id > lastEventId comparison relies on it to force the
-- refresh that carries the new kind to new clients.

-- Old installed builds decode event kinds against a closed list, so the new
-- kind never reaches `get_activity` or `get_conversation`; the predicate runs
-- before cursor paging so completeness and cursors stay consistent.
CREATE OR REPLACE FUNCTION public.get_activity(p_before_id bigint, p_limit integer DEFAULT 50) RETURNS jsonb
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
        AND ev.kind <> 'assignment_room_opened'
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

CREATE OR REPLACE FUNCTION public.get_conversation(
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
      AND kind <> 'assignment_room_opened'
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

-- The snapshot's `lastActivityAt` is what lights the unread activity bell;
-- an announce must not light it while both feed RPCs hide the row. Only
-- that aggregate filters the kind — `lastEventId` stays unfiltered so the
-- realtime `event_id > lastEventId` comparison still forces a refresh.
CREATE OR REPLACE FUNCTION public.ledger_group_snapshot_json(p_group_id uuid, p_viewer uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
  v_status public.member_status;
BEGIN
  SELECT status INTO v_status
  FROM group_members
  WHERE group_id = p_group_id AND user_id = p_viewer;

  -- An invited user has not consented yet: they see who invited them and
  -- nothing about the group's money or conversation.
  IF v_status = 'invited' THEN
    RETURN (
      SELECT jsonb_build_object(
        'group', jsonb_build_object(
          'id', g.id,
          'kind', g.kind,
          'name', g.name,
          'creatorId', g.creator_id,
          'dmUserA', g.dm_user_a,
          'dmUserB', g.dm_user_b,
          'ledgerVersion', 0,
          'createdAt', to_jsonb(g.created_at)
        ),
        'members', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'groupId', gm.group_id,
            'userId', gm.user_id,
            'status', gm.status,
            'invitedBy', gm.invited_by,
            'acceptedAt', to_jsonb(gm.accepted_at),
            'user', COALESCE(ledger_user_profile_json(gm.user_id), 'null'::jsonb)
          ) ORDER BY gm.created_at, gm.user_id)
          FROM group_members gm
          WHERE gm.group_id = g.id
            AND (gm.user_id = p_viewer OR gm.user_id = (
              SELECT invited_by FROM group_members WHERE group_id = p_group_id AND user_id = p_viewer
            ))
        ), '[]'::jsonb),
        'balances', '[]'::jsonb,
        'guests', '[]'::jsonb,
        'settlements', '[]'::jsonb,
        'pairwiseEdges', '[]'::jsonb,
        'recentExpenses', '[]'::jsonb,
        'expenseCount', 0,
        'unreadCount', 0,
        'lastMessage', 'null'::jsonb,
        'lastEventId', 0,
        'lastActivityAt', 'null'::jsonb
      )
      FROM groups g
      WHERE g.id = p_group_id
    );
  END IF;

  SELECT jsonb_build_object(
    'group', jsonb_build_object(
      'id', g.id,
      'kind', g.kind,
      'name', g.name,
      'creatorId', g.creator_id,
      'dmUserA', g.dm_user_a,
      'dmUserB', g.dm_user_b,
      'ledgerVersion', g.ledger_version,
      'createdAt', to_jsonb(g.created_at)
    ),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'groupId', gm.group_id,
        'userId', gm.user_id,
        'status', gm.status,
        'invitedBy', gm.invited_by,
        'acceptedAt', to_jsonb(gm.accepted_at),
        'user', COALESCE(ledger_user_profile_json(gm.user_id), 'null'::jsonb)
      ) ORDER BY gm.created_at, gm.user_id)
      FROM group_members gm
      WHERE gm.group_id = g.id
    ), '[]'::jsonb),
    'balances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', gb.kind,
        'participantId', gb.participant_id,
        'netCents', gb.net_cents
      ) ORDER BY gb.kind, gb.participant_id)
      FROM group_balances gb
      WHERE gb.group_id = g.id
    ), '[]'::jsonb),
    'guests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', gu.id,
        'displayName', gu.display_name,
        'expenseId', gu.expense_id
      ) ORDER BY gu.created_at, gu.id)
      FROM guests gu
      JOIN expenses e ON e.id = gu.expense_id
      WHERE e.group_id = g.id AND e.status = 'active' AND gu.claimed_by IS NULL
    ), '[]'::jsonb),
    'settlements', COALESCE((
      SELECT jsonb_agg(ledger_settlement_json(s.id) ORDER BY s.created_at DESC, s.id)
      FROM (
        SELECT id, created_at FROM settlements
        WHERE group_id = g.id AND status = 'confirmed'
        ORDER BY created_at DESC, id DESC
        LIMIT 50
      ) s
    ), '[]'::jsonb),
    'recentExpenses', COALESCE((
      SELECT jsonb_agg(ledger_expense_summary_json(e.id, p_viewer) ORDER BY e.created_at DESC, e.id DESC)
      FROM (
        SELECT id, created_at FROM expenses
        WHERE group_id = g.id
        ORDER BY created_at DESC, id DESC
        LIMIT 20
      ) e
    ), '[]'::jsonb),
    'lastEventId', COALESCE((
      SELECT max(ev.id) FROM group_events ev WHERE ev.group_id = g.id
    ), 0),
    'unreadCount', (
      SELECT count(*)::integer FROM chat_messages m
      WHERE m.group_id = g.id
        AND m.sender_id <> p_viewer
        AND (
          NOT EXISTS (
            SELECT 1
            FROM conversation_reads cr
            WHERE cr.user_id = p_viewer AND cr.group_id = g.id
          )
          OR EXISTS (
            SELECT 1
            FROM conversation_reads cr
            WHERE cr.user_id = p_viewer
              AND cr.group_id = g.id
              AND (
                cr.last_read_message_id IS NULL
                OR (m.created_at, m.id) > (cr.last_read_at, cr.last_read_message_id)
              )
          )
        )
    ),
    'lastMessage', COALESCE((
      SELECT jsonb_build_object('content', m.content, 'senderId', m.sender_id, 'createdAt', to_jsonb(m.created_at))
      FROM chat_messages m
      WHERE m.group_id = g.id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ), 'null'::jsonb),
    'lastActivityAt', to_jsonb(GREATEST(
      g.created_at,
      (SELECT max(ev.created_at) FROM group_events ev
        WHERE ev.group_id = g.id AND ev.kind <> 'assignment_room_opened'),
      (SELECT max(m.created_at) FROM chat_messages m WHERE m.group_id = g.id)
    )),
    'expenseCount', (
      SELECT count(*) FROM expenses e
      WHERE e.group_id = g.id AND e.status = 'active'
    ),
    'pairwiseEdges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fromKind', pe.from_kind,
        'fromId', pe.from_id,
        'toId', pe.to_id,
        'amountCents', pe.amount_cents
      ) ORDER BY pe.from_kind, pe.from_id, pe.to_id)
      FROM public.group_pairwise_edges(g.id) pe
    ), '[]'::jsonb)
  ) INTO v_out
  FROM groups g
  WHERE g.id = p_group_id;

  RETURN v_out;
END;
$$;


REVOKE ALL ON FUNCTION public.get_activity(bigint, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_activity(bigint, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_conversation(uuid, timestamptz, uuid, timestamptz, bigint, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_conversation(uuid, timestamptz, uuid, timestamptz, bigint, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.ledger_group_snapshot_json(uuid, uuid) FROM public;
