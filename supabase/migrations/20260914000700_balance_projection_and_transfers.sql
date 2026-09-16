CREATE FUNCTION public.pairwise_from_nets(
  p_kinds participant_kind[],
  p_ids uuid[],
  p_nets bigint[]
)
RETURNS TABLE (from_kind participant_kind, from_id uuid, to_id uuid, amount_cents bigint)
  LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  v_count integer := COALESCE(array_length(p_ids, 1), 0);
  v_debtor_kinds participant_kind[];
  v_debtor_ids uuid[];
  v_debtor_open bigint[];
  v_creditor_ids uuid[];
  v_creditor_open bigint[];
  v_di integer := 1;
  v_ci integer := 1;
  v_amount bigint;
BEGIN
  SELECT COALESCE(array_agg(n.kind ORDER BY n.net ASC, n.pid ASC), '{}'),
         COALESCE(array_agg(n.pid ORDER BY n.net ASC, n.pid ASC), '{}'),
         COALESCE(array_agg(-n.net ORDER BY n.net ASC, n.pid ASC), '{}')
    INTO v_debtor_kinds, v_debtor_ids, v_debtor_open
    FROM (
      SELECT p_kinds[g] AS kind, p_ids[g] AS pid, p_nets[g] AS net
      FROM generate_series(1, v_count) AS g
    ) n
   WHERE n.net < 0;
  SELECT COALESCE(array_agg(n.pid ORDER BY n.net DESC, n.pid ASC), '{}'),
         COALESCE(array_agg(n.net ORDER BY n.net DESC, n.pid ASC), '{}')
    INTO v_creditor_ids, v_creditor_open
    FROM (
      SELECT p_ids[g] AS pid, p_nets[g] AS net
      FROM generate_series(1, v_count) AS g
    ) n
   WHERE n.net > 0;

  WHILE v_di <= COALESCE(array_length(v_debtor_ids, 1), 0)
    AND v_ci <= COALESCE(array_length(v_creditor_ids, 1), 0) LOOP
    v_amount := LEAST(v_debtor_open[v_di], v_creditor_open[v_ci]);
    EXIT WHEN v_amount <= 0;
    from_kind := v_debtor_kinds[v_di];
    from_id := v_debtor_ids[v_di];
    to_id := v_creditor_ids[v_ci];
    amount_cents := v_amount;
    RETURN NEXT;
    v_debtor_open[v_di] := v_debtor_open[v_di] - v_amount;
    v_creditor_open[v_ci] := v_creditor_open[v_ci] - v_amount;
    IF v_debtor_open[v_di] <= 0 THEN v_di := v_di + 1; END IF;
    IF v_creditor_open[v_ci] <= 0 THEN v_ci := v_ci + 1; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION public.group_transfers(p_group_id uuid)
RETURNS TABLE (from_kind participant_kind, from_id uuid, to_id uuid, amount_cents bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT f.from_kind, f.from_id, f.to_id, f.amount_cents
    FROM public.pairwise_from_nets(
           COALESCE((SELECT array_agg(gb.kind ORDER BY gb.kind, gb.participant_id)
                       FROM public.group_balances gb
                      WHERE gb.group_id = p_group_id), '{}'::participant_kind[]),
           COALESCE((SELECT array_agg(gb.participant_id ORDER BY gb.kind, gb.participant_id)
                       FROM public.group_balances gb
                      WHERE gb.group_id = p_group_id), '{}'),
           COALESCE((SELECT array_agg(gb.net_cents ORDER BY gb.kind, gb.participant_id)
                       FROM public.group_balances gb
                      WHERE gb.group_id = p_group_id), '{}')
         ) f;
END;
$$;

CREATE FUNCTION public.group_pairwise_edges(p_group_id uuid)
RETURNS TABLE (from_kind participant_kind, from_id uuid, to_id uuid, amount_cents bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH nets AS (
    SELECT e.id AS expense_id,
           cep.kind,
           COALESCE(cep.user_id, cep.guest_id) AS participant_id,
           (cep.paid_cents - cep.share_cents)::bigint AS net
      FROM public.expenses e
      JOIN public.current_expense_participants cep ON cep.expense_id = e.id
     WHERE e.group_id = p_group_id AND e.status = 'active'
  ),
  expense_edges AS (
    SELECT one.expense_id, f.from_kind, f.from_id, f.to_id, f.amount_cents
      FROM (SELECT DISTINCT n.expense_id FROM nets n) one
      CROSS JOIN LATERAL public.pairwise_from_nets(
             COALESCE((SELECT array_agg(n.kind ORDER BY n.kind, n.participant_id)
                         FROM nets n WHERE n.expense_id = one.expense_id), '{}'::participant_kind[]),
             COALESCE((SELECT array_agg(n.participant_id ORDER BY n.kind, n.participant_id)
                         FROM nets n WHERE n.expense_id = one.expense_id), '{}'),
             COALESCE((SELECT array_agg(n.net ORDER BY n.kind, n.participant_id)
                         FROM nets n WHERE n.expense_id = one.expense_id), '{}')
           ) f
  ),
  edge_with_kinds AS (
    SELECT ee.from_id, ee.to_id, ee.from_kind, kt.kind AS to_kind, ee.amount_cents
      FROM expense_edges ee
      JOIN nets kt ON kt.expense_id = ee.expense_id AND kt.participant_id = ee.to_id
  ),
  normalized AS (
    SELECT CASE WHEN k.from_id < k.to_id THEN k.from_id ELSE k.to_id END AS left_id,
           CASE WHEN k.from_id < k.to_id THEN k.to_id ELSE k.from_id END AS right_id,
           CASE WHEN k.from_id < k.to_id THEN k.from_kind ELSE k.to_kind END AS left_kind,
           CASE WHEN k.from_id < k.to_id THEN k.to_kind ELSE k.from_kind END AS right_kind,
           CASE WHEN k.from_id < k.to_id THEN k.amount_cents ELSE -k.amount_cents END AS amount
      FROM edge_with_kinds k
  ),
  settlement_deltas AS (
    SELECT CASE WHEN s.from_user_id < s.to_user_id THEN s.from_user_id ELSE s.to_user_id END AS left_id,
           CASE WHEN s.from_user_id < s.to_user_id THEN s.to_user_id ELSE s.from_user_id END AS right_id,
           'user'::participant_kind AS left_kind,
           'user'::participant_kind AS right_kind,
           CASE WHEN s.from_user_id < s.to_user_id THEN -s.amount_cents ELSE s.amount_cents END AS amount
      FROM public.settlements s
     WHERE s.group_id = p_group_id AND s.status = 'confirmed'
  ),
  combined AS (
    SELECT d.left_id,
           d.right_id,
           MAX(d.left_kind) AS left_kind,
           MAX(d.right_kind) AS right_kind,
           SUM(d.amount) AS net
      FROM (
        SELECT left_id, right_id, left_kind, right_kind, amount FROM normalized
        UNION ALL
        SELECT left_id, right_id, left_kind, right_kind, amount FROM settlement_deltas
      ) d
     GROUP BY d.left_id, d.right_id
  )
  SELECT (CASE WHEN c.net > 0 THEN c.left_kind ELSE c.right_kind END)::participant_kind,
         (CASE WHEN c.net > 0 THEN c.left_id ELSE c.right_id END)::uuid,
         (CASE WHEN c.net > 0 THEN c.right_id ELSE c.left_id END)::uuid,
         (CASE WHEN c.net > 0 THEN c.net ELSE -c.net END)::bigint
    FROM combined c
   WHERE c.net <> 0
   ORDER BY 1, 2, 3;
END;
$$;
