-- Drop old group_settlements infrastructure.
-- All settlement logic now uses the unified ledger table with entry_type='payment'.

-- 1. Drop trigger that updated group_settlements on payment insert
DROP TRIGGER IF EXISTS after_payment_insert_group_settlement ON public.payments;
DROP FUNCTION IF EXISTS public.update_group_settlement_on_payment();

-- 2. Remove group_settlement_id column and related objects from payments
--    (also drops idx_payments_group_settlement_id and payments_one_target constraint)
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_one_target;
DROP INDEX IF EXISTS idx_payments_group_settlement_id;
ALTER TABLE public.payments DROP COLUMN IF EXISTS group_settlement_id;

-- 3. Drop cascade trigger on group_settlements
DROP TRIGGER IF EXISTS group_settlement_cascade ON public.group_settlements;
DROP FUNCTION IF EXISTS public.cascade_group_settlement();

-- 4. Drop the group_settlements table (cascades RLS policies, indexes)
DROP TABLE IF EXISTS public.group_settlements CASCADE;
