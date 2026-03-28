-- =========================================================================
-- Splitwise-style re-architecture: expense_shares ledger
-- =========================================================================
--
-- Replaces the fragmented ledger / payments / group_settlements system with
-- a single unified model inspired by Splitwise:
--
--   expense_shares(bill_id, user_id, paid_cents, owed_cents)
--
-- Every bill (expense or payment) writes one row per participant. The
-- net balance for a user across a group (or globally) is simply:
--
--   SUM(paid_cents) - SUM(owed_cents)
--
-- "Payments" between users are just special bills: the payer gets
-- paid_cents = amount and the receiver gets owed_cents = amount,
-- which zeroes the net for the payment bill itself but shifts the
-- overall balance in the right direction.
--
-- The create_payment() RPC atomically inserts a payment bill and its
-- offsetting shares in a single transaction, so balances are always
-- consistent.
--
-- This migration:
--   1. Creates the expense_shares table with computed net_cents column
--   2. Creates the create_payment RPC
--   3. Adds RLS policies for expense_shares
--   4. Drops the old ledger, payments, group_settlements tables
--      and all associated triggers, functions, indexes, enum types

-- =========================================================================
-- 1. expense_shares table
-- =========================================================================

CREATE TABLE public.expense_shares (
  bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  owed_cents INTEGER NOT NULL DEFAULT 0 CHECK (owed_cents >= 0),
  -- Computed net: positive = creditor (owed money), negative = debtor (owes money)
  net_cents INTEGER GENERATED ALWAYS AS (paid_cents - owed_cents) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bill_id, user_id)
);

CREATE INDEX idx_expense_shares_user ON public.expense_shares(user_id);
CREATE INDEX idx_expense_shares_bill ON public.expense_shares(bill_id);

ALTER TABLE public.expense_shares ENABLE ROW LEVEL SECURITY;

-- RLS: users can see shares for bills they participate in or created
CREATE POLICY "expense_shares_select"
  ON public.expense_shares FOR SELECT
  USING (bill_id IN (SELECT public.my_bill_ids()));

-- RLS: bill creators can manage shares for their bills
CREATE POLICY "expense_shares_manage"
  ON public.expense_shares FOR ALL
  USING (bill_id IN (SELECT id FROM public.bills WHERE creator_id = auth.uid()));

-- Add to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.expense_shares;

