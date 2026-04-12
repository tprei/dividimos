-- Migration: get_or_create_dm_group RPC
-- Atomically finds or creates a DM group between two users.
-- Uses a unique index on sorted user pairs to prevent duplicate DMs.

-- ============================================================
-- 1. Helper table for DM uniqueness
-- ============================================================
-- Stores the canonical (user_a < user_b) pair for each DM group.
-- A unique constraint prevents duplicate DM groups between the same pair.

CREATE TABLE dm_pairs (
  group_id  uuid PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  user_a    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT dm_pairs_unique UNIQUE (user_a, user_b),
  CONSTRAINT dm_pairs_ordering CHECK (user_a < user_b)
);

-- RLS: only the two users in the pair can see their dm_pairs row
ALTER TABLE dm_pairs ENABLE ROW LEVEL SECURITY;

CREATE POLICY dm_pairs_select ON dm_pairs
  FOR SELECT USING (user_a = auth.uid() OR user_b = auth.uid());

-- No direct INSERT/UPDATE/DELETE — only the RPC manages this table
CREATE POLICY dm_pairs_no_insert ON dm_pairs
  FOR INSERT WITH CHECK (false);

CREATE POLICY dm_pairs_no_update ON dm_pairs
  FOR UPDATE USING (false);

CREATE POLICY dm_pairs_no_delete ON dm_pairs
  FOR DELETE USING (false);

-- ============================================================
-- 2. get_or_create_dm_group RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_or_create_dm_group(
  p_other_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_user_a  uuid;
  v_user_b  uuid;
  v_group_id uuid;
  v_other_exists boolean;
BEGIN
  -- Auth check
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Cannot DM yourself
  IF v_caller = p_other_user_id THEN
    RAISE EXCEPTION 'invalid_operation: cannot create a DM with yourself';
  END IF;

  -- Verify the other user exists
  SELECT EXISTS(SELECT 1 FROM public.users WHERE id = p_other_user_id)
    INTO v_other_exists;

  IF NOT v_other_exists THEN
    RAISE EXCEPTION 'user_not_found: the other user does not exist';
  END IF;

  -- Canonical ordering
  IF v_caller < p_other_user_id THEN
    v_user_a := v_caller;
    v_user_b := p_other_user_id;
  ELSE
    v_user_a := p_other_user_id;
    v_user_b := v_caller;
  END IF;

  -- Try to find existing DM group
  SELECT group_id INTO v_group_id
    FROM public.dm_pairs
    WHERE user_a = v_user_a AND user_b = v_user_b;

  IF v_group_id IS NOT NULL THEN
    RETURN v_group_id;
  END IF;

  -- Create new DM group
  INSERT INTO public.groups (name, creator_id, is_dm)
  VALUES ('', v_caller, true)
  RETURNING id INTO v_group_id;

  -- Register the canonical pair (unique constraint prevents races)
  BEGIN
    INSERT INTO public.dm_pairs (group_id, user_a, user_b)
    VALUES (v_group_id, v_user_a, v_user_b);
  EXCEPTION WHEN unique_violation THEN
    -- Another transaction won the race — clean up and return theirs
    DELETE FROM public.groups WHERE id = v_group_id;

    SELECT group_id INTO v_group_id
      FROM public.dm_pairs
      WHERE user_a = v_user_a AND user_b = v_user_b;

    RETURN v_group_id;
  END;

  -- Add both users as accepted members
  INSERT INTO public.group_members (group_id, user_id, status, invited_by, accepted_at)
  VALUES
    (v_group_id, v_caller,          'accepted', v_caller, now()),
    (v_group_id, p_other_user_id,   'accepted', v_caller, now());

  RETURN v_group_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_dm_group(uuid) TO authenticated;
