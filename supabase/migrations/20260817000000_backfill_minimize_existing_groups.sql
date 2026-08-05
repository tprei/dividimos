-- One-time backfill: normalize every existing group's balance ledger.
--
-- minimize_group_balances runs going forward inside the four balance-writing
-- RPCs (record_settlements, activate_expense, claim_guest_spot, confirm_settlement).
-- Groups that already hold a cross-chain cycle from before the normalization
-- stack (#676–#678) would stay broken until their next balance-writing call.
-- This migration closes that gap by normalizing every group once, atomically.

DO $$
DECLARE
  g record;
BEGIN
  FOR g IN
    SELECT DISTINCT group_id
      FROM public.balances
     WHERE amount_cents <> 0
  LOOP
    -- Lock the group row (minimize_group_balances requires the caller to hold
    -- it FOR UPDATE). The migration runs in a single transaction so no
    -- concurrent RPC can interleave.
    PERFORM 1 FROM public.groups WHERE id = g.group_id FOR UPDATE;
    PERFORM public.minimize_group_balances(g.group_id);
  END LOOP;
END;
$$;
