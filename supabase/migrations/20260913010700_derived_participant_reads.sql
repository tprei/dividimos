-- P10: Derived current participants view and read cutover
--
-- Adds public.current_expense_participants as a security_invoker view
-- deriving the current active participant projection directly from
-- expense_versions.payload and public.guests claim metadata.
-- Cuts over recompute_group_balances and ledger_expense_summary_json to read from the view.

CREATE OR REPLACE VIEW public.current_expense_participants WITH (security_invoker = true) AS
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

CREATE OR REPLACE FUNCTION public.recompute_group_balances(p_group_id uuid) RETURNS bigint
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
REVOKE ALL ON FUNCTION public.recompute_group_balances(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_group_balances(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ledger_expense_summary_json(p_expense_id uuid, p_viewer uuid) RETURNS jsonb
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
REVOKE ALL ON FUNCTION public.ledger_expense_summary_json(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_expense_summary_json(uuid, uuid) TO service_role;
