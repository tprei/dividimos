-- Auto-generate an invite link when a new group is created.
--
-- This trigger fires AFTER INSERT on the groups table and inserts a row into
-- group_invite_links with no expiry or max_uses, making the link immediately
-- shareable. The creator_id from the new group is used as created_by.

CREATE OR REPLACE FUNCTION auto_create_group_invite_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO group_invite_links (group_id, created_by)
  VALUES (NEW.id, NEW.creator_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_create_group_invite_link
  AFTER INSERT ON groups
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_group_invite_link();
