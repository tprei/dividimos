CREATE VIEW public.current_expense_participants WITH (security_invoker = true) AS
SELECT e.id AS expense_id,
       (participant.ordinality - 1)::integer AS participant_index,
       CASE
         WHEN claimed.claimed_by IS NOT NULL THEN 'user'::participant_kind
         ELSE (participant.value->>'kind')::participant_kind
       END AS kind,
       CASE
         WHEN claimed.claimed_by IS NOT NULL THEN claimed.claimed_by
         WHEN participant.value->>'kind' = 'user' THEN (participant.value->>'userId')::uuid
         ELSE NULL
       END AS user_id,
       CASE
         WHEN claimed.claimed_by IS NOT NULL THEN NULL
         WHEN participant.value->>'kind' = 'guest' AND participant.value ? 'guestId' AND (participant.value->>'guestId') ~ '^[0-9a-fA-F-]{36}$'
           THEN (participant.value->>'guestId')::uuid
         ELSE NULL
       END AS guest_id,
       (ev.payload->'shares'->>((participant.ordinality - 1)::integer))::integer AS share_cents,
       COALESCE(paid.paid_cents, 0)::integer AS paid_cents
FROM public.expenses e
JOIN public.expense_versions ev ON ev.expense_id = e.id AND ev.version_no = e.current_version_no
CROSS JOIN LATERAL jsonb_array_elements(ev.payload->'participants') WITH ORDINALITY AS participant(value, ordinality)
LEFT JOIN LATERAL (
  SELECT sum((payer.value->>'amountCents')::integer)::integer AS paid_cents
  FROM jsonb_array_elements(COALESCE(ev.payload->'payers', '[]'::jsonb)) AS payer(value)
  WHERE (payer.value->>'participantIndex')::integer = (participant.ordinality - 1)::integer
) paid ON true
LEFT JOIN public.guests claimed
  ON claimed.expense_id = e.id
 AND participant.value->>'kind' = 'guest'
 AND participant.value ? 'guestId'
 AND (participant.value->>'guestId') ~ '^[0-9a-fA-F-]{36}$'
 AND claimed.id = (participant.value->>'guestId')::uuid
 AND claimed.claimed_version_no = e.current_version_no
 AND claimed.claimed_by IS NOT NULL
WHERE e.status = 'active';

REVOKE ALL ON public.current_expense_participants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.current_expense_participants TO service_role;

CREATE FUNCTION public.current_user_id() RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT auth.uid() INTO v_user_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'unauthenticated';
  END IF;
  RETURN v_user_id;
END;
$$;

CREATE FUNCTION public.assert_member(p_group_id uuid, p_user_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_id AND status = 'accepted'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
  END IF;
END;
$$;

CREATE FUNCTION public.assert_member_or_invited(p_group_id uuid, p_user_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_id AND status IN ('invited', 'accepted')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
  END IF;
END;
$$;

CREATE FUNCTION public.is_member(p_group_id uuid, p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_id AND status = 'accepted'
  )
$$;

CREATE FUNCTION public.is_member_or_invited(p_group_id uuid, p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_id AND status IN ('invited', 'accepted')
  )
$$;

CREATE FUNCTION public.lock_group(p_group_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'group_not_found';
  END IF;
END;
$$;

CREATE FUNCTION public.lock_receipt_key(p_creator_id uuid, p_chave_acesso text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_chave_acesso IS NULL THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_creator_id::text || ':' || p_chave_acesso, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lock_receipt_key(uuid, text) FROM public, anon, authenticated;

CREATE FUNCTION public.recompute_group_balances(p_group_id uuid) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_version bigint;
BEGIN
  DELETE FROM group_balances WHERE group_id = p_group_id;
  INSERT INTO group_balances (group_id, kind, participant_id, net_cents)
  SELECT p_group_id, kind, participant_id, SUM(delta)
  FROM (
    SELECT cep.kind, COALESCE(cep.user_id, cep.guest_id) AS participant_id,
           (cep.paid_cents - cep.share_cents)::bigint AS delta
    FROM current_expense_participants cep
    JOIN expenses e ON e.id = cep.expense_id
    WHERE e.group_id = p_group_id
    UNION ALL
    SELECT 'user'::participant_kind, s.from_user_id, s.amount_cents::bigint FROM settlements s
     WHERE s.group_id = p_group_id AND s.status = 'confirmed'
    UNION ALL
    SELECT 'user'::participant_kind, s.to_user_id, -s.amount_cents::bigint FROM settlements s
     WHERE s.group_id = p_group_id AND s.status = 'confirmed'
  ) t
  GROUP BY kind, participant_id
  HAVING SUM(delta) <> 0;
  UPDATE groups SET ledger_version = ledger_version + 1 WHERE id = p_group_id
    RETURNING ledger_version INTO v_version;
  RETURN v_version;
END;
$$;

CREATE FUNCTION public.emit_event(
  p_group_id uuid, p_kind event_kind, p_actor uuid,
  p_expense_id uuid DEFAULT NULL, p_settlement_id uuid DEFAULT NULL,
  p_subject_user_id uuid DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_event_id bigint;
BEGIN
  INSERT INTO group_events (group_id, actor_id, kind, expense_id, settlement_id, subject_user_id, payload)
  VALUES (p_group_id, p_actor, p_kind, p_expense_id, p_settlement_id, p_subject_user_id, p_payload)
  RETURNING id INTO v_event_id;
  RETURN v_event_id;
END;
$$;

CREATE FUNCTION public.broadcast_group(p_group_id uuid, p_ledger_version bigint, p_event_id bigint) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('group_id', p_group_id, 'ledger_version', p_ledger_version, 'event_id', p_event_id),
    'ledger', 'group:' || p_group_id::text, true
  );
END;
$$;

CREATE FUNCTION public.broadcast_user(p_user_id uuid, p_group_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('group_id', p_group_id),
    'membership', 'user:' || p_user_id::text, true
  );
END;
$$;
