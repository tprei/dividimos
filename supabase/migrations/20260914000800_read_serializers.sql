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
    'occurredOn', to_jsonb(v.occurred_on),
    'title', v.title,
    'merchantName', v.merchant_name,
    'expenseType', v.expense_type,
    'totalCents', v.total_cents,
    'serviceFeeBasisPoints', v.service_fee_bps,
    'fixedFeeCents', v.fixed_fee_cents,
    'payload', effective_expense_payload(v.expense_id, v.version_no),
    'changeSummary', v.change_summary
  ) INTO v_out
  FROM expense_versions v
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
    'occurredOn', to_jsonb(v.occurred_on),
    'createdAt', to_jsonb(e.created_at),
    'versionNo', e.current_version_no,
    'title', v.title,
    'merchantName', v.merchant_name,
    'expenseType', v.expense_type,
    'totalCents', v.total_cents,
    'myShareCents', COALESCE(part.my_share_cents, 0),
    'myPaidCents', COALESCE(part.my_paid_cents, 0),
    'participantCount', CASE WHEN e.status = 'deleted'
      THEN jsonb_array_length(COALESCE(effective_expense_payload(e.id, e.current_version_no) -> 'participants', '[]'::jsonb))
      ELSE COALESCE(part.participant_count, 0)
    END
  ) INTO v_out
  FROM expenses e
  JOIN expense_versions v ON v.expense_id = e.id AND v.version_no = e.current_version_no
  LEFT JOIN LATERAL (
    SELECT
      sum(cep.share_cents) FILTER (WHERE cep.user_id = p_viewer)::integer AS my_share_cents,
      sum(cep.paid_cents) FILTER (WHERE cep.user_id = p_viewer)::integer AS my_paid_cents,
      count(*)::integer AS participant_count
    FROM current_expense_participants cep
    WHERE cep.expense_id = e.id
  ) part ON true
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

  RETURN v_out;
END;
$$;
