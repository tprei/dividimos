-- Issue #477: enforce the product cap and positivity at the DB boundary. Every
-- cents CHECK calls expense_money_max_cents() so the cap has one source of
-- truth (changing it requires another migration + revalidation, never editing
-- this body alone). Constraints are added NOT VALID so existing rows are not
-- re-validated mid-stack; only new writes are enforced. A later #477 migration
-- VALIDATEs them after preflight proves every row is in range.

-- PostgreSQL evaluates a CHECK expression as the row-writing role. Keep this
-- harmless accessor available while direct graph DML remains exposed; the
-- #477 writer-only cutover must revoke these temporary application-role grants.
GRANT EXECUTE ON FUNCTION public.expense_money_max_cents()
  TO authenticated, service_role;

-- expenses.total_amount and fixed_fees: nonnegative, <= cap. (Existing
-- `>= 0` checks remain; these add the upper bound.)
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_total_amount_cap_check
    CHECK (total_amount BETWEEN 0 AND public.expense_money_max_cents()) NOT VALID;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_fixed_fees_cap_check
    CHECK (fixed_fees BETWEEN 0 AND public.expense_money_max_cents()) NOT VALID;

-- expense_items: unit price and line total are positive and within cap.
ALTER TABLE public.expense_items
  ADD CONSTRAINT expense_items_unit_price_cents_cap_check
    CHECK (unit_price_cents BETWEEN 1 AND public.expense_money_max_cents()) NOT VALID;
ALTER TABLE public.expense_items
  ADD CONSTRAINT expense_items_total_price_cents_cap_check
    CHECK (total_price_cents BETWEEN 1 AND public.expense_money_max_cents()) NOT VALID;

-- expense_shares.share_amount_cents: nonnegative, <= cap (zero rows are valid).
ALTER TABLE public.expense_shares
  ADD CONSTRAINT expense_shares_share_amount_cents_cap_check
    CHECK (share_amount_cents BETWEEN 0 AND public.expense_money_max_cents()) NOT VALID;

-- expense_payers.amount_cents: strictly positive, <= cap.
ALTER TABLE public.expense_payers
  ADD CONSTRAINT expense_payers_amount_cents_cap_check
    CHECK (amount_cents BETWEEN 1 AND public.expense_money_max_cents()) NOT VALID;

-- expense_guest_shares.share_amount_cents: nonnegative, <= cap.
ALTER TABLE public.expense_guest_shares
  ADD CONSTRAINT expense_guest_shares_share_amount_cents_cap_check
    CHECK (share_amount_cents BETWEEN 0 AND public.expense_money_max_cents()) NOT VALID;
