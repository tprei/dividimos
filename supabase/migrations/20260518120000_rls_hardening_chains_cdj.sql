-- RLS hardening — Chains C, D, J
--
-- Chain C (expense-actions.integration.test.ts / expense-tables.integration.test.ts):
--   Expense child-table mutating policies (expense_items, expense_shares,
--   expense_payers, expense_guests, expense_guest_shares) allowed writes to
--   active expenses.  Added status='draft' guard via EXISTS on public.expenses.
--   Source: supabase/migrations/20260328175000_expense_rls_accepted_only.sql:62-140
--           supabase/migrations/20260329205000_create_guest_tables.sql:68-104
--
-- Chain D (chat-messages.integration.test.ts):
--   chat_messages_insert permitted direct INSERT of system_expense /
--   system_settlement rows by authenticated clients.  Added message_type='text'
--   to WITH CHECK.  System messages still arrive via SECURITY DEFINER RPCs.
--   Source: supabase/migrations/20260412010000_rls_hardening.sql:107-112
--
-- Chain J (leave-group.integration.test.ts / settlement-actions.integration.test.ts):
--   J.1 — confirm_settlement lacked a debtor-membership check; the creditor
--         could confirm after the debtor had been removed.
--         Source: supabase/migrations/20260516120000_rpc_hardening_claim_lock_and_settlement_membership.sql:143-199
--   J.2 — leave_group left pending settlements in place, enabling a deferred
--         balance write against a user who has already left.
--         Source: supabase/migrations/20260401500000_leave_group_rpc.sql:13-72

-- ============================================================
-- Section 1 — expense child-table draft guards (Chain C)
-- ============================================================
-- The new predicate is an EXISTS on public.expenses with
-- id = expense_id, creator_id = auth.uid(), and status = 'draft'.
-- This subsumes the previous creator-only check.
-- SELECT policies are unchanged.
-- TO authenticated tightens role scope (previously defaulted to PUBLIC).

-- expense_items

DROP POLICY IF EXISTS expense_items_insert ON public.expense_items;
CREATE POLICY expense_items_insert ON public.expense_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  );

DROP POLICY IF EXISTS expense_items_update ON public.expense_items;
CREATE POLICY expense_items_update ON public.expense_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  );

DROP POLICY IF EXISTS expense_items_delete ON public.expense_items;
CREATE POLICY expense_items_delete ON public.expense_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  );

-- expense_shares

DROP POLICY IF EXISTS expense_shares_insert ON public.expense_shares;
CREATE POLICY expense_shares_insert ON public.expense_shares
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  );

DROP POLICY IF EXISTS expense_shares_update ON public.expense_shares;
CREATE POLICY expense_shares_update ON public.expense_shares
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  );

DROP POLICY IF EXISTS expense_shares_delete ON public.expense_shares;
CREATE POLICY expense_shares_delete ON public.expense_shares
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  );

-- expense_payers

DROP POLICY IF EXISTS expense_payers_insert ON public.expense_payers;
CREATE POLICY expense_payers_insert ON public.expense_payers
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  );

DROP POLICY IF EXISTS expense_payers_update ON public.expense_payers;
CREATE POLICY expense_payers_update ON public.expense_payers
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  );

DROP POLICY IF EXISTS expense_payers_delete ON public.expense_payers;
CREATE POLICY expense_payers_delete ON public.expense_payers
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  );

-- expense_guests

DROP POLICY IF EXISTS expense_guests_insert ON public.expense_guests;
CREATE POLICY expense_guests_insert ON public.expense_guests
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  );

DROP POLICY IF EXISTS expense_guests_update ON public.expense_guests;
CREATE POLICY expense_guests_update ON public.expense_guests
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  );

DROP POLICY IF EXISTS expense_guests_delete ON public.expense_guests;
CREATE POLICY expense_guests_delete ON public.expense_guests
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  );

-- expense_guest_shares

DROP POLICY IF EXISTS expense_guest_shares_insert ON public.expense_guest_shares;
CREATE POLICY expense_guest_shares_insert ON public.expense_guest_shares
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  );

DROP POLICY IF EXISTS expense_guest_shares_update ON public.expense_guest_shares;
CREATE POLICY expense_guest_shares_update ON public.expense_guest_shares
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  );

DROP POLICY IF EXISTS expense_guest_shares_delete ON public.expense_guest_shares;
CREATE POLICY expense_guest_shares_delete ON public.expense_guest_shares
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = expense_id
        AND creator_id = auth.uid()
        AND status = 'draft'
    )
  );

