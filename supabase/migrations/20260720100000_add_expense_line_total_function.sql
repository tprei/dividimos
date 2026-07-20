-- Issue #578: the one exact line-total function over the persisted quantity
-- (milliunits) and unit-price (cents) representation. IMMUTABLE STRICT PARALLEL
-- SAFE. Every writer, finalizer, and loader calls this; no formula is copied
-- (issue #477). Matches src/lib/expense-quantity.ts::computeExpenseLineTotalCents:
-- floor((quantity_milliunits * unit_price_cents + 500) / 1000) with half-up
-- rounding, all operands nonnegative so bigint truncation equals floor.

CREATE OR REPLACE FUNCTION public.compute_expense_line_total_cents(
  p_quantity_milliunits bigint,
  p_unit_price_cents bigint
) RETURNS bigint
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT (p_quantity_milliunits * p_unit_price_cents + 500) / 1000;
$$;

COMMENT ON FUNCTION public.compute_expense_line_total_cents(bigint, bigint) IS
  'Half-up expense line total in centavos from quantity (milliunits) and unit price (cents). Issue #578; do not copy the formula.';

-- Internal helper: no public execute grant (#477). Only owner-owned
-- SECURITY DEFINER graph writers/loaders call it; the migration-replay and
-- integration tests run as the owner/superuser and bypass this.
REVOKE EXECUTE ON FUNCTION public.compute_expense_line_total_cents(bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
