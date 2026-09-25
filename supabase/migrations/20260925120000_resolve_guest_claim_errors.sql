-- resolve_guest_claim_token wrapped its whole body in WHEN OTHERS THEN
-- 'not_found', so any internal fault (a bug, a missing extension, a revoked
-- grant) was indistinguishable from an unknown or expired link and clients
-- told users the link no longer works instead of surfacing the failure.
-- Drop the handler and let errors propagate; the not_found responses for
-- empty/unknown/expired tokens are deliberate branches, not faults.
CREATE OR REPLACE FUNCTION public.resolve_guest_claim_token(p_token text)
RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_digest bytea;
  v_rec RECORD;
  v_status text;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN jsonb_build_object(
      'guestId', NULL,
      'displayName', NULL,
      'expenseTitle', NULL,
      'groupName', NULL,
      'shareCents', NULL,
      'status', 'not_found'
    );
  END IF;

  v_digest := extensions.digest(convert_to(p_token, 'utf8'), 'sha256');

  SELECT
    g.id AS guest_id,
    g.display_name,
    g.claimed_by,
    ev.title AS expense_title,
    grp.name AS group_name,
    COALESCE(ep.share_cents, 0) AS share_cents
  INTO v_rec
  FROM guest_credentials.claim_tokens ct
  JOIN public.guests g ON g.id = ct.guest_id
  JOIN public.expenses e ON e.id = g.expense_id
  JOIN public.expense_versions ev ON ev.expense_id = e.id AND ev.version_no = e.current_version_no
  JOIN public.groups grp ON grp.id = e.group_id
  LEFT JOIN public.current_expense_participants ep ON ep.expense_id = e.id AND ep.guest_id = g.id
  WHERE ct.token_digest = v_digest AND ct.expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'guestId', NULL,
      'displayName', NULL,
      'expenseTitle', NULL,
      'groupName', NULL,
      'shareCents', NULL,
      'status', 'not_found'
    );
  END IF;

  IF v_rec.claimed_by IS NOT NULL THEN
    v_status := 'already_claimed';
  ELSE
    v_status := 'ready';
  END IF;

  RETURN jsonb_build_object(
    'guestId', v_rec.guest_id,
    'displayName', v_rec.display_name,
    'expenseTitle', v_rec.expense_title,
    'groupName', v_rec.group_name,
    'shareCents', v_rec.share_cents,
    'status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_guest_claim_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_guest_claim_token(text) TO anon, authenticated;
