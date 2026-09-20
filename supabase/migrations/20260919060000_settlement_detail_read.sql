-- Authorized read of one settlement's full detail.
-- Any accepted member of the settlement's group may open any payment in it,
-- regardless of payer or recipient. Voided payments stay readable because
-- void is terminal, and the read reaches the whole history rather than the
-- snapshot's bounded recent-confirmed list. The settlement serializer stays
-- private; only this wrapper is callable, and only by authenticated roles.

CREATE FUNCTION public.get_settlement(p_settlement_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_group_id uuid;
BEGIN
  v_user_id := public.current_user_id();

  SELECT s.group_id INTO v_group_id
  FROM public.settlements s
  WHERE s.id = p_settlement_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'settlement_not_found';
  END IF;

  PERFORM public.assert_member(v_group_id, v_user_id);

  RETURN jsonb_build_object(
    'settlement', public.ledger_settlement_json(p_settlement_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_settlement(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_settlement(uuid) TO authenticated;
