CREATE OR REPLACE FUNCTION public.ledger_chat_message_json(p_message_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
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
    'erased', m.erased_at IS NOT NULL,
    'createdAt', to_jsonb(m.created_at),
    'sender', COALESCE(public.ledger_user_profile_json(m.sender_id), 'null'::jsonb)
  ) INTO v_out
  FROM public.chat_messages m WHERE m.id = p_message_id;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.ledger_chat_message_json(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ledger_group_snapshot_json(p_group_id uuid, p_viewer uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
  v_status public.member_status;
BEGIN
  SELECT status INTO v_status
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_viewer;

  -- An invited user has not consented yet: they see who invited them and
  -- nothing about the group's money or conversation.
  IF v_status = 'invited' THEN
    RETURN (
      SELECT jsonb_build_object(
        'group', jsonb_build_object(
          'id', g.id, 'kind', g.kind, 'name', g.name,
          'creatorId', g.creator_id, 'dmUserA', g.dm_user_a, 'dmUserB', g.dm_user_b,
          'ledgerVersion', 0, 'createdAt', to_jsonb(g.created_at)
        ),
        'dmCounterparty', CASE WHEN g.kind = 'dm' THEN
          public.ledger_user_profile_json(CASE WHEN g.dm_user_a = p_viewer THEN g.dm_user_b ELSE g.dm_user_a END)
          ELSE 'null'::jsonb END,
        'members', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'groupId', gm.group_id, 'userId', gm.user_id, 'status', gm.status,
            'invitedBy', gm.invited_by, 'acceptedAt', to_jsonb(gm.accepted_at),
            'user', COALESCE(public.ledger_user_profile_json(gm.user_id), 'null'::jsonb)
          ) ORDER BY gm.created_at, gm.user_id)
          FROM public.group_members gm
          WHERE gm.group_id = g.id
            AND (gm.user_id = p_viewer OR gm.user_id = (
              SELECT invited_by FROM public.group_members
              WHERE group_id = p_group_id AND user_id = p_viewer
            ))
        ), '[]'::jsonb),
        'balances', '[]'::jsonb, 'guests', '[]'::jsonb,
        'settlements', '[]'::jsonb, 'pairwiseEdges', '[]'::jsonb,
        'recentExpenses', '[]'::jsonb, 'expenseCount', 0,
        'unreadCount', 0, 'lastMessage', 'null'::jsonb,
        'lastEventId', 0, 'lastActivityAt', 'null'::jsonb
      ) FROM public.groups g WHERE g.id = p_group_id
    );
  END IF;

  SELECT jsonb_build_object(
    'group', jsonb_build_object(
      'id', g.id, 'kind', g.kind, 'name', g.name,
      'creatorId', g.creator_id, 'dmUserA', g.dm_user_a, 'dmUserB', g.dm_user_b,
      'ledgerVersion', g.ledger_version, 'createdAt', to_jsonb(g.created_at)
    ),
    'dmCounterparty', CASE WHEN g.kind = 'dm' THEN
      public.ledger_user_profile_json(CASE WHEN g.dm_user_a = p_viewer THEN g.dm_user_b ELSE g.dm_user_a END)
      ELSE 'null'::jsonb END,
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'groupId', gm.group_id, 'userId', gm.user_id, 'status', gm.status,
        'invitedBy', gm.invited_by, 'acceptedAt', to_jsonb(gm.accepted_at),
        'user', COALESCE(public.ledger_user_profile_json(gm.user_id), 'null'::jsonb)
      ) ORDER BY gm.created_at, gm.user_id)
      FROM public.group_members gm WHERE gm.group_id = g.id
    ), '[]'::jsonb),
    'balances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', gb.kind, 'participantId', gb.participant_id, 'netCents', gb.net_cents
      ) ORDER BY gb.kind, gb.participant_id)
      FROM public.group_balances gb WHERE gb.group_id = g.id
    ), '[]'::jsonb),
    'guests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', gu.id, 'displayName', gu.display_name, 'expenseId', gu.expense_id
      ) ORDER BY gu.created_at, gu.id)
      FROM public.guests gu JOIN public.expenses e ON e.id = gu.expense_id
      WHERE e.group_id = g.id AND e.status = 'active' AND gu.claimed_by IS NULL
    ), '[]'::jsonb),
    'settlements', COALESCE((
      SELECT jsonb_agg(public.ledger_settlement_json(s.id) ORDER BY s.created_at DESC, s.id)
      FROM (
        SELECT id, created_at FROM public.settlements
        WHERE group_id = g.id AND status = 'confirmed'
        ORDER BY created_at DESC, id DESC LIMIT 50
      ) s
    ), '[]'::jsonb),
    'recentExpenses', COALESCE((
      SELECT jsonb_agg(public.ledger_expense_summary_json(e.id, p_viewer) ORDER BY e.created_at DESC, e.id DESC)
      FROM (
        SELECT id, created_at FROM public.expenses
        WHERE group_id = g.id ORDER BY created_at DESC, id DESC LIMIT 20
      ) e
    ), '[]'::jsonb),
    'lastEventId', COALESCE((SELECT max(ev.id) FROM public.group_events ev WHERE ev.group_id = g.id), 0),
    'unreadCount', (
      SELECT count(*)::integer FROM public.chat_messages m
      WHERE m.group_id = g.id AND m.sender_id <> p_viewer
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.conversation_reads cr
            WHERE cr.user_id = p_viewer AND cr.group_id = g.id
          ) OR EXISTS (
            SELECT 1 FROM public.conversation_reads cr
            WHERE cr.user_id = p_viewer AND cr.group_id = g.id
              AND (cr.last_read_message_id IS NULL
                OR (m.created_at, m.id) > (cr.last_read_at, cr.last_read_message_id))
          )
        )
    ),
    'lastMessage', COALESCE((
      SELECT jsonb_build_object(
        'content', m.content, 'erased', m.erased_at IS NOT NULL,
        'senderId', m.sender_id, 'createdAt', to_jsonb(m.created_at),
        'sender', public.ledger_user_profile_json(m.sender_id)
      ) FROM public.chat_messages m
      WHERE m.group_id = g.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1
    ), 'null'::jsonb),
    'lastActivityAt', to_jsonb(GREATEST(
      g.created_at,
      (SELECT max(ev.created_at) FROM public.group_events ev WHERE ev.group_id = g.id),
      (SELECT max(m.created_at) FROM public.chat_messages m WHERE m.group_id = g.id)
    )),
    'expenseCount', (SELECT count(*) FROM public.expenses e WHERE e.group_id = g.id AND e.status = 'active'),
    'pairwiseEdges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fromKind', pe.from_kind, 'fromId', pe.from_id,
        'toId', pe.to_id, 'amountCents', pe.amount_cents
      ) ORDER BY pe.from_kind, pe.from_id, pe.to_id)
      FROM public.group_pairwise_edges(g.id) pe
    ), '[]'::jsonb)
  ) INTO v_out
  FROM public.groups g WHERE g.id = p_group_id;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.ledger_group_snapshot_json(uuid, uuid) FROM PUBLIC, anon, authenticated;
