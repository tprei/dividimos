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
