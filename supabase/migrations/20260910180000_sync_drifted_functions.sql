-- Sync an existing remote database to the current baseline.
--
-- The baseline migration is regenerated in place, so a database that already
-- recorded it never receives later schema changes. This migration carries the
-- function definitions that drifted, taken verbatim from the baseline.

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.pairwise_from_nets(
  p_kinds participant_kind[],
  p_ids uuid[],
  p_nets bigint[]
)
RETURNS TABLE (from_kind participant_kind, from_id uuid, to_id uuid, amount_cents bigint)
  LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  v_count integer := COALESCE(array_length(p_ids, 1), 0);
  v_debtor_kinds participant_kind[];
  v_debtor_ids uuid[];
  v_debtor_open bigint[];
  v_creditor_ids uuid[];
  v_creditor_open bigint[];
  v_di integer := 1;
  v_ci integer := 1;
  v_amount bigint;
BEGIN
  SELECT COALESCE(array_agg(n.kind ORDER BY n.net ASC, n.pid ASC), '{}'),
         COALESCE(array_agg(n.pid ORDER BY n.net ASC, n.pid ASC), '{}'),
         COALESCE(array_agg(-n.net ORDER BY n.net ASC, n.pid ASC), '{}')
    INTO v_debtor_kinds, v_debtor_ids, v_debtor_open
    FROM (
      SELECT p_kinds[g] AS kind, p_ids[g] AS pid, p_nets[g] AS net
      FROM generate_series(1, v_count) AS g
    ) n
   WHERE n.net < 0;
  SELECT COALESCE(array_agg(n.pid ORDER BY n.net DESC, n.pid ASC), '{}'),
         COALESCE(array_agg(n.net ORDER BY n.net DESC, n.pid ASC), '{}')
    INTO v_creditor_ids, v_creditor_open
    FROM (
      SELECT p_ids[g] AS pid, p_nets[g] AS net
      FROM generate_series(1, v_count) AS g
    ) n
   WHERE n.net > 0;

  WHILE v_di <= COALESCE(array_length(v_debtor_ids, 1), 0)
    AND v_ci <= COALESCE(array_length(v_creditor_ids, 1), 0) LOOP
    v_amount := LEAST(v_debtor_open[v_di], v_creditor_open[v_ci]);
    EXIT WHEN v_amount <= 0;
    from_kind := v_debtor_kinds[v_di];
    from_id := v_debtor_ids[v_di];
    to_id := v_creditor_ids[v_ci];
    amount_cents := v_amount;
    RETURN NEXT;
    v_debtor_open[v_di] := v_debtor_open[v_di] - v_amount;
    v_creditor_open[v_ci] := v_creditor_open[v_ci] - v_amount;
    IF v_debtor_open[v_di] <= 0 THEN v_di := v_di + 1; END IF;
    IF v_creditor_open[v_ci] <= 0 THEN v_ci := v_ci + 1; END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.group_pairwise_edges(p_group_id uuid)