-- =========================================================================
-- 2. create_payment RPC
-- =========================================================================
-- Atomically records a payment from one user to another.
--
-- How it works:
--   - Creates a "payment" type bill (bill_type = 'payment')
--   - Inserts shares: payer gets paid_cents = amount, receiver gets owed_cents = amount
--   - This shifts the net balance: payer's total net decreases, receiver's increases
--
-- Payment math (Splitwise model):
--   paid_cents = what you physically paid; owed_cents = your share of the expense
--   net = paid - owed: positive = creditor (owed money), negative = debtor (owes money)
--
-- For a PAYMENT from debtor A to creditor B of amount X:
--   A: paid_cents = X, owed_cents = 0  → net = +X (reduces A's debt)
--   B: paid_cents = 0, owed_cents = X  → net = -X (reduces B's credit)

CREATE OR REPLACE FUNCTION public.create_payment(
  p_from_user_id UUID,
  p_to_user_id UUID,
  p_amount_cents INTEGER,
  p_group_id UUID DEFAULT NULL,
  p_creator_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bill_id UUID;
  v_creator UUID;
BEGIN
  -- Amount must be positive
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive'
      USING ERRCODE = '22P02'; -- invalid_text_representation
  END IF;

  -- Determine creator: use explicit creator_id, default to from_user_id (payer)
  v_creator := COALESCE(p_creator_id, p_from_user_id);

  -- Verify the caller is authorized (must be one of the parties)
  IF auth.uid() IS DISTINCT FROM p_from_user_id
     AND auth.uid() IS DISTINCT FROM p_to_user_id THEN
    RAISE EXCEPTION 'Not authorized to create this payment'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  -- If group_id specified, verify both users are members
  IF p_group_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_id = p_group_id AND user_id = p_from_user_id AND status = 'accepted'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.groups WHERE id = p_group_id AND creator_id = p_from_user_id
    ) THEN
      RAISE EXCEPTION 'Payer is not a member of this group'
        USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_id = p_group_id AND user_id = p_to_user_id AND status = 'accepted'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.groups WHERE id = p_group_id AND creator_id = p_to_user_id
    ) THEN
      RAISE EXCEPTION 'Receiver is not a member of this group'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Create the payment bill
  INSERT INTO public.bills (
    creator_id,
    title,
    bill_type,
    status,
    total_amount,
    total_amount_input,
    group_id
  ) VALUES (
    v_creator,
    'Payment',
    'payment',
    'active',
    p_amount_cents,
    p_amount_cents,
    p_group_id
  )
  RETURNING id INTO v_bill_id;

  -- Insert offsetting shares
  -- Payer (from_user): they paid X, owed 0 → net = +X (reduces their debt)
  INSERT INTO public.expense_shares (bill_id, user_id, paid_cents, owed_cents)
  VALUES (v_bill_id, p_from_user_id, p_amount_cents, 0);

  -- Receiver (to_user): they paid 0, owed X → net = -X (reduces their credit)
  INSERT INTO public.expense_shares (bill_id, user_id, paid_cents, owed_cents)
  VALUES (v_bill_id, p_to_user_id, 0, p_amount_cents);

  RETURN v_bill_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_payment(UUID, UUID, INTEGER, UUID, UUID) TO authenticated;

-- =========================================================================
-- 3. Helper function: compute net balances for a group
-- =========================================================================
-- Returns user_id and net_cents (positive = owed money, negative = owes money)
-- for all users in a group, based on all expense_shares for bills in that group.

CREATE OR REPLACE FUNCTION public.get_group_balances(p_group_id UUID)
RETURNS TABLE(user_id UUID, net_cents BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT es.user_id, SUM(es.net_cents)::BIGINT AS net_cents
  FROM public.expense_shares es
  JOIN public.bills b ON b.id = es.bill_id
  WHERE b.group_id = p_group_id
  GROUP BY es.user_id
  ORDER BY net_cents DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_balances(UUID) TO authenticated;

-- =========================================================================
-- 4. Add 'payment' to bill_type (bills.bill_type is TEXT, no enum needed)
-- =========================================================================
-- bills.bill_type is already TEXT, so 'payment' is just a value — no DDL needed.

-- =========================================================================
-- 5. Drop old tables, triggers, functions, indexes, enums
-- =========================================================================
-- Order matters: drop triggers first, then tables (which cascade indexes),
-- then standalone functions, then enum types.

-- 5a. Drop triggers
DROP TRIGGER IF EXISTS after_payment_insert ON public.payments;
DROP TRIGGER IF EXISTS after_payment_insert_group_settlement ON public.payments;
DROP TRIGGER IF EXISTS group_settlement_cascade ON public.group_settlements;
DROP TRIGGER IF EXISTS ledger_status_change ON public.ledger;

-- 5b. Drop tables (CASCADE removes FK constraints, indexes, and policies)
DROP TABLE IF EXISTS public.payments CASCADE;
DROP TABLE IF EXISTS public.group_settlements CASCADE;
DROP TABLE IF EXISTS public.ledger CASCADE;

-- 5c. Drop functions associated with old tables
DROP FUNCTION IF EXISTS public.update_ledger_on_payment() CASCADE;
DROP FUNCTION IF EXISTS public.update_group_settlement_on_payment() CASCADE;
DROP FUNCTION IF EXISTS public.cascade_group_settlement() CASCADE;
DROP FUNCTION IF EXISTS public.check_bill_settled() CASCADE;
DROP FUNCTION IF EXISTS public.sync_group_settlements(UUID, JSONB) CASCADE;

-- 5d. Drop enum types that are no longer used
-- debt_status was used by ledger, payments, group_settlements — all dropped
DROP TYPE IF EXISTS public.debt_status CASCADE;
-- payment_status was used by payments — dropped
DROP TYPE IF EXISTS public.payment_status CASCADE;
-- ledger_entry_type was used by ledger — dropped
DROP TYPE IF EXISTS public.ledger_entry_type CASCADE;
