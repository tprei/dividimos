-- Security audit fixes (2026-04-13)
--
-- [MEDIUM] expenses_delete: restrict to draft-only.
--   The DELETE policy had no status check, allowing a creator to delete
--   an active expense after activate_expense wrote balances — orphaning
--   the balance rows with no source expense.
--
-- [MEDIUM] record_and_settle: cap amount at R$100,000 (10_000_000 centavos).
--   Without a cap, any accepted member could create a ~R$21.4M settlement
--   against a co-member in a single call.
--
-- [LOW] group_members_insert: require inviter to be an ACCEPTED member.
--   Previously used my_group_ids() which includes invited-but-not-accepted
--   status, letting a non-accepted invitee send further invitations.

-- ============================================================
-- 1. expenses_delete — add status = 'draft' guard
-- ============================================================

DROP POLICY IF EXISTS "expenses_delete" ON public.expenses;

CREATE POLICY "expenses_delete" ON public.expenses
  FOR DELETE TO authenticated
  USING (
    creator_id = auth.uid()
    AND group_id IN (SELECT public.my_accepted_group_ids())
    AND status = 'draft'
  );

-- ============================================================
-- 2. record_and_settle — add amount cap (R$100,000)
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_and_settle(
  p_group_id     uuid,
  p_from_user_id uuid,
  p_to_user_id   uuid,
  p_amount_cents integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_counterparty uuid;
  v_user_a       uuid;
  v_user_b       uuid;
  v_delta        integer;
  v_id           uuid;
  v_is_dm        boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF v_caller != p_from_user_id AND v_caller != p_to_user_id THEN
    RAISE EXCEPTION 'permission_denied: caller must be debtor or creditor';
  END IF;

  IF p_group_id NOT IN (SELECT public.my_accepted_group_ids()) THEN
    RAISE EXCEPTION 'permission_denied: not a group member';
  END IF;

  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: must be positive';
  END IF;

  IF p_amount_cents > 10000000 THEN
    RAISE EXCEPTION 'invalid_amount: exceeds maximum of R$100.000,00';
  END IF;

  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION 'invalid_users: cannot settle with yourself';
  END IF;

  v_counterparty := CASE
    WHEN v_caller = p_from_user_id THEN p_to_user_id
    ELSE p_from_user_id
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id
      AND user_id = v_counterparty
  ) AND NOT EXISTS (
    SELECT 1 FROM public.groups
    WHERE id = p_group_id
      AND creator_id = v_counterparty
  ) THEN
    RAISE EXCEPTION 'permission_denied: counterparty is not a group member';
  END IF;

  INSERT INTO public.settlements (group_id, from_user_id, to_user_id, amount_cents, status, confirmed_at)
  VALUES (p_group_id, p_from_user_id, p_to_user_id, p_amount_cents, 'confirmed', now())
  RETURNING id INTO v_id;

  IF p_from_user_id < p_to_user_id THEN
    v_user_a := p_from_user_id;
    v_user_b := p_to_user_id;
    v_delta  := -p_amount_cents;
  ELSE
    v_user_a := p_to_user_id;
    v_user_b := p_from_user_id;
    v_delta  := p_amount_cents;
  END IF;

  INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
  VALUES (p_group_id, v_user_a, v_user_b, v_delta)
  ON CONFLICT (group_id, user_a, user_b)
  DO UPDATE SET
    amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
    updated_at   = now();

  SELECT is_dm INTO v_is_dm FROM public.groups WHERE id = p_group_id;

  IF v_is_dm THEN
    INSERT INTO public.chat_messages (group_id, sender_id, message_type, content, settlement_id)
    VALUES (
      p_group_id,
      v_caller,
      'system_settlement',
      '',
      v_id
    );
  END IF;

  RETURN v_id;
END;
$$;

-- ============================================================
-- 3. group_members_insert — require accepted membership
-- ============================================================

DROP POLICY IF EXISTS "group_members_insert" ON public.group_members;

CREATE POLICY "group_members_insert" ON public.group_members
  FOR INSERT TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND group_id IN (SELECT public.my_accepted_group_ids())
  );
