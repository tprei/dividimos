-- 717a: acknowledge chat with validated message watermarks.

drop function if exists "public"."mark_read"(p_group_id uuid);

alter table "public"."conversation_reads" add column "last_read_message_id" uuid;

alter table "public"."conversation_reads" add constraint "conversation_reads_last_read_message_id_fkey" FOREIGN KEY (last_read_message_id) REFERENCES public.chat_messages(id) not valid;

alter table "public"."conversation_reads" validate constraint "conversation_reads_last_read_message_id_fkey";

-- Existing receipts are wall-clock timestamps. Resolve each to the newest
-- incoming message at or before it, and drop receipts that name nothing:
-- an unresolvable receipt must not silently acknowledge later messages.
DELETE FROM public.conversation_reads cr
WHERE NOT EXISTS (
  SELECT 1
  FROM public.chat_messages m
  WHERE m.group_id = cr.group_id
    AND m.sender_id <> cr.user_id
    AND m.created_at <= cr.last_read_at
);

WITH latest AS (
  SELECT cr.user_id, cr.group_id, m.id, m.created_at,
    row_number() OVER (
      PARTITION BY cr.user_id, cr.group_id
      ORDER BY m.created_at DESC, m.id DESC
    ) AS row_no
  FROM public.conversation_reads cr
  JOIN public.chat_messages m
    ON m.group_id = cr.group_id
   AND m.sender_id <> cr.user_id
   AND m.created_at <= cr.last_read_at
)
UPDATE public.conversation_reads cr
SET last_read_at = latest.created_at,
    last_read_message_id = latest.id
FROM latest
WHERE latest.row_no = 1
  AND latest.user_id = cr.user_id
  AND latest.group_id = cr.group_id;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.mark_read(p_group_id uuid, p_last_read_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_last_read_at timestamptz;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL OR p_last_read_message_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM assert_member(p_group_id, v_actor);

  SELECT created_at
  INTO v_last_read_at
  FROM chat_messages
  WHERE id = p_last_read_message_id
    AND group_id = p_group_id
    AND sender_id <> v_actor;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  INSERT INTO conversation_reads (user_id, group_id, last_read_at, last_read_message_id)
  VALUES (v_actor, p_group_id, v_last_read_at, p_last_read_message_id)
  ON CONFLICT (user_id, group_id)
  DO UPDATE
  SET last_read_at = EXCLUDED.last_read_at,
      last_read_message_id = EXCLUDED.last_read_message_id
  WHERE conversation_reads.last_read_message_id IS NULL
     OR (EXCLUDED.last_read_at, EXCLUDED.last_read_message_id)
        > (conversation_reads.last_read_at, conversation_reads.last_read_message_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ledger_group_snapshot_json(p_group_id uuid, p_viewer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.send_message(p_client_id uuid, p_group_id uuid, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_content text;
  v_existing_id uuid;
  v_existing_sender uuid;
  v_existing_group uuid;
  v_message_id uuid;
  v_created_at timestamptz;
  v_result jsonb;
BEGIN
  v_actor := current_user_id();

  IF p_client_id IS NULL OR p_group_id IS NULL OR p_content IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  v_content := trim(p_content);
  IF length(v_content) < 1 OR length(v_content) > 2000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  -- Serialise message creation with reads and other chat writers for this group.
  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  SELECT id, sender_id, group_id INTO v_existing_id, v_existing_sender, v_existing_group
  FROM chat_messages
  WHERE client_id = p_client_id;

  IF FOUND THEN
    IF v_existing_sender <> v_actor OR v_existing_group <> p_group_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    RETURN public.ledger_chat_message_json(v_existing_id);
  END IF;

  SELECT GREATEST(
    clock_timestamp(),
    COALESCE(max(created_at) + interval '1 microsecond', '-infinity'::timestamptz)
  )
  INTO v_created_at
  FROM chat_messages
  WHERE group_id = p_group_id;

  -- Concurrent retries of the same client_id must both resolve to one row.
  INSERT INTO chat_messages (client_id, group_id, sender_id, content, created_at)
  VALUES (p_client_id, p_group_id, v_actor, v_content, v_created_at)
  ON CONFLICT (client_id) DO NOTHING
  RETURNING id INTO v_message_id;

  IF v_message_id IS NULL THEN
    SELECT id, sender_id, group_id INTO v_existing_id, v_existing_sender, v_existing_group
    FROM chat_messages WHERE client_id = p_client_id;
    IF v_existing_sender <> v_actor OR v_existing_group <> p_group_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    RETURN public.ledger_chat_message_json(v_existing_id);
  END IF;

  v_result := public.ledger_chat_message_json(v_message_id);

  PERFORM realtime.send(v_result, 'message', 'chat:' || p_group_id::text, true);

  RETURN v_result;
END;
$function$
;



REVOKE ALL ON FUNCTION public.send_message(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_read(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_read(uuid, uuid) TO authenticated;
