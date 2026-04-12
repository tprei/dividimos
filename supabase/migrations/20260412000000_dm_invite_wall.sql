-- Migration: dm_invite_wall
-- Updates get_or_create_dm_group to enforce the invite wall for strangers.
-- If the caller and counterparty already share an accepted group membership,
-- both are added as accepted. Otherwise the counterparty receives an invite.

CREATE OR REPLACE FUNCTION public.get_or_create_dm_group(
  p_other_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller             uuid := auth.uid();
  v_user_a             uuid;
  v_user_b             uuid;
  v_group_id           uuid;
  v_other_exists       boolean;
  v_already_connected  boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF v_caller = p_other_user_id THEN
    RAISE EXCEPTION 'invalid_operation: cannot create a DM with yourself';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.users WHERE id = p_other_user_id)
    INTO v_other_exists;

  IF NOT v_other_exists THEN
    RAISE EXCEPTION 'user_not_found: the other user does not exist';
  END IF;

  IF v_caller < p_other_user_id THEN
    v_user_a := v_caller;
    v_user_b := p_other_user_id;
  ELSE
    v_user_a := p_other_user_id;
    v_user_b := v_caller;
  END IF;

  SELECT group_id INTO v_group_id
    FROM public.dm_pairs
    WHERE user_a = v_user_a AND user_b = v_user_b;

  IF v_group_id IS NOT NULL THEN
    RETURN v_group_id;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.group_members gm1
    JOIN public.group_members gm2 ON gm1.group_id = gm2.group_id
    WHERE gm1.user_id = v_caller
      AND gm2.user_id = p_other_user_id
      AND gm1.status = 'accepted'
      AND gm2.status = 'accepted'
  ) INTO v_already_connected;

  INSERT INTO public.groups (name, creator_id, is_dm)
  VALUES ('', v_caller, true)
  RETURNING id INTO v_group_id;

  BEGIN
    INSERT INTO public.dm_pairs (group_id, user_a, user_b)
    VALUES (v_group_id, v_user_a, v_user_b);
  EXCEPTION WHEN unique_violation THEN
    DELETE FROM public.groups WHERE id = v_group_id;

    SELECT group_id INTO v_group_id
      FROM public.dm_pairs
      WHERE user_a = v_user_a AND user_b = v_user_b;

    RETURN v_group_id;
  END;

  IF v_already_connected THEN
    INSERT INTO public.group_members (group_id, user_id, status, invited_by, accepted_at)
    VALUES
      (v_group_id, v_caller,        'accepted', v_caller, now()),
      (v_group_id, p_other_user_id, 'accepted', v_caller, now());
  ELSE
    INSERT INTO public.group_members (group_id, user_id, status, invited_by, accepted_at)
    VALUES
      (v_group_id, v_caller,        'accepted', v_caller, now());

    INSERT INTO public.group_members (group_id, user_id, status, invited_by)
    VALUES
      (v_group_id, p_other_user_id, 'invited', v_caller);
  END IF;

  RETURN v_group_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_dm_group(uuid) TO authenticated;
