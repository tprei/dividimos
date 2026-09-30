-- Person profile read: how much the caller split with one other account.
-- Active expenses in any group (incl. DMs) where the caller is an accepted
-- member and both accounts are user participants of the current version.
-- An unknown target yields zeros: the profile screen renders an empty state
-- from the store, so the read never becomes a user-id oracle.

CREATE FUNCTION public.get_shared_spending(p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid;
  v_expense_count integer;
  v_total_cents bigint;
  v_my_share_cents bigint;
  v_their_share_cents bigint;
BEGIN
  v_caller := public.current_user_id();

  IF p_user_id IS NULL OR p_user_id = v_caller THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT
    count(*)::integer,
    COALESCE(sum(v.total_cents), 0)::bigint,
    COALESCE(sum(mine.share_cents), 0)::bigint,
    COALESCE(sum(theirs.share_cents), 0)::bigint
  INTO v_expense_count, v_total_cents, v_my_share_cents, v_their_share_cents
  FROM public.expenses e
  JOIN public.expense_versions v
    ON v.expense_id = e.id AND v.version_no = e.current_version_no
  JOIN public.group_members gm
    ON gm.group_id = e.group_id AND gm.user_id = v_caller AND gm.status = 'accepted'
  JOIN public.current_expense_participants mine
    ON mine.expense_id = e.id AND mine.kind = 'user' AND mine.user_id = v_caller
  JOIN public.current_expense_participants theirs
    ON theirs.expense_id = e.id AND theirs.kind = 'user' AND theirs.user_id = p_user_id
  WHERE e.status = 'active';

  RETURN jsonb_build_object(
    'expenseCount', v_expense_count,
    'totalCents', v_total_cents,
    'myShareCents', v_my_share_cents,
    'theirShareCents', v_their_share_cents
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_shared_spending(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_shared_spending(uuid) TO authenticated;
