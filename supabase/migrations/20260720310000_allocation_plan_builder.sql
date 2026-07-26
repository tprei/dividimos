-- Issue #468: the one deterministic integer allocation builder. Reads the
-- locked participant map for one expense and returns debtor->creditor edges
-- using two-cursor matching in ascending participant_index order: each step
-- emits min(debtor_remaining, creditor_remaining) and advances every exhausted
-- cursor. No division, float, per-cell rounding, residual pair, or per-cent
-- loop. Output incidence (outgoing - incoming) equals each entity's stored net
-- (share - payer). At most debtor_count + creditor_count - 1 positive edges.
--
-- Internal helper: non-granted. Only activate_saved_expense, claim_guest_spot,
-- and the historical backfill call it. The caller validates contiguous indexes,
-- exact incidence, and the sparse-edge bound before any balance write.

CREATE OR REPLACE FUNCTION public.build_expense_allocation_plan_edges(
  p_expense_id uuid
) RETURNS TABLE(
  allocation_index integer,
  debtor_index integer,
  creditor_index integer,
  amount_cents integer
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_d_idx integer[];
  v_d_rem integer[];
  v_dc integer;
  v_c_idx integer[];
  v_c_rem integer[];
  v_cc integer;
  v_di integer := 1;
  v_ci integer := 1;
  v_amt integer;
  v_n integer := 0;
  v_e_debtor integer[] := ARRAY[]::integer[];
  v_e_creditor integer[] := ARRAY[]::integer[];
  v_e_amount integer[] := ARRAY[]::integer[];
BEGIN
  SELECT array_agg(participant_index ORDER BY participant_index),
         array_agg(net_amount_cents ORDER BY participant_index)
    INTO v_d_idx, v_d_rem
    FROM public.expense_allocation_entities
    WHERE expense_id = p_expense_id AND net_amount_cents > 0;
  v_dc := COALESCE(array_length(v_d_idx, 1), 0);

  SELECT array_agg(participant_index ORDER BY participant_index),
         array_agg((-net_amount_cents) ORDER BY participant_index)
    INTO v_c_idx, v_c_rem
    FROM public.expense_allocation_entities
    WHERE expense_id = p_expense_id AND net_amount_cents < 0;
  v_cc := COALESCE(array_length(v_c_idx, 1), 0);

  -- Zero plan when there is nothing to settle on either side.
  IF v_dc = 0 OR v_cc = 0 THEN
    RETURN;
  END IF;

  WHILE v_di <= v_dc AND v_ci <= v_cc LOOP
    v_amt := LEAST(v_d_rem[v_di], v_c_rem[v_ci]);
    IF v_amt > 0 THEN
      v_n := v_n + 1;
      v_e_debtor   := v_e_debtor   || v_d_idx[v_di];
      v_e_creditor := v_e_creditor || v_c_idx[v_ci];
      v_e_amount   := v_e_amount   || v_amt;
      v_d_rem[v_di] := v_d_rem[v_di] - v_amt;
      v_c_rem[v_ci] := v_c_rem[v_ci] - v_amt;
    END IF;
    IF v_d_rem[v_di] <= 0 THEN v_di := v_di + 1; END IF;
    IF v_c_rem[v_ci] <= 0 THEN v_ci := v_ci + 1; END IF;
  END LOOP;

  RETURN QUERY
    SELECT row_number() OVER ()::integer AS allocation_index,
           t.debtor_index,
           t.creditor_index,
           t.amount_cents
      FROM UNNEST(v_e_debtor, v_e_creditor, v_e_amount) AS t(debtor_index, creditor_index, amount_cents);
END;
$$;

COMMENT ON FUNCTION public.build_expense_allocation_plan_edges(uuid) IS
  'Deterministic two-cursor allocation edges for one expense (#468). Caller validates incidence and the sparse-edge bound.';

REVOKE EXECUTE ON FUNCTION public.build_expense_allocation_plan_edges(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
