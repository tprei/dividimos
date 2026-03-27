-- Unify ledger table to serve as append-only event store for both debts and payments.
-- Previously, debts lived in `ledger` (per-bill) and `group_settlements` (per-group),
-- while payments lived in `payments`. This migration adds columns so the single `ledger`
-- table can represent both entry types, with group_id for direct group association.

-- 1. New enum for entry type
CREATE TYPE public.ledger_entry_type AS ENUM ('debt', 'payment');

-- 2. Add columns to ledger
ALTER TABLE public.ledger
  ADD COLUMN entry_type public.ledger_entry_type NOT NULL DEFAULT 'debt';

ALTER TABLE public.ledger
  ADD COLUMN group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE;

-- 3. Make bill_id nullable (payment entries may not reference a bill)
ALTER TABLE public.ledger ALTER COLUMN bill_id DROP NOT NULL;

-- 4. Indexes for new query patterns
CREATE INDEX idx_ledger_group_id ON public.ledger(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX idx_ledger_entry_type ON public.ledger(entry_type);

-- 5. Backfill group_id from bills for existing debt entries
UPDATE public.ledger
SET group_id = b.group_id
FROM public.bills b
WHERE public.ledger.bill_id = b.id
  AND b.group_id IS NOT NULL;

-- 6. RLS: group members can read payment entries for their groups
CREATE POLICY "group_members_read_group_payment_entries"
  ON public.ledger FOR SELECT
  USING (
    entry_type = 'payment'
    AND group_id IS NOT NULL
    AND group_id IN (SELECT public.my_group_ids())
  );

-- 7. RLS: debtors can insert payment entries for their groups
CREATE POLICY "debtors_insert_payment_entries"
  ON public.ledger FOR INSERT
  WITH CHECK (
    entry_type = 'payment'
    AND from_user_id = auth.uid()
    AND group_id IS NOT NULL
    AND group_id IN (SELECT public.my_group_ids())
  );