-- ============================================================
-- Section 2 — chat_messages_insert message_type guard (Chain D)
-- ============================================================
-- Blocks direct authenticated INSERT of system_expense / system_settlement
-- rows. Those types are only ever written by activate_expense and
-- record_and_settle, both SECURITY DEFINER (RLS bypassed).

DROP POLICY IF EXISTS "chat_messages_insert" ON public.chat_messages;

CREATE POLICY "chat_messages_insert" ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND group_id IN (SELECT public.my_accepted_group_ids())
    AND message_type = 'text'
  );

-- ============================================================
-- Section 3 — confirm_settlement debtor membership guard (Chain J.1)
-- ============================================================
-- Copied verbatim from 20260516120000_rpc_hardening_claim_lock_and_settlement_membership.sql:143-199
-- with one addition: after the creditor group-membership check, verify the
-- debtor (from_user_id) is still an accepted member or the group creator.
-- my_accepted_group_ids() only resolves for auth.uid(), so the debtor check
-- uses a direct EXISTS on public.group_members + public.groups.

CREATE OR REPLACE FUNCTION public.confirm_settlement(p_settlement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_settlement RECORD;
  v_user_a     uuid;
  v_user_b     uuid;
  v_delta      integer;
BEGIN
  SELECT *
    INTO v_settlement
    FROM public.settlements
   WHERE id = p_settlement_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_not_found: %', p_settlement_id;
  END IF;

  IF v_settlement.to_user_id != auth.uid() THEN
    RAISE EXCEPTION 'permission_denied: only the payee can confirm';
  END IF;

  IF v_settlement.group_id NOT IN (SELECT public.my_accepted_group_ids()) THEN
    RAISE EXCEPTION 'permission_denied: caller is no longer a member of the group';
  END IF;

  IF v_settlement.status != 'pending' THEN
    RAISE EXCEPTION 'invalid_status: settlement is %, expected pending', v_settlement.status;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = v_settlement.group_id
      AND user_id   = v_settlement.from_user_id
      AND status    = 'accepted'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.groups
    WHERE id         = v_settlement.group_id
      AND creator_id = v_settlement.from_user_id
  ) THEN
    RAISE EXCEPTION 'permission_denied: debtor is no longer a member of the group';
  END IF;

  IF v_settlement.from_user_id < v_settlement.to_user_id THEN
    v_user_a := v_settlement.from_user_id;
    v_user_b := v_settlement.to_user_id;
    v_delta  := -v_settlement.amount_cents;
  ELSE
    v_user_a := v_settlement.to_user_id;
    v_user_b := v_settlement.from_user_id;
    v_delta  := v_settlement.amount_cents;
  END IF;

  INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
  VALUES (v_settlement.group_id, v_user_a, v_user_b, v_delta)
  ON CONFLICT (group_id, user_a, user_b)
  DO UPDATE SET
    amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
    updated_at   = now();

  UPDATE public.settlements
     SET status       = 'confirmed',
         confirmed_at = now()
   WHERE id = p_settlement_id;
END;
$$;

-- ============================================================
-- Section 4 — leave_group pending-settlement cleanup (Chain J.2)
-- ============================================================
-- Copied verbatim from 20260401500000_leave_group_rpc.sql:13-72 with one
-- addition: before the zero-balance DELETE, remove any pending settlements
-- involving the leaver.  chat_messages.settlement_id is ON DELETE SET NULL,
-- so system_settlement messages retain their audit record with a NULL FK.
-- has_outstanding_balance runs first, so a non-zero confirmed balance still
-- blocks the leave before this cleanup code is reached.

CREATE OR REPLACE FUNCTION public.leave_group(
  p_group_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_group_creator uuid;
  v_member_status text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT creator_id INTO v_group_creator
  FROM public.groups
  WHERE id = p_group_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;

  IF v_caller = v_group_creator THEN
    RAISE EXCEPTION 'invalid_operation: group creator cannot leave the group';
  END IF;

  SELECT status INTO v_member_status
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member: you are not a member of this group';
  END IF;

  IF v_member_status != 'accepted' THEN
    RAISE EXCEPTION 'not_accepted: only accepted members can leave a group (use decline for invitations)';
  END IF;

  IF public.has_outstanding_balance(p_group_id, v_caller) THEN
    RAISE EXCEPTION 'has_outstanding_balance: you have unsettled debts in this group';
  END IF;

  DELETE FROM public.settlements
  WHERE group_id    = p_group_id
    AND status      = 'pending'
    AND (from_user_id = v_caller OR to_user_id = v_caller);

  DELETE FROM public.balances
  WHERE group_id = p_group_id
    AND (user_a = v_caller OR user_b = v_caller)
    AND amount_cents = 0;

  DELETE FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller;
END;
$$;
