-- Fix two bugs in sync_group_settlements:
--
-- Bug 1: The broad UNIQUE(group_id, from_user_id, to_user_id) constraint prevented
-- inserting a new pending settlement when a partially_paid row already exists for
-- the same pair. Replace it with a partial unique index covering only pending rows,
-- which allows one pending + one-or-more non-pending rows per pair.
--
-- Bug 2: SELECT ... FOR UPDATE acquires no lock when the group has no existing
-- settlements (empty result set = no rows to lock), so two concurrent callers raced
-- past the lock step and both tried to insert the same row. Replace with an
-- advisory lock keyed on the group_id, which serialises callers regardless of
-- whether rows exist.

ALTER TABLE public.group_settlements
  DROP CONSTRAINT group_settlements_group_id_from_user_id_to_user_id_key;

CREATE UNIQUE INDEX group_settlements_pending_unique
  ON public.group_settlements (group_id, from_user_id, to_user_id)
  WHERE (status = 'pending');

CREATE OR REPLACE FUNCTION public.sync_group_settlements(
  p_group_id UUID,
  p_edges JSONB DEFAULT '[]'::JSONB
)
RETURNS SETOF public.group_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  edge JSONB;
  v_from UUID;
  v_to UUID;
  v_amount INTEGER;
  v_settled INTEGER;
  v_remaining INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of this group'
      USING ERRCODE = '42501';
  END IF;

  -- Serialise concurrent callers for the same group. Advisory locks work even
  -- when there are no existing rows to SELECT ... FOR UPDATE.
  PERFORM pg_advisory_xact_lock(1, hashtext(p_group_id::text));

  DELETE FROM public.group_settlements
  WHERE group_id = p_group_id
    AND status = 'pending';

  FOR edge IN SELECT * FROM jsonb_array_elements(p_edges)
  LOOP
    v_from := (edge ->> 'from_user_id')::UUID;
    v_to := (edge ->> 'to_user_id')::UUID;
    v_amount := (edge ->> 'amount_cents')::INTEGER;

    SELECT COALESCE(SUM(amount_cents), 0) INTO v_settled
    FROM public.group_settlements
    WHERE group_id = p_group_id
      AND from_user_id = v_from
      AND to_user_id = v_to
      AND status != 'pending';

    v_remaining := v_amount - v_settled;

    IF v_remaining > 1 THEN
      INSERT INTO public.group_settlements (group_id, from_user_id, to_user_id, amount_cents)
      VALUES (p_group_id, v_from, v_to, v_remaining);
    END IF;
  END LOOP;

  RETURN QUERY
    SELECT * FROM public.group_settlements
    WHERE group_id = p_group_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_group_settlements(UUID, JSONB) TO authenticated;
