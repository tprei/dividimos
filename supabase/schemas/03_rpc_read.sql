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
        AND m.created_at > COALESCE((
          SELECT cr.last_read_at FROM conversation_reads cr
          WHERE cr.user_id = p_viewer AND cr.group_id = g.id
        ), '-infinity'::timestamptz)
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
      WHERE e.group_id = g.id AND e.deleted_at IS NULL
    )
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

CREATE FUNCTION public.get_group_expenses(p_group_id uuid, p_before timestamptz, p_limit integer DEFAULT 30) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_limit integer;
BEGIN
  v_user_id := current_user_id();
  PERFORM assert_member(p_group_id, v_user_id);
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 30), 100));
  RETURN COALESCE((
    SELECT jsonb_agg(ledger_expense_summary_json(e.id, v_user_id) ORDER BY e.created_at DESC, e.id DESC)
    FROM (
      SELECT id, created_at FROM expenses
      WHERE group_id = p_group_id
        AND created_at < COALESCE(p_before, 'infinity'::timestamptz)
      ORDER BY created_at DESC, id DESC
      LIMIT v_limit
    ) e
  ), '[]'::jsonb);
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
          SELECT jsonb_build_object('id', gst.id, 'displayName', gst.display_name, 'claimedBy', gst.claimed_by)
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

CREATE FUNCTION public.get_conversation(p_group_id uuid, p_before timestamptz, p_limit integer DEFAULT 50) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_limit integer;
BEGIN
  v_user_id := current_user_id();
  PERFORM assert_member(p_group_id, v_user_id);
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  RETURN jsonb_build_object(
    'messages', COALESCE((
      SELECT jsonb_agg(ledger_chat_message_json(m.id) ORDER BY m.created_at DESC, m.id DESC)
      FROM (
        SELECT id, created_at FROM chat_messages
        WHERE group_id = p_group_id
          AND created_at < COALESCE(p_before, 'infinity'::timestamptz)
        ORDER BY created_at DESC, id DESC
        LIMIT v_limit
      ) m
    ), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(ledger_event_json(ev.id) ORDER BY ev.created_at DESC, ev.id DESC)
      FROM (
        SELECT id, created_at FROM group_events
        WHERE group_id = p_group_id
          AND created_at < COALESCE(p_before, 'infinity'::timestamptz)
        ORDER BY created_at DESC, id DESC
        LIMIT v_limit
      ) ev
    ), '[]'::jsonb)
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
REVOKE ALL ON FUNCTION public.get_group_expenses(uuid, timestamptz, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_group_expenses(uuid, timestamptz, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_expense(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_expense(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_activity(bigint, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_activity(bigint, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_conversation(uuid, timestamptz, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_conversation(uuid, timestamptz, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_profile() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
REVOKE ALL ON FUNCTION public.lookup_user_by_handle(text) FROM public;
GRANT EXECUTE ON FUNCTION public.lookup_user_by_handle(text) TO authenticated;
