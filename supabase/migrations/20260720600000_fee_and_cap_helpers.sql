-- Issue #477: the one SQL service-fee helper and the product cap accessor.
-- Both are additive, IMMUTABLE, owner-only helpers. The capped CHECK
-- constraints and validators call them; no formula is copied. The fee helper
-- mirrors src/lib/expense-money.ts::computeServiceFeeCents exactly:
-- floor((subtotal * bps + 5000) / 10000) with nonnegative integer division
-- (documented round-half-up, equals PostgreSQL positive half-away).

CREATE OR REPLACE FUNCTION public.calculate_service_fee_cents(
  p_subtotal bigint,
  p_basis_points integer
) RETURNS bigint
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT (p_subtotal * p_basis_points + 5000) / 10000;
$$;

COMMENT ON FUNCTION public.calculate_service_fee_cents(bigint, integer) IS
  'Half-up service fee in centavos from a subtotal (bigint) and basis points. Issue #477; do not copy the formula.';

-- The one product expense cap (R$999.999,99). Centralized so every cents
-- constraint/validator calls the accessor; changing the cap requires another
-- migration plus full revalidation (replacing this body alone is forbidden).
CREATE OR REPLACE FUNCTION public.expense_money_max_cents()
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT 99999999;
$$;

COMMENT ON FUNCTION public.expense_money_max_cents() IS
  'Product expense cap in centavos (R$999.999,99). Issue #477; centralize all cents bounds here.';

-- Internal helpers: no public execute grant (#477). Only owner-owned
-- SECURITY DEFINER graph writers/validators and the migration-replay/tests
-- (owner/superuser) call them.
REVOKE EXECUTE ON FUNCTION public.calculate_service_fee_cents(bigint, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.expense_money_max_cents()
  FROM PUBLIC, anon, authenticated, service_role;
