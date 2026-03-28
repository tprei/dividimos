-- Replace the two-step settlement flow (record pending → confirm) with a
-- single atomic operation. Either party (debtor or creditor) can record
-- a settlement, which immediately updates balances.

CREATE OR REPLACE FUNCTION record_and_settle(
  p_group_id     uuid,
  p_from_user_id uuid,
  p_to_user_id   uuid,
  p_amount_cents integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_user_a  uuid;
  v_user_b  uuid;
  v_delta   integer;
  v_id      uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF v_caller != p_from_user_id AND v_caller != p_to_user_id THEN
    RAISE EXCEPTION 'permission_denied: caller must be debtor or creditor';
  END IF;

  IF p_group_id NOT IN (SELECT my_group_ids()) THEN
    RAISE EXCEPTION 'permission_denied: not a group member';
  END IF;

  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: must be positive';
  END IF;

  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION 'invalid_users: cannot settle with yourself';
  END IF;

  INSERT INTO settlements (group_id, from_user_id, to_user_id, amount_cents, status, confirmed_at)
  VALUES (p_group_id, p_from_user_id, p_to_user_id, p_amount_cents, 'confirmed', now())
  RETURNING id INTO v_id;

  IF p_from_user_id < p_to_user_id THEN
    v_user_a := p_from_user_id;
    v_user_b := p_to_user_id;
    v_delta  := -p_amount_cents;
  ELSE
    v_user_a := p_to_user_id;
    v_user_b := p_from_user_id;
    v_delta  := p_amount_cents;
  END IF;

  INSERT INTO balances (group_id, user_a, user_b, amount_cents)
  VALUES (p_group_id, v_user_a, v_user_b, v_delta)
  ON CONFLICT (group_id, user_a, user_b)
  DO UPDATE SET
    amount_cents = balances.amount_cents + EXCLUDED.amount_cents,
    updated_at   = now();

  RETURN v_id;
END;
$$;
