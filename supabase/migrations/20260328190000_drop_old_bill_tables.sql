-- Drop the old bill/ledger/payment/group_settlement system.
-- All functionality has been replaced by the new expense/balances/settlements tables.
--
-- Order: dependents first, then base tables, then enums and functions.

-- ============================================================
-- 1. Remove old tables from realtime publication
-- ============================================================
-- These may fail silently if already removed; use IF EXISTS pattern.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE payments;
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE group_settlements;
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE ledger;
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE bill_participants;
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE bills;
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

-- ============================================================
-- 2. Drop triggers (before dropping functions)
-- ============================================================

DROP TRIGGER IF EXISTS after_payment_insert ON payments;
DROP TRIGGER IF EXISTS after_payment_insert_group_settlement ON payments;
DROP TRIGGER IF EXISTS group_settlement_cascade ON group_settlements;
DROP TRIGGER IF EXISTS bills_updated_at ON bills;

-- ============================================================
-- 3. Drop tables (dependents first)
-- ============================================================
-- CASCADE drops all policies, indexes, and constraints automatically.

DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS item_splits CASCADE;
DROP TABLE IF EXISTS bill_splits CASCADE;
DROP TABLE IF EXISTS bill_payers CASCADE;
DROP TABLE IF EXISTS bill_participants CASCADE;
DROP TABLE IF EXISTS bill_items CASCADE;
DROP TABLE IF EXISTS ledger CASCADE;
DROP TABLE IF EXISTS group_settlements CASCADE;
DROP TABLE IF EXISTS bills CASCADE;

-- ============================================================
-- 4. Drop functions related to old system
-- ============================================================

DROP FUNCTION IF EXISTS update_ledger_on_payment() CASCADE;
DROP FUNCTION IF EXISTS update_group_settlement_on_payment() CASCADE;
DROP FUNCTION IF EXISTS cascade_group_settlement() CASCADE;
DROP FUNCTION IF EXISTS update_updated_at() CASCADE;
DROP FUNCTION IF EXISTS my_bill_ids() CASCADE;
DROP FUNCTION IF EXISTS sync_group_settlements(uuid) CASCADE;

-- ============================================================
-- 5. Drop old enums
-- ============================================================

DROP TYPE IF EXISTS payment_status;
DROP TYPE IF EXISTS bill_participant_status;
DROP TYPE IF EXISTS split_type;
DROP TYPE IF EXISTS bill_status;
DROP TYPE IF EXISTS debt_status;
DROP TYPE IF EXISTS ledger_entry_type;

-- ============================================================
-- 6. Update user_profiles visibility policy
-- ============================================================
-- The old policy referenced bill_participants and bills via
-- my_bill_ids(). Since all expenses now belong to groups,
-- group membership is sufficient for user visibility.

DROP POLICY IF EXISTS "users_read_visible" ON public.users;

CREATE POLICY "users_read_visible" ON public.users FOR SELECT
USING (
  id = auth.uid()
  OR id IN (
    SELECT user_id FROM public.group_members
    WHERE group_id IN (SELECT public.my_group_ids())
  )
  OR id IN (
    SELECT creator_id FROM public.groups
    WHERE id IN (SELECT public.my_group_ids())
  )
);