RETURNS TABLE (from_kind participant_kind, from_id uuid, to_id uuid, amount_cents bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH nets AS (
    SELECT e.id AS expense_id,
           ep.kind,
           COALESCE(ep.user_id, ep.guest_id) AS participant_id,
           (ep.paid_cents - ep.share_cents)::bigint AS net
      FROM public.expenses e
      JOIN public.expense_participants ep ON ep.expense_id = e.id
     WHERE e.group_id = p_group_id AND e.status = 'active'
  ),
  expense_edges AS (
    SELECT one.expense_id, f.from_kind, f.from_id, f.to_id, f.amount_cents
      FROM (SELECT DISTINCT n.expense_id FROM nets n) one
      CROSS JOIN LATERAL public.pairwise_from_nets(
             COALESCE((SELECT array_agg(n.kind ORDER BY n.kind, n.participant_id)
                         FROM nets n WHERE n.expense_id = one.expense_id), '{}'::participant_kind[]),
             COALESCE((SELECT array_agg(n.participant_id ORDER BY n.kind, n.participant_id)
                         FROM nets n WHERE n.expense_id = one.expense_id), '{}'),
             COALESCE((SELECT array_agg(n.net ORDER BY n.kind, n.participant_id)
                         FROM nets n WHERE n.expense_id = one.expense_id), '{}')
           ) f
  ),
  edge_with_kinds AS (
    SELECT ee.from_id, ee.to_id, ee.from_kind, kt.kind AS to_kind, ee.amount_cents
      FROM expense_edges ee
      JOIN nets kt ON kt.expense_id = ee.expense_id AND kt.participant_id = ee.to_id
  ),
  normalized AS (
    SELECT CASE WHEN k.from_id < k.to_id THEN k.from_id ELSE k.to_id END AS left_id,
           CASE WHEN k.from_id < k.to_id THEN k.to_id ELSE k.from_id END AS right_id,
           CASE WHEN k.from_id < k.to_id THEN k.from_kind ELSE k.to_kind END AS left_kind,
           CASE WHEN k.from_id < k.to_id THEN k.to_kind ELSE k.from_kind END AS right_kind,
           CASE WHEN k.from_id < k.to_id THEN k.amount_cents ELSE -k.amount_cents END AS amount
      FROM edge_with_kinds k
  ),
  settlement_deltas AS (
    SELECT CASE WHEN s.from_user_id < s.to_user_id THEN s.from_user_id ELSE s.to_user_id END AS left_id,
           CASE WHEN s.from_user_id < s.to_user_id THEN s.to_user_id ELSE s.from_user_id END AS right_id,
           'user'::participant_kind AS left_kind,
           'user'::participant_kind AS right_kind,
           CASE WHEN s.from_user_id < s.to_user_id THEN -s.amount_cents ELSE s.amount_cents END AS amount
      FROM public.settlements s
     WHERE s.group_id = p_group_id AND s.status = 'confirmed'
  ),
  combined AS (
    SELECT d.left_id,
           d.right_id,
           MAX(d.left_kind) AS left_kind,
           MAX(d.right_kind) AS right_kind,
           SUM(d.amount) AS net
      FROM (
        SELECT left_id, right_id, left_kind, right_kind, amount FROM normalized
        UNION ALL
        SELECT left_id, right_id, left_kind, right_kind, amount FROM settlement_deltas
      ) d
     GROUP BY d.left_id, d.right_id
  )
  SELECT (CASE WHEN c.net > 0 THEN c.left_kind ELSE c.right_kind END)::participant_kind,
         (CASE WHEN c.net > 0 THEN c.left_id ELSE c.right_id END)::uuid,
         (CASE WHEN c.net > 0 THEN c.right_id ELSE c.left_id END)::uuid,
         (CASE WHEN c.net > 0 THEN c.net ELSE -c.net END)::bigint
    FROM combined c
   WHERE c.net <> 0
   ORDER BY 1, 2, 3;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_member_or_invited(p_group_id uuid, p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_id AND status IN ('invited', 'accepted')
  )
$$;

CREATE OR REPLACE FUNCTION public.materialize_participants(p_expense_id uuid, p_author uuid, p_payload jsonb)
RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_participants jsonb;
  v_n integer;
  v_i integer;
  v_participant jsonb;
  v_user_id uuid;
  v_guest_id uuid;
  v_new_guest_id uuid;
  v_display_name text;
  v_claimed_by uuid;
  v_share integer;
  v_paid integer;
  v_payers jsonb;
  v_j integer;
  v_payer jsonb;
  v_out_participants jsonb := '[]'::jsonb;
  v_out jsonb;
  v_seen_users uuid[] := '{}';
  v_current_version integer;
  v_prev_payload jsonb;
  v_existing_user_ids uuid[] := '{}';
BEGIN
  SELECT e.group_id, e.current_version_no INTO v_group_id, v_current_version
  FROM expenses e WHERE e.id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  SELECT payload INTO v_prev_payload FROM expense_versions
  WHERE expense_id = p_expense_id AND version_no = v_current_version;
  SELECT COALESCE(array_agg((pa.el->>'userId')::uuid), '{}') INTO v_existing_user_ids
  FROM jsonb_array_elements(COALESCE(v_prev_payload->'participants', '[]'::jsonb)) AS pa(el)
  WHERE pa.el->>'kind' = 'user' AND pa.el ? 'userId';

  v_participants := p_payload->'participants';
  v_n := jsonb_array_length(v_participants);
  v_payers := COALESCE(p_payload->'payers', '[]'::jsonb);

  DELETE FROM expense_participants WHERE expense_id = p_expense_id;

  v_i := 0;
  WHILE v_i < v_n LOOP
    v_participant := v_participants->v_i;
    v_user_id := NULL;
    v_guest_id := NULL;
    v_new_guest_id := NULL;
    v_claimed_by := NULL;
    v_display_name := NULL;
    IF v_participant->>'kind' = 'user' THEN
      v_user_id := (v_participant->>'userId')::uuid;
      IF NOT is_member_or_invited(v_group_id, v_user_id)
         AND NOT (v_user_id = ANY (v_existing_user_ids)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
      END IF;
    ELSIF v_participant->>'kind' = 'guest' THEN
      v_display_name := v_participant->>'displayName';
      IF jsonb_typeof(v_participant->'guestId') = 'string' THEN
        v_guest_id := (v_participant->>'guestId')::uuid;
        SELECT id, claimed_by INTO v_new_guest_id, v_claimed_by
        FROM guests WHERE id = v_guest_id AND expense_id = p_expense_id;
        IF v_new_guest_id IS NULL THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
        END IF;
      ELSE
        INSERT INTO guests (expense_id, display_name) VALUES (p_expense_id, v_display_name)
        RETURNING id INTO v_new_guest_id;
      END IF;
      IF v_claimed_by IS NOT NULL THEN
        v_guest_id := NULL;
        v_user_id := v_claimed_by;
        IF NOT is_member_or_invited(v_group_id, v_user_id)
           AND NOT (v_user_id = ANY (v_existing_user_ids)) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
        END IF;
      ELSE
        v_guest_id := v_new_guest_id;
      END IF;
    ELSE
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;

    IF v_user_id IS NOT NULL THEN
      IF v_user_id = ANY (v_seen_users) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_participant';
      END IF;
      v_seen_users := array_append(v_seen_users, v_user_id);
    END IF;

    v_share := (p_payload->'shares'->v_i)::integer;
    v_paid := 0;
    v_j := 0;
    WHILE v_j < jsonb_array_length(v_payers) LOOP
      v_payer := v_payers->v_j;
      IF (v_payer->>'participantIndex')::integer = v_i THEN
        v_paid := v_paid + (v_payer->>'amountCents')::integer;
      END IF;
      v_j := v_j + 1;
    END LOOP;

    INSERT INTO expense_participants (expense_id, participant_index, kind, user_id, guest_id, share_cents, paid_cents)
    VALUES (
      p_expense_id, v_i,
      CASE WHEN v_user_id IS NOT NULL THEN 'user'::participant_kind ELSE 'guest'::participant_kind END,
      v_user_id, v_guest_id, v_share, v_paid
    );

    IF v_user_id IS NOT NULL THEN
      v_out_participants := v_out_participants || jsonb_build_object('kind', 'user', 'userId', v_user_id);
    ELSE
      v_out_participants := v_out_participants || jsonb_build_object('kind', 'guest', 'guestId', v_guest_id, 'displayName', v_display_name);
    END IF;
    v_i := v_i + 1;
  END LOOP;

  -- An unclaimed guest with no participant slot left is unreachable; its
  -- claim token would otherwise still redeem into group membership.
  DELETE FROM guests g
  WHERE g.expense_id = p_expense_id
    AND g.claimed_by IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM expense_participants ep
      WHERE ep.expense_id = p_expense_id AND ep.guest_id = g.id
    );

  v_out := jsonb_set(p_payload, '{participants}', v_out_participants);
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.group_transfers(p_group_id uuid)
RETURNS TABLE (from_kind participant_kind, from_id uuid, to_id uuid, amount_cents bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT f.from_kind, f.from_id, f.to_id, f.amount_cents
    FROM public.pairwise_from_nets(
           COALESCE((SELECT array_agg(gb.kind ORDER BY gb.kind, gb.participant_id)
                       FROM public.group_balances gb
                      WHERE gb.group_id = p_group_id), '{}'::participant_kind[]),
           COALESCE((SELECT array_agg(gb.participant_id ORDER BY gb.kind, gb.participant_id)
                       FROM public.group_balances gb
                      WHERE gb.group_id = p_group_id), '{}'),
           COALESCE((SELECT array_agg(gb.net_cents ORDER BY gb.kind, gb.participant_id)
                       FROM public.group_balances gb
                      WHERE gb.group_id = p_group_id), '{}')
         ) f;
END;
$$;

CREATE OR REPLACE FUNCTION public.ledger_group_snapshot_json(p_group_id uuid, p_viewer uuid) RETURNS jsonb
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

CREATE OR REPLACE FUNCTION public.get_expense(p_expense_id uuid) RETURNS jsonb
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

CREATE OR REPLACE FUNCTION public.issue_guest_claim_token(p_guest_id uuid)
RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_guest RECORD;
  v_bytes bytea;
  v_token text;
  v_digest bytea;
  v_generation integer;
BEGIN
  v_actor := current_user_id();

  IF p_guest_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_not_found';
  END IF;

  SELECT g.id, g.claimed_by, e.group_id
  INTO v_guest
  FROM guests g
  JOIN expenses e ON e.id = g.expense_id
  WHERE g.id = p_guest_id
  FOR UPDATE OF g;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_not_found';
  END IF;

  PERFORM assert_member(v_guest.group_id, v_actor);

  IF v_guest.claimed_by IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_already_claimed';
  END IF;
  SELECT generation INTO v_generation
  FROM guest_credentials.claim_tokens
  WHERE guest_id = p_guest_id;

  IF v_generation >= 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_link_replacement_limit';
  END IF;

  v_bytes := extensions.gen_random_bytes(32);
  v_token := 'gst1_' || rtrim(translate(encode(v_bytes, 'base64'), '+/', '-_'), '=');
  v_digest := extensions.digest(convert_to(v_token, 'utf8'), 'sha256');

  INSERT INTO guest_credentials.claim_tokens AS ct (guest_id, token_digest, generation, created_at)
  VALUES (p_guest_id, v_digest, 1, now())
  ON CONFLICT (guest_id)
  DO UPDATE SET token_digest = EXCLUDED.token_digest,
                generation = ct.generation + 1,
                created_at = now();

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_invitation(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_invited_by uuid;
  v_kind group_kind;
  v_expense_id uuid;
  v_title text;
  v_total_cents integer;
  v_event_id bigint;
  v_invalidated boolean := false;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

  SELECT status, invited_by INTO v_status, v_invited_by FROM group_members
  WHERE group_id = p_group_id AND user_id = v_actor
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'invited' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_invited';
  END IF;

  SELECT kind, ledger_version INTO v_kind, v_ledger_version FROM groups WHERE id = p_group_id;

  IF v_kind = 'dm' THEN
    IF v_invited_by IS NOT NULL THEN
      PERFORM broadcast_user(v_invited_by, p_group_id);
    END IF;
    DELETE FROM groups WHERE id = p_group_id;
  ELSE
    FOR v_expense_id, v_title, v_total_cents IN
      WITH declined_expenses AS (
        UPDATE expenses e
        SET status = 'deleted', deleted_at = now(), deleted_by = v_actor
        WHERE e.group_id = p_group_id
          AND e.status = 'active'
          AND EXISTS (
            SELECT 1 FROM expense_participants p
            WHERE p.expense_id = e.id AND p.user_id = v_actor
          )
        RETURNING e.id, e.current_version_no
      )
      SELECT d.id, ev.title, ev.total_cents
      FROM declined_expenses d
      JOIN expense_versions ev
        ON ev.expense_id = d.id AND ev.version_no = d.current_version_no
    LOOP
      v_event_id := emit_event(
        p_group_id, 'expense_deleted', v_actor, v_expense_id,
        NULL, NULL, jsonb_build_object('title', v_title, 'totalCents', v_total_cents)
      );
      v_invalidated := true;
    END LOOP;

    IF v_invalidated THEN
      v_ledger_version := recompute_group_balances(p_group_id);
      PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);
    END IF;

    DELETE FROM group_members
    WHERE group_id = p_group_id AND user_id = v_actor;
    IF v_invited_by IS NOT NULL THEN
      PERFORM broadcast_user(v_invited_by, p_group_id);
    END IF;
  END IF;


  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_profile(
  p_name text DEFAULT NULL,
  p_handle text DEFAULT NULL,
  p_notification_preferences jsonb DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_name text;
  v_handle text;
  v_user users;
BEGIN
  v_actor := current_user_id();

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
    IF EXISTS (SELECT 1 FROM users WHERE handle = v_handle AND id <> v_actor) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'handle_taken';
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

  UPDATE users
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
    'email', v_user.email,
    'pixKeyType', v_user.pix_key_type,
    'pixKeyHint', v_user.pix_key_hint,
    'onboarded', v_user.onboarded,
    'notificationPreferences', v_user.notification_preferences
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pairwise_from_nets(public.participant_kind[], uuid[], bigint[]) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.group_pairwise_edges(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_member_or_invited(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pairwise_from_nets(public.participant_kind[], uuid[], bigint[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.group_pairwise_edges(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_member_or_invited(uuid, uuid) TO service_role;
