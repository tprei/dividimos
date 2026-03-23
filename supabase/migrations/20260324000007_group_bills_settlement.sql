-- Phase 1: Link bills to groups and add group settlement tracking

-- 1a. Add group_id to bills
ALTER TABLE public.bills ADD COLUMN group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL;
CREATE INDEX idx_bills_group ON public.bills(group_id);

-- 1b. group_settlements table
CREATE TABLE public.group_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status public.debt_status NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, from_user_id, to_user_id)
);

CREATE INDEX idx_group_settlements_group ON public.group_settlements(group_id);
CREATE INDEX idx_group_settlements_from ON public.group_settlements(from_user_id);
CREATE INDEX idx_group_settlements_to ON public.group_settlements(to_user_id);

ALTER TABLE public.group_settlements ENABLE ROW LEVEL SECURITY;

-- Group members can read their settlements
CREATE POLICY "group_settlements_select"
  ON public.group_settlements FOR SELECT
  USING (group_id IN (SELECT public.my_group_ids()));

-- Group members can insert (needed for upsertGroupSettlements recalculation)
CREATE POLICY "group_settlements_insert"
  ON public.group_settlements FOR INSERT
  WITH CHECK (group_id IN (SELECT public.my_group_ids()));

-- Group members can delete pending rows (needed for recalculation)
CREATE POLICY "group_settlements_delete"
  ON public.group_settlements FOR DELETE
  USING (group_id IN (SELECT public.my_group_ids()) AND status = 'pending');

-- Debtors can mark as paid_unconfirmed
CREATE POLICY "group_settlements_mark_paid"
  ON public.group_settlements FOR UPDATE
  USING (from_user_id = auth.uid() AND status = 'pending')
  WITH CHECK (status = 'paid_unconfirmed');

-- Creditors can confirm (settle)
CREATE POLICY "group_settlements_confirm"
  ON public.group_settlements FOR UPDATE
  USING (to_user_id = auth.uid() AND status = 'paid_unconfirmed')
  WITH CHECK (status = 'settled');

-- 1c. Additional RLS on bills: group members can read group bills
CREATE POLICY "group_members_read_group_bills"
  ON public.bills FOR SELECT
  USING (group_id IS NOT NULL AND group_id IN (SELECT public.my_group_ids()));

-- Additional RLS on ledger: group members can read all ledger entries for group bills
-- (needed to compute consolidated net edges)
CREATE POLICY "group_members_read_group_ledger"
  ON public.ledger FOR SELECT
  USING (
    bill_id IN (
      SELECT id FROM public.bills
      WHERE group_id IS NOT NULL AND group_id IN (SELECT public.my_group_ids())
    )
  );

-- 1d. Cascade trigger: when group_settlement is confirmed, settle all underlying ledger entries
CREATE OR REPLACE FUNCTION public.cascade_group_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'settled' AND (OLD.status IS DISTINCT FROM 'settled') THEN
    -- Settle forward-direction entries (from_user owes to_user)
    UPDATE public.ledger
    SET status = 'settled',
        confirmed_at = now()
    WHERE bill_id IN (
      SELECT id FROM public.bills WHERE group_id = NEW.group_id
    )
    AND from_user_id = NEW.from_user_id
    AND to_user_id = NEW.to_user_id
    AND status != 'settled';

    -- Settle reverse-direction entries (to_user owes from_user — netted out)
    UPDATE public.ledger
    SET status = 'settled',
        confirmed_at = now()
    WHERE bill_id IN (
      SELECT id FROM public.bills WHERE group_id = NEW.group_id
    )
    AND from_user_id = NEW.to_user_id
    AND to_user_id = NEW.from_user_id
    AND status != 'settled';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER group_settlement_cascade
  AFTER UPDATE OF status ON public.group_settlements
  FOR EACH ROW EXECUTE FUNCTION public.cascade_group_settlement();

-- Enable realtime for group_settlements
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_settlements;
