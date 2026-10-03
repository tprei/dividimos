-- A soft-deleted bill must stay readable with its full participant list:
-- get_expense reads the any-status view so the bill screen still shows who
-- split and who paid after a delete, while balances and party checks keep
-- using the active-only projection.
CREATE VIEW public.expense_participants_any_status WITH (security_invoker = true) AS
SELECT e.id AS expense_id,
       (participant.ordinality - 1)::integer AS participant_index,
       CASE
         WHEN claimed.claimed_by IS NOT NULL THEN 'user'::public.participant_kind
         ELSE (participant.value->>'kind')::public.participant_kind
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
 AND claimed.claimed_by IS NOT NULL;

REVOKE ALL ON public.expense_participants_any_status FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.expense_participants_any_status TO service_role;

CREATE OR REPLACE VIEW public.current_expense_participants WITH (security_invoker = true) AS
SELECT p.expense_id, p.participant_index, p.kind, p.user_id, p.guest_id, p.share_cents, p.paid_cents
FROM public.expense_participants_any_status p
JOIN public.expenses e ON e.id = p.expense_id
WHERE e.status = 'active';

REVOKE ALL ON public.current_expense_participants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.current_expense_participants TO service_role;

CREATE OR REPLACE FUNCTION public.get_expense(p_expense_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_group_id uuid;
  v_out jsonb;
BEGIN
  v_user_id := public.current_user_id();
  SELECT group_id INTO v_group_id FROM public.expenses WHERE id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_found';
  END IF;
  PERFORM public.assert_member(v_group_id, v_user_id);
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
    'current', public.ledger_expense_version_json(e.id, e.current_version_no),
    'versions', COALESCE((
      SELECT jsonb_agg(public.ledger_expense_version_json(v.expense_id, v.version_no) ORDER BY v.version_no DESC)
      FROM public.expense_versions v
      WHERE v.expense_id = e.id
    ), '[]'::jsonb),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'participantIndex', ep.participant_index,
        'kind', ep.kind,
        'shareCents', ep.share_cents,
        'paidCents', ep.paid_cents,
        'user', COALESCE(public.ledger_user_profile_json(ep.user_id), 'null'::jsonb),
        'guest', COALESCE((
          SELECT jsonb_build_object('id', gst.id, 'displayName', gst.display_name, 'claimedBy', gst.claimed_by, 'claimLinkGeneration', COALESCE((SELECT ct.generation FROM guest_credentials.claim_tokens ct WHERE ct.guest_id = gst.id), 0))
          FROM public.guests gst
          WHERE gst.id = ep.guest_id
        ), 'null'::jsonb)
      ) ORDER BY ep.participant_index ASC)
      FROM public.expense_participants_any_status ep
      WHERE ep.expense_id = e.id
    ), '[]'::jsonb),
    'group', (
      SELECT jsonb_build_object('id', gg.id, 'name', gg.name, 'kind', gg.kind)
      FROM public.groups gg
      WHERE gg.id = e.group_id
    )
  ) INTO v_out
  FROM public.expenses e
  JOIN public.expense_versions v ON v.expense_id = e.id AND v.version_no = e.current_version_no
  WHERE e.id = p_expense_id;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.get_expense(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_expense(uuid) TO authenticated;
