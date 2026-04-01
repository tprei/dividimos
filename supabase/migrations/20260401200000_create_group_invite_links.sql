-- Generic invite links for groups.
--
-- Instead of inviting each person by @handle, a group creator (or accepted
-- member) can generate a shareable link. Anyone with the link can join the
-- group instantly, subject to optional expiry and use-count limits.
--
-- New table:  group_invite_links
-- New RPC:    join_group_via_link(p_token uuid)

-- ============================================================
-- GROUP_INVITE_LINKS
-- ============================================================

CREATE TABLE group_invite_links (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  token       uuid        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  created_by  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz,
  max_uses    integer,
  use_count   integer     NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_group_invite_links_group_id ON group_invite_links(group_id);
CREATE INDEX idx_group_invite_links_token    ON group_invite_links(token);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE group_invite_links ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user can read a link (needed for the join page
-- to validate the token before the user is a group member).
CREATE POLICY group_invite_links_select ON group_invite_links
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: group creator or accepted members can create links
CREATE POLICY group_invite_links_insert ON group_invite_links
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND (
      group_id IN (SELECT id FROM groups WHERE creator_id = auth.uid())
      OR group_id IN (SELECT my_accepted_group_ids())
    )
  );

-- UPDATE: only the link creator or the group creator can modify (deactivate)
CREATE POLICY group_invite_links_update ON group_invite_links
  FOR UPDATE USING (
    created_by = auth.uid()
    OR group_id IN (SELECT id FROM groups WHERE creator_id = auth.uid())
  );

-- DELETE: only the link creator or the group creator can delete
CREATE POLICY group_invite_links_delete ON group_invite_links
  FOR DELETE USING (
    created_by = auth.uid()
    OR group_id IN (SELECT id FROM groups WHERE creator_id = auth.uid())
  );

-- ============================================================
-- JOIN GROUP VIA LINK RPC
-- ============================================================
-- Called by an authenticated user with a link token.
-- Atomically:
--   1. Validates the token exists, is active, not expired, not over max_uses
--   2. Checks if user is already a member (upgrades invited→accepted, or
--      returns already_member for accepted members)
--   3. Inserts into group_members with status 'accepted'
--   4. Increments use_count

CREATE OR REPLACE FUNCTION join_group_via_link(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link       RECORD;
  v_caller_id  uuid;
  v_existing   RECORD;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'auth_required: must be authenticated';
  END IF;

  -- Lock and fetch the invite link
  SELECT *
    INTO v_link
    FROM group_invite_links
   WHERE token = p_token
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token: invite link not found';
  END IF;

  IF NOT v_link.is_active THEN
    RAISE EXCEPTION 'link_inactive: this invite link has been deactivated';
  END IF;

  IF v_link.expires_at IS NOT NULL AND v_link.expires_at < now() THEN
    RAISE EXCEPTION 'link_expired: this invite link has expired';
  END IF;

  IF v_link.max_uses IS NOT NULL AND v_link.use_count >= v_link.max_uses THEN
    RAISE EXCEPTION 'link_exhausted: this invite link has reached its maximum uses';
  END IF;

  -- Check if user is already a group member
  SELECT group_id, user_id, status
    INTO v_existing
    FROM group_members
   WHERE group_id = v_link.group_id
     AND user_id = v_caller_id;

  IF FOUND THEN
    IF v_existing.status = 'accepted' THEN
      -- Already an accepted member — return success without incrementing
      RETURN jsonb_build_object(
        'group_id', v_link.group_id,
        'already_member', true,
        'status', 'accepted'
      );
    END IF;

    -- Upgrade invited → accepted
    UPDATE group_members
       SET status = 'accepted',
           accepted_at = now()
     WHERE group_id = v_link.group_id
       AND user_id = v_caller_id;

    -- Increment use_count
    UPDATE group_invite_links
       SET use_count = use_count + 1
     WHERE id = v_link.id;

    RETURN jsonb_build_object(
      'group_id', v_link.group_id,
      'already_member', false,
      'status', 'accepted'
    );
  END IF;

  -- New member — insert directly as accepted
  INSERT INTO group_members (group_id, user_id, status, invited_by, accepted_at)
  VALUES (v_link.group_id, v_caller_id, 'accepted', v_link.created_by, now());

  -- Increment use_count
  UPDATE group_invite_links
     SET use_count = use_count + 1
   WHERE id = v_link.id;

  RETURN jsonb_build_object(
    'group_id', v_link.group_id,
    'already_member', false,
    'status', 'accepted'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION join_group_via_link(uuid) TO authenticated;
