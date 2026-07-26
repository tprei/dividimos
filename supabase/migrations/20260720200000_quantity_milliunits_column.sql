-- Issue #578: repurpose expense_items.quantity from an integer item count into
-- the one exact persisted quantity model — integer milliunits (thousandths),
-- three fractional digits of precision. The column name is unchanged so the
-- existing save RPC and generated types keep compiling; only the semantics and
-- the bound change. Existing counts are migrated to milliunits (N items ->
-- N*1000). The app layer keeps the human display value (e.g. 0,5); the
-- mapper and save-payload builder convert at the boundary, and every line total
-- is derived exactly through compute_expense_line_total_cents /
-- computeExpenseLineTotalCents.

UPDATE public.expense_items SET quantity = quantity * 1000;

ALTER TABLE public.expense_items
  ALTER COLUMN quantity SET DEFAULT 1000;

ALTER TABLE public.expense_items
  DROP CONSTRAINT expense_items_quantity_check;

ALTER TABLE public.expense_items
  ADD CONSTRAINT expense_items_quantity_check
  CHECK (quantity > 0 AND quantity <= 999999999);
