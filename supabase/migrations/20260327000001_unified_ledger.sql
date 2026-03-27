-- Unify ledger table to serve as append-only event store for both debts and payments.
-- Previously, debts lived in `ledger` (per-bill) and `group_settlements` (per-group),
-- while payments lived in `payments`. This migration adds columns so the single `ledger`
-- table can represent both entry types, with group_id for direct group association.
--
-- NOTE: idempotent guards added because a prior timestamp collision caused partial
-- application of these statements on some databases.

-- 1. New enum for entry type
DO $$ BEGIN
  CREATE TYPE public.ledger_entry_type AS ENUM ('debt', 'payment');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add columns to ledger
ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS entry_type public.ledger_entry_type NOT NULL DEFAULT 'debt';

ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE;

-- 3. Make bill_id nullable (payment entries may not reference a bill)
ALTER TABLE public.ledger ALTER COLUMN bill_id DROP NOT NULL;

-- 4. Indexes for new query patterns
CREATE INDEX IF NOT EXISTS idx_ledger_group_id ON public.ledger(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_entry_type ON public.ledger(entry_type);

-- 5. Backfill group_id from bills for existing debt entries
UPDATE public.ledger
SET group_id = b.group_id
FROM public.bills b
WHERE public.ledger.bill_id = b.id
  AND b.group_id IS NOT NULL
  AND public.ledger.group_id IS NULL;

-- 6. RLS: group members can read payment entries for their groups
DROP POLICY IF EXISTS "group_members_read_group_payment_entries" ON public.ledger;
CREATE POLICY "group_members_read_group_payment_entries"
  ON public.ledger FOR SELECT
  USING (
    entry_type = 'payment'
    AND group_id IS NOT NULL
    AND group_id IN (SELECT public.my_group_ids())
  );

-- 7. RLS: debtors can insert payment entries for their groups
DROP POLICY IF EXISTS "debtors_insert_payment_entries" ON public.ledger;
CREATE POLICY "debtors_insert_payment_entries"
  ON public.ledger FOR INSERT
  WITH CHECK (
    entry_type = 'payment'
    AND from_user_id = auth.uid()
    AND group_id IS NOT NULL
    AND group_id IN (SELECT public.my_group_ids())
  );

-- 8. Drop stale confirmation policy if it was created by the earlier partial run
DROP POLICY IF EXISTS "creditors_confirm_payment_entries" ON public.ledger;

-- 9. Drop confirmed_by column if it was created by the earlier partial run
ALTER TABLE public.ledger DROP COLUMN IF EXISTS confirmed_by;
