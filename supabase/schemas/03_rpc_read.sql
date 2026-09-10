CREATE FUNCTION public.ledger_user_profile_json(p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object('id', u.id, 'handle', u.handle, 'name', u.name, 'avatarUrl', u.avatar_url)
    INTO v_out
    FROM users u
    WHERE u.id = p_user_id;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.ledger_me_json(p_user_id uuid) RETURNS jsonb
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
    'email', u.email,
    'pixKeyType', u.pix_key_type,
    'pixKeyHint', u.pix_key_hint,
    'onboarded', u.onboarded,
    'notificationPreferences', u.notification_preferences
  ) INTO v_out
  FROM users u
  WHERE u.id = p_user_id;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.ledger_settlement_json(p_settlement_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', s.id,
    'operationId', s.operation_id,
    'groupId', s.group_id,
    'fromUserId', s.from_user_id,
    'toUserId', s.to_user_id,
    'amountCents', s.amount_cents,
    'status', s.status,
    'createdBy', s.created_by,
    'createdAt', to_jsonb(s.created_at),
    'confirmedAt', to_jsonb(s.confirmed_at),
    'voidedAt', to_jsonb(s.voided_at),
    'voidedBy', s.voided_by
  ) INTO v_out
  FROM settlements s
  WHERE s.id = p_settlement_id;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.ledger_chat_message_json(p_message_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', m.id,
    'clientId', m.client_id,
    'groupId', m.group_id,
    'senderId', m.sender_id,
    'content', m.content,
    'createdAt', to_jsonb(m.created_at),
    'sender', COALESCE(ledger_user_profile_json(m.sender_id), 'null'::jsonb)
  ) INTO v_out
  FROM chat_messages m
  WHERE m.id = p_message_id;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.ledger_expense_version_json(p_expense_id uuid, p_version_no integer) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'expenseId', v.expense_id,
    'versionNo', v.version_no,
    'authorId', v.author_id,
    'createdAt', to_jsonb(v.created_at),
    'occurredOn', to_jsonb(e.occurred_on),
    'title', v.title,
    'merchantName', v.merchant_name,
    'expenseType', v.expense_type,
    'totalCents', v.total_cents,
    'serviceFeeBasisPoints', v.service_fee_bps,
    'fixedFeeCents', v.fixed_fee_cents,
    'payload', v.payload,
    'changeSummary', v.change_summary
  ) INTO v_out
  FROM expense_versions v
  JOIN expenses e ON e.id = v.expense_id
  WHERE v.expense_id = p_expense_id AND v.version_no = p_version_no;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.ledger_expense_summary_json(p_expense_id uuid, p_viewer uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', e.id,
    'groupId', e.group_id,
    'creatorId', e.creator_id,
    'status', e.status,
    'occurredOn', to_jsonb(e.occurred_on),
    'createdAt', to_jsonb(e.created_at),
    'versionNo', e.current_version_no,
    'title', v.title,
    'merchantName', v.merchant_name,
    'expenseType', v.expense_type,
    'totalCents', v.total_cents,
    'myShareCents', COALESCE((
      SELECT ep.share_cents FROM expense_participants ep
      WHERE ep.expense_id = e.id AND ep.user_id = p_viewer
    ), 0),
    'myPaidCents', COALESCE((
      SELECT ep.paid_cents FROM expense_participants ep
      WHERE ep.expense_id = e.id AND ep.user_id = p_viewer
    ), 0),
    'participantCount', CASE WHEN e.status = 'deleted'
      THEN jsonb_array_length(COALESCE(v.payload -> 'participants', '[]'::jsonb))
      ELSE (SELECT count(*)::integer FROM expense_participants ep WHERE ep.expense_id = e.id)
    END
  ) INTO v_out
  FROM expenses e
  JOIN expense_versions v ON v.expense_id = e.id AND v.version_no = e.current_version_no
  WHERE e.id = p_expense_id;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.ledger_event_json(p_event_id bigint) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', ev.id,
    'groupId', ev.group_id,
    'actorId', ev.actor_id,
    'kind', ev.kind,
    'expenseId', ev.expense_id,
    'settlementId', ev.settlement_id,
    'subjectUserId', ev.subject_user_id,
    'payload', ev.payload,
    'createdAt', to_jsonb(ev.created_at),
    'actor', COALESCE(ledger_user_profile_json(ev.actor_id), 'null'::jsonb),
    'expenseTitle', (
      SELECT v.title
      FROM expenses e
      JOIN expense_versions v ON v.expense_id = e.id AND v.version_no = e.current_version_no
      WHERE e.id = ev.expense_id
    )
  ) INTO v_out
  FROM group_events ev
  WHERE ev.id = p_event_id;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.ledger_group_snapshot_json(p_group_id uuid, p_viewer uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
  v_status public.member_status;
BEGIN
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
      (SELECT max(ev.created_at) FROM group_events ev WHERE ev.group_id = g.id),
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

  SELECT status INTO v_status
  FROM group_members
  WHERE group_id = p_group_id AND user_id = p_viewer;

  -- An invited user has not consented yet: they see who invited them and
  -- nothing about the group's money or conversation.
  IF v_status = 'invited' THEN
    v_out := v_out
      || jsonb_build_object(
           'members', (
             SELECT COALESCE(jsonb_agg(m ORDER BY m ->> 'userId'), '[]'::jsonb)
             FROM jsonb_array_elements(v_out -> 'members') AS t(m)
             WHERE m ->> 'userId' IN (
               p_viewer::text,
               (SELECT invited_by::text FROM group_members
                WHERE group_id = p_group_id AND user_id = p_viewer)
             )
           ),
           'balances', '[]'::jsonb,
           'guests', '[]'::jsonb,
           'settlements', '[]'::jsonb,
           'pairwiseEdges', '[]'::jsonb,
           'recentExpenses', '[]'::jsonb,
           'expenseCount', 0,
           'unreadCount', 0,
           'lastMessage', 'null'::jsonb
        );
  END IF;

  RETURN v_out;
END;
$$;

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
      SELECT jsonb_agg(snap ORDER BY (snap ->> 'lastActivityAt')::timestamptz DESC)
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
      'occurredOn', to_jsonb(e.occurred_on),
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
      FROM expense_participants ep
      WHERE ep.expense_id = e.id
    ), '[]'::jsonb),
    'group', (
      SELECT jsonb_build_object('id', gg.id, 'name', gg.name, 'kind', gg.kind)
      FROM groups gg
      WHERE gg.id = e.group_id
    )
  ) INTO v_out
  FROM expenses e
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
  SELECT COALESCE(ledger_user_profile_json(u.id), 'null'::jsonb) INTO v_out
  FROM users u
  WHERE u.handle = lower(trim(p_handle));
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
REVOKE ALL ON FUNCTION public.lookup_user_by_handle(text) FROM public;
GRANT EXECUTE ON FUNCTION public.lookup_user_by_handle(text) TO authenticated;
