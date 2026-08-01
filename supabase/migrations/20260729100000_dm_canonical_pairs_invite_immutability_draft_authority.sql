-- ============================================================
-- Combined forward migration for issues #470, #471, #472.
--
-- These three issues are coupled by their own specs and must ship
-- together: #470 (invite-link ownership/target immutability) and #472
-- (canonical two-person DM membership) explicitly require landing in
-- the same migration; #471 (save_expense_draft_graph authority) is
-- amended in the same window because #472's participant-map/membership
-- guards and #470's DM-link rejection both touch the exact functions
-- #471 owns (group_members_insert, accept/decline/leave/remove).
--
-- Scope actually remaining after auditing the current schema (most of
-- #468/#465/#467's prerequisite work already landed and already gives
-- save_expense_draft_graph/activate_saved_expense the "group creator OR
-- accepted member" + "expense creator" authority predicate #471 asks
-- for):
--
--   #471 remaining gaps closed here:
--     - accept_group_invitation RPC (previously a raw client UPDATE
--       gated only by RLS; now a locked SECURITY DEFINER RPC matching
--       decline_group_invitation's existing pattern).
--     - group_members_insert tightened to pin status='invited' and
--       accepted_at IS NULL (previously unconstrained by WITH CHECK).
--     - leave_group / remove_group_member atomically delete the
--       departing/removed member's own draft expenses before deleting
--       membership, so a departed non-owner can no longer strand an
--       undeletable #466 group blocker.
--     - the old six-JSON save_expense_draft(jsonb x6) signature is
--       dropped; save_expense_draft_graph is the only public writer.
--     - the expenses BEFORE DELETE trigger (#467's retirement helper)
--       gains a guard: an authenticated direct/#505 delete of a
--       'draft' expense with a live allocation plan, committed/
--       cancelled operation link, or system_expense message is
--       corruption (PST07), never silently retired away.
--
--   #470 (group_invite_links immutability):
--     - created_by defaults to auth.uid(); INSERT is column-restricted
--       to (group_id, expires_at, max_uses).
--     - authenticated UPDATE/DELETE are fully revoked; the only
--       lifecycle mutation is the new deactivate_group_invite_link RPC
--       (monotonic is_active true -> false, group-first locked).
--     - join_group_via_link gets stable SQLSTATEs and its PUBLIC
--       EXECUTE grant is closed (authenticated only).
--     - every currently active link is deactivated once (this project
--       has no production user base yet, so the "historical security
--       audit" this issue requires for a live deployment is vacuous
--       here; the one-time invalidation itself still runs so any
--       future real deployment inherits a clean cutover).
--
--   #472 (canonical two-person DM membership):
--     - dm_pairs user_a/user_b FKs become deferrable so a noncreator
--       account delete fails atomically instead of orphaning a DM.
--     - assert_dm_group_shape / assert_dm_actor / assert_dm_participants
--       owner-only internal helpers, called by an immediate BEFORE
--       INSERT OR UPDATE guard trigger on group_members and by deferred
--       constraint triggers on groups/dm_pairs/group_members for
--       cross-table invariants.
--     - my_group_ids()/my_accepted_group_ids() become pair-aware so a
--       legacy/corrupt non-pair DM membership grants no visibility.
--     - group_members_insert additionally requires a regular (non-DM)
--       target group.
--     - get_or_create_dm_group is rewritten: the existing-pair path is
--       strictly read-only (preserves the invite wall); the new-pair
--       path re-validates the shared-group auto-accept wall under the
--       new group's lock.
--     - group_invite_links gets a regular-only target trigger and
--       join_group_via_link defensively rejects any DM target.
--     - conversation_read_receipts policies become pair-aware via the
--       same my_group_ids() helper, plus a no-bypass immutability
--       trigger.
--
-- Deferred to a later session (explicitly out of scope for this
-- migration, tracked separately): #581's opaque guest-claim token
-- cutover, #599's append-only chat ACL, full client-side privacy
-- boundary rewrites for every server-rendered join/claim/conversation
-- page, and the deterministic two-connection concurrency matrix beyond
-- the focused coverage added alongside this migration.
-- ============================================================

-- ============================================================
-- 1. dm_pairs: deferrable ownership FKs, explicit revoke.
-- ============================================================

ALTER TABLE public.dm_pairs
  DROP CONSTRAINT IF EXISTS dm_pairs_user_a_fkey,
  DROP CONSTRAINT IF EXISTS dm_pairs_user_b_fkey;

ALTER TABLE public.dm_pairs
  ADD CONSTRAINT dm_pairs_user_a_fkey
    FOREIGN KEY (user_a) REFERENCES public.users(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT dm_pairs_user_b_fkey
    FOREIGN KEY (user_b) REFERENCES public.users(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.dm_pairs
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 2. Owner-only DM shape/actor/participant assertions.
-- ============================================================

CREATE OR REPLACE FUNCTION public.assert_dm_group_shape(
  p_group_id uuid,
  p_allow_missing boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_group          RECORD;
  v_pair_count     integer;
  v_pair           RECORD;
  v_outsider_count integer;
BEGIN
  IF p_allow_missing IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  SELECT id, is_dm, creator_id
    INTO v_group
    FROM public.groups
   WHERE id = p_group_id;

  IF NOT FOUND THEN
    IF p_allow_missing THEN
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'PST08', MESSAGE = 'group_not_found';
  END IF;

  SELECT count(*) INTO v_pair_count FROM public.dm_pairs WHERE group_id = p_group_id;

  IF v_group.is_dm THEN
    IF v_pair_count <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'dm_shape_corrupt';
    END IF;

    SELECT user_a, user_b INTO v_pair FROM public.dm_pairs WHERE group_id = p_group_id;

    IF v_group.creator_id IS DISTINCT FROM v_pair.user_a
       AND v_group.creator_id IS DISTINCT FROM v_pair.user_b THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'dm_shape_corrupt';
    END IF;

    SELECT count(*)
      INTO v_outsider_count
      FROM public.group_members gm
     WHERE gm.group_id = p_group_id
       AND gm.user_id NOT IN (v_pair.user_a, v_pair.user_b);

    IF v_outsider_count > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'dm_shape_corrupt';
    END IF;
  ELSE
    IF v_pair_count <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'dm_shape_corrupt';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_dm_group_shape(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_dm_actor(
  p_group_id uuid,
  p_user_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_dm boolean;
  v_pair  RECORD;
BEGIN
  PERFORM public.assert_dm_group_shape(p_group_id, false);

  SELECT is_dm INTO v_is_dm FROM public.groups WHERE id = p_group_id;
  IF NOT v_is_dm THEN
    RETURN;
  END IF;

  SELECT user_a, user_b INTO v_pair FROM public.dm_pairs WHERE group_id = p_group_id;

  IF p_user_id IS DISTINCT FROM v_pair.user_a AND p_user_id IS DISTINCT FROM v_pair.user_b THEN
    RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_dm_actor(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_dm_participants(
  p_group_id  uuid,
  p_user_ids  uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_dm boolean;
  v_pair  RECORD;
  v_uid   uuid;
BEGIN
  PERFORM public.assert_dm_group_shape(p_group_id, false);

  SELECT is_dm INTO v_is_dm FROM public.groups WHERE id = p_group_id;
  IF NOT v_is_dm THEN
    RETURN;
  END IF;

  SELECT user_a, user_b INTO v_pair FROM public.dm_pairs WHERE group_id = p_group_id;

  IF p_user_ids IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_uid IN ARRAY p_user_ids LOOP
    IF v_uid IS DISTINCT FROM v_pair.user_a AND v_uid IS DISTINCT FROM v_pair.user_b THEN
      RAISE EXCEPTION USING ERRCODE = 'PST04', MESSAGE = 'invalid_participants';
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_dm_participants(uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 3. Immediate membership guard + tightened immutability trigger.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_dm_membership_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.assert_dm_participants(NEW.group_id, ARRAY[NEW.user_id]);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_dm_membership_guard ON public.group_members;
CREATE TRIGGER enforce_dm_membership_guard
  BEFORE INSERT OR UPDATE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dm_membership_guard();

-- No auth.uid() IS NULL bypass: every role, including service/admin
-- fixtures, must use explicit delete/insert to correct identity rather
-- than an UPDATE that retargets a pinned column.
CREATE OR REPLACE FUNCTION public.enforce_group_members_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION 'group_members.group_id is immutable';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'group_members.user_id is immutable';
  END IF;
  IF NEW.invited_by IS DISTINCT FROM OLD.invited_by THEN
    RAISE EXCEPTION 'group_members.invited_by is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'group_members.created_at is immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 4. Deferred cross-table shape assertions.
-- ============================================================

CREATE OR REPLACE FUNCTION public.deferred_assert_dm_shape_groups_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.assert_dm_group_shape(COALESCE(NEW.id, OLD.id), true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS deferred_assert_dm_shape_groups ON public.groups;
CREATE CONSTRAINT TRIGGER deferred_assert_dm_shape_groups
  AFTER INSERT OR UPDATE ON public.groups
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.deferred_assert_dm_shape_groups_trigger();

CREATE OR REPLACE FUNCTION public.deferred_assert_dm_shape_pairs_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.assert_dm_group_shape(COALESCE(NEW.group_id, OLD.group_id), true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS deferred_assert_dm_shape_pairs ON public.dm_pairs;
CREATE CONSTRAINT TRIGGER deferred_assert_dm_shape_pairs
  AFTER INSERT OR UPDATE OR DELETE ON public.dm_pairs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.deferred_assert_dm_shape_pairs_trigger();

CREATE OR REPLACE FUNCTION public.deferred_assert_dm_shape_members_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.assert_dm_group_shape(COALESCE(NEW.group_id, OLD.group_id), true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS deferred_assert_dm_shape_members ON public.group_members;
CREATE CONSTRAINT TRIGGER deferred_assert_dm_shape_members
  AFTER INSERT OR UPDATE OR DELETE ON public.group_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.deferred_assert_dm_shape_members_trigger();

-- Immediate backstop: is_dm, a surviving DM's creator_id, and the pair
-- identity columns never change after insert.
CREATE OR REPLACE FUNCTION public.enforce_groups_dm_fields_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_dm IS DISTINCT FROM OLD.is_dm THEN
    RAISE EXCEPTION 'groups.is_dm is immutable';
  END IF;
  IF OLD.is_dm AND NEW.creator_id IS DISTINCT FROM OLD.creator_id THEN
    RAISE EXCEPTION 'a DM group''s creator_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_groups_dm_fields_immutable ON public.groups;
CREATE TRIGGER enforce_groups_dm_fields_immutable
  BEFORE UPDATE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.enforce_groups_dm_fields_immutable();

CREATE OR REPLACE FUNCTION public.enforce_dm_pairs_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'dm_pairs rows are immutable after insert';
END;
$$;

DROP TRIGGER IF EXISTS enforce_dm_pairs_immutable ON public.dm_pairs;
CREATE TRIGGER enforce_dm_pairs_immutable
  BEFORE UPDATE ON public.dm_pairs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dm_pairs_immutable();

-- ============================================================
-- 5. Pair-aware visibility helpers.
-- ============================================================

CREATE OR REPLACE FUNCTION public.my_group_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT g.id
    FROM public.groups g
   WHERE (
     g.creator_id = auth.uid()
     OR EXISTS (
       SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = g.id AND gm.user_id = auth.uid()
     )
   )
   AND (
     NOT g.is_dm
     OR EXISTS (
       SELECT 1 FROM public.dm_pairs p
        WHERE p.group_id = g.id
          AND (p.user_a = auth.uid() OR p.user_b = auth.uid())
     )
   )
$$;

CREATE OR REPLACE FUNCTION public.my_accepted_group_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT g.id
    FROM public.groups g
   WHERE (
     g.creator_id = auth.uid()
     OR EXISTS (
       SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = g.id AND gm.user_id = auth.uid() AND gm.status = 'accepted'
     )
   )
   AND (
     NOT g.is_dm
     OR EXISTS (
       SELECT 1 FROM public.dm_pairs p
        WHERE p.group_id = g.id
          AND (p.user_a = auth.uid() OR p.user_b = auth.uid())
     )
   )
$$;

-- These execute with the querying role's own function privileges
-- because the existing PUBLIC RLS policies call them; there are no
-- identity arguments and auth.uid() is the only subject.
REVOKE ALL ON FUNCTION public.my_group_ids() FROM PUBLIC, service_role;
REVOKE ALL ON FUNCTION public.my_accepted_group_ids() FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.my_group_ids() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.my_accepted_group_ids() TO authenticated, anon;

-- ============================================================
-- 6. group_members_insert: regular-group-only, pinned invited state.
-- ============================================================

DROP POLICY IF EXISTS "group_members_insert" ON public.group_members;

CREATE POLICY "group_members_insert" ON public.group_members
  FOR INSERT TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND status = 'invited'
    AND accepted_at IS NULL
    AND group_id IN (SELECT public.my_accepted_group_ids())
    AND group_id IN (SELECT id FROM public.groups WHERE NOT is_dm)
  );

-- ============================================================
-- 7. accept_group_invitation RPC; lock down the raw UPDATE accept path.
-- ============================================================

CREATE OR REPLACE FUNCTION public.accept_group_invitation(
  p_group_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_member_status text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Group-first lock, matching every other membership/balance RPC.
  PERFORM id FROM public.groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;

  SELECT status INTO v_member_status
    FROM public.group_members
   WHERE group_id = p_group_id AND user_id = v_caller
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member: you are not invited to this group';
  END IF;

  IF v_member_status != 'invited' THEN
    RAISE EXCEPTION 'not_invited: only a pending invitation can be accepted';
  END IF;

  UPDATE public.group_members
     SET status = 'accepted', accepted_at = now()
   WHERE group_id = p_group_id AND user_id = v_caller;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_group_invitation(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.accept_group_invitation(uuid) TO authenticated;

DROP POLICY IF EXISTS "group_members_accept" ON public.group_members;
CREATE POLICY "group_members_accept_denied" ON public.group_members
  FOR UPDATE TO authenticated
  USING (false);

-- ============================================================
-- 8. get_or_create_dm_group: read-only existing-pair path, re-validated
--    shared-group wall for a new pair.
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
  v_caller                uuid := auth.uid();
  v_user_a                uuid;
  v_user_b                uuid;
  v_group_id              uuid;
  v_caller_profile_exists boolean;
  v_other_profile_exists  boolean;
  v_shared_group_id       uuid;
  v_shared_ok             boolean := false;
  v_caller_authority      boolean;
  v_other_authority       boolean;
  v_constraint_name       text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PST01';
  END IF;

  IF p_other_user_id IS NULL OR p_other_user_id = v_caller THEN
    RAISE EXCEPTION 'invalid_operation: cannot create a DM with yourself' USING ERRCODE = 'PST02';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.users WHERE id = v_caller) INTO v_caller_profile_exists;
  SELECT EXISTS(SELECT 1 FROM public.users WHERE id = p_other_user_id) INTO v_other_profile_exists;

  IF NOT v_caller_profile_exists THEN
    RAISE EXCEPTION 'profile_missing' USING ERRCODE = 'PST07';
  END IF;
  IF NOT v_other_profile_exists THEN
    RAISE EXCEPTION 'user_not_found: the other user does not exist' USING ERRCODE = 'PST05';
  END IF;

  IF v_caller < p_other_user_id THEN
    v_user_a := v_caller;
    v_user_b := p_other_user_id;
  ELSE
    v_user_a := p_other_user_id;
    v_user_b := v_caller;
  END IF;

  -- Existing pair: strictly read-only. Never accept/re-invite/restore a
  -- membership row on replay.
  SELECT group_id INTO v_group_id
    FROM public.dm_pairs
   WHERE user_a = v_user_a AND user_b = v_user_b;

  IF v_group_id IS NOT NULL THEN
    PERFORM id FROM public.groups WHERE id = v_group_id FOR UPDATE;
    PERFORM public.assert_dm_group_shape(v_group_id, false);
    RETURN v_group_id;
  END IF;

  -- New pair: find the lowest-id regular group in which both users
  -- currently have accepted-or-creator authority.
  SELECT g.id INTO v_shared_group_id
    FROM public.groups g
    JOIN public.group_members gm1 ON gm1.group_id = g.id AND gm1.user_id = v_caller
    JOIN public.group_members gm2 ON gm2.group_id = g.id AND gm2.user_id = p_other_user_id
   WHERE NOT g.is_dm
     AND (g.creator_id = v_caller OR gm1.status = 'accepted')
     AND (g.creator_id = p_other_user_id OR gm2.status = 'accepted')
   ORDER BY g.id
   LIMIT 1;

  IF v_shared_group_id IS NOT NULL THEN
    PERFORM id FROM public.groups WHERE id = v_shared_group_id FOR UPDATE;

    SELECT
      (g.creator_id = v_caller OR EXISTS (
        SELECT 1 FROM public.group_members gm
         WHERE gm.group_id = g.id AND gm.user_id = v_caller AND gm.status = 'accepted'
      )),
      (g.creator_id = p_other_user_id OR EXISTS (
        SELECT 1 FROM public.group_members gm
         WHERE gm.group_id = g.id AND gm.user_id = p_other_user_id AND gm.status = 'accepted'
      ))
      INTO v_caller_authority, v_other_authority
      FROM public.groups g
     WHERE g.id = v_shared_group_id;

    v_shared_ok := COALESCE(v_caller_authority, false) AND COALESCE(v_other_authority, false);
  END IF;

  INSERT INTO public.groups (name, creator_id, is_dm)
  VALUES ('', v_caller, true)
  RETURNING id INTO v_group_id;

  BEGIN
    INSERT INTO public.dm_pairs (group_id, user_a, user_b)
    VALUES (v_group_id, v_user_a, v_user_b);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name IS DISTINCT FROM 'dm_pairs_unique' THEN
      RAISE EXCEPTION 'unexpected_conflict' USING ERRCODE = 'PST07';
    END IF;

    -- Losing candidate: no group_members rows exist yet on this brand
    -- new empty group, so a direct delete is safe.
    DELETE FROM public.groups WHERE id = v_group_id;

    SELECT group_id INTO v_group_id
      FROM public.dm_pairs
     WHERE user_a = v_user_a AND user_b = v_user_b;

    PERFORM id FROM public.groups WHERE id = v_group_id FOR UPDATE;
    PERFORM public.assert_dm_group_shape(v_group_id, false);
    RETURN v_group_id;
  END;

  IF v_shared_ok THEN
    INSERT INTO public.group_members (group_id, user_id, status, invited_by, accepted_at)
    VALUES
      (v_group_id, v_caller,        'accepted', v_caller, now()),
      (v_group_id, p_other_user_id, 'accepted', v_caller, now());
  ELSE
    INSERT INTO public.group_members (group_id, user_id, status, invited_by, accepted_at)
    VALUES (v_group_id, v_caller, 'accepted', v_caller, now());

    INSERT INTO public.group_members (group_id, user_id, status, invited_by)
    VALUES (v_group_id, p_other_user_id, 'invited', v_caller);
  END IF;

  RETURN v_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_dm_group(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm_group(uuid) TO authenticated;

-- ============================================================
-- 9. group_invite_links: server-owned creation, no generic mutation.
-- ============================================================

ALTER TABLE public.group_invite_links
  ALTER COLUMN created_by SET DEFAULT auth.uid();

DROP POLICY IF EXISTS "group_invite_links_insert" ON public.group_invite_links;
DROP POLICY IF EXISTS group_invite_links_insert ON public.group_invite_links;

CREATE POLICY group_invite_links_insert ON public.group_invite_links
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND group_id IN (
      SELECT g.id
        FROM public.groups g
       WHERE NOT g.is_dm
         AND (
           g.creator_id = auth.uid()
           OR g.id IN (SELECT public.my_accepted_group_ids())
         )
    )
  );

DROP POLICY IF EXISTS group_invite_links_update ON public.group_invite_links;
DROP POLICY IF EXISTS group_invite_links_delete ON public.group_invite_links;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.group_invite_links
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT (
  id, group_id, token, created_by, expires_at,
  max_uses, use_count, is_active, created_at
) ON TABLE public.group_invite_links
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (group_id, expires_at, max_uses)
  ON TABLE public.group_invite_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.group_invite_links TO service_role;

CREATE OR REPLACE FUNCTION public.deactivate_group_invite_link(
  p_link_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller              uuid := auth.uid();
  v_candidate_group_id  uuid;
  v_group               RECORD;
  v_link                RECORD;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'PST01';
  END IF;

  SELECT group_id INTO v_candidate_group_id
    FROM public.group_invite_links
   WHERE id = p_link_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'PST05';
  END IF;

  SELECT id, creator_id INTO v_group
    FROM public.groups
   WHERE id = v_candidate_group_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  SELECT id, created_by, group_id, is_active INTO v_link
    FROM public.group_invite_links
   WHERE id = p_link_id
   FOR UPDATE;

  IF NOT FOUND OR v_link.group_id IS DISTINCT FROM v_group.id THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  IF v_link.created_by IS DISTINCT FROM v_caller
     AND v_group.creator_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'PST05';
  END IF;

  UPDATE public.group_invite_links SET is_active = false WHERE id = v_link.id;
END;
$$;

REVOKE ALL ON FUNCTION public.deactivate_group_invite_link(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_group_invite_link(uuid) TO authenticated;

-- #472 coupling: an invite link can never target a DM.
CREATE OR REPLACE FUNCTION public.enforce_regular_invite_link_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_dm      boolean;
  v_pair_count integer;
BEGIN
  SELECT is_dm INTO v_is_dm FROM public.groups WHERE id = NEW.group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_not_found' USING ERRCODE = 'PST08';
  END IF;

  SELECT count(*) INTO v_pair_count FROM public.dm_pairs WHERE group_id = NEW.group_id;

  IF v_is_dm OR v_pair_count > 0 THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'PST05';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_regular_invite_link_target ON public.group_invite_links;
CREATE TRIGGER enforce_regular_invite_link_target
  BEFORE INSERT OR UPDATE OF group_id ON public.group_invite_links
  FOR EACH ROW EXECUTE FUNCTION public.enforce_regular_invite_link_target();

-- One-time invalidation. This project has no live production traffic
-- yet, so the historical-audit prerequisite this issue requires before
-- a real deployment is vacuous here; a future genuine production
-- cutover must still perform that audit before running this statement
-- against real user data.
UPDATE public.group_invite_links SET is_active = false WHERE is_active = true;

-- ============================================================
-- 10. join_group_via_link: stable SQLSTATEs, defensive DM rejection,
--     closed default EXECUTE grant.
-- ============================================================

CREATE OR REPLACE FUNCTION public.join_group_via_link(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id  uuid := auth.uid();
  v_link_ref   RECORD;
  v_group      RECORD;
  v_link       RECORD;
  v_existing   RECORD;
  v_pair_count integer;
  v_checked_at timestamptz;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PST01';
  END IF;

  SELECT l.id, l.group_id
    INTO v_link_ref
    FROM public.group_invite_links l
   WHERE l.token = p_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token: invite link not found' USING ERRCODE = 'PST05';
  END IF;

  SELECT g.id, g.is_dm
    INTO v_group
    FROM public.groups g
   WHERE g.id = v_link_ref.group_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  SELECT l.*
    INTO v_link
    FROM public.group_invite_links l
   WHERE l.id = v_link_ref.id
     AND l.token = p_token
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token: invite link not found' USING ERRCODE = 'PST05';
  END IF;

  IF v_link.group_id IS DISTINCT FROM v_group.id THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  -- #472 defensive DM rejection: before link-validity/membership
  -- checks, reveals no pair/group metadata, and covers a seeded or
  -- retargeted legacy DM link.
  SELECT count(*) INTO v_pair_count FROM public.dm_pairs WHERE group_id = v_group.id;
  IF v_group.is_dm OR v_pair_count > 0 THEN
    RAISE EXCEPTION 'invalid_token: invite link not found' USING ERRCODE = 'PST05';
  END IF;

  v_checked_at := clock_timestamp();

  IF NOT v_link.is_active THEN
    RAISE EXCEPTION 'link_inactive: this invite link has been deactivated' USING ERRCODE = 'PST08';
  END IF;

  IF v_link.expires_at IS NOT NULL AND v_link.expires_at < v_checked_at THEN
    RAISE EXCEPTION 'link_expired: this invite link has expired' USING ERRCODE = 'PST08';
  END IF;

  IF v_link.max_uses IS NOT NULL AND v_link.use_count >= v_link.max_uses THEN
    RAISE EXCEPTION 'link_exhausted: this invite link has reached its maximum uses' USING ERRCODE = 'PST08';
  END IF;

  SELECT group_id, user_id, status
    INTO v_existing
    FROM public.group_members
   WHERE group_id = v_link.group_id
     AND user_id = v_caller_id;

  IF FOUND THEN
    IF v_existing.status = 'accepted' THEN
      RETURN jsonb_build_object(
        'group_id', v_link.group_id,
        'already_member', true,
        'status', 'accepted'
      );
    END IF;

    UPDATE public.group_members
       SET status = 'accepted',
           accepted_at = now()
     WHERE group_id = v_link.group_id
       AND user_id = v_caller_id;

    UPDATE public.group_invite_links
       SET use_count = use_count + 1
     WHERE id = v_link.id;

    RETURN jsonb_build_object(
      'group_id', v_link.group_id,
      'already_member', false,
      'status', 'accepted'
    );
  END IF;

  INSERT INTO public.group_members (group_id, user_id, status, invited_by, accepted_at)
  VALUES (v_link.group_id, v_caller_id, 'accepted', v_link.created_by, now());

  UPDATE public.group_invite_links
     SET use_count = use_count + 1
   WHERE id = v_link.id;

  RETURN jsonb_build_object(
    'group_id', v_link.group_id,
    'already_member', false,
    'status', 'accepted'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.join_group_via_link(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.join_group_via_link(uuid) TO authenticated;

-- ============================================================
-- 11. conversation_read_receipts: pair-aware policies + immutability.
-- ============================================================

DROP POLICY IF EXISTS "conversation_read_receipts_select" ON public.conversation_read_receipts;
DROP POLICY IF EXISTS "conversation_read_receipts_insert" ON public.conversation_read_receipts;
DROP POLICY IF EXISTS "conversation_read_receipts_update" ON public.conversation_read_receipts;
DROP POLICY IF EXISTS "conversation_read_receipts_delete" ON public.conversation_read_receipts;

CREATE POLICY "conversation_read_receipts_select" ON public.conversation_read_receipts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND group_id IN (SELECT public.my_group_ids())
  );

CREATE POLICY "conversation_read_receipts_insert" ON public.conversation_read_receipts
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND group_id IN (SELECT public.my_group_ids())
  );

CREATE POLICY "conversation_read_receipts_update" ON public.conversation_read_receipts
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND group_id IN (SELECT public.my_group_ids())
  )
  WITH CHECK (
    user_id = auth.uid()
    AND group_id IN (SELECT public.my_group_ids())
  );

CREATE POLICY "conversation_read_receipts_delete" ON public.conversation_read_receipts
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND group_id IN (SELECT public.my_group_ids())
  );

CREATE OR REPLACE FUNCTION public.enforce_read_receipts_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'conversation_read_receipts.user_id is immutable';
  END IF;
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION 'conversation_read_receipts.group_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_read_receipts_immutable ON public.conversation_read_receipts;
CREATE TRIGGER enforce_read_receipts_immutable
  BEFORE UPDATE ON public.conversation_read_receipts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_read_receipts_immutable();

-- ============================================================
-- 12. #471: departed-member draft cleanup on leave/remove.
-- ============================================================

CREATE OR REPLACE FUNCTION public.leave_group(
  p_group_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller         uuid := auth.uid();
  v_group_creator  uuid;
  v_member_status  text;
  v_draft_ids      uuid[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT creator_id INTO v_group_creator
  FROM public.groups
  WHERE id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;

  IF v_caller = v_group_creator THEN
    RAISE EXCEPTION 'invalid_operation: group creator cannot leave the group';
  END IF;

  SELECT status INTO v_member_status
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member: you are not a member of this group';
  END IF;

  IF v_member_status != 'accepted' THEN
    RAISE EXCEPTION 'not_accepted: only accepted members can leave a group (use decline for invitations)';
  END IF;

  IF public.has_outstanding_balance(p_group_id, v_caller) THEN
    RAISE EXCEPTION 'has_outstanding_balance: you have unsettled debts in this group';
  END IF;

  DELETE FROM public.settlements
  WHERE group_id    = p_group_id
    AND status      = 'pending'
    AND (from_user_id = v_caller OR to_user_id = v_caller);

  DELETE FROM public.balances
  WHERE group_id = p_group_id
    AND (user_a = v_caller OR user_b = v_caller)
    AND amount_cents = 0;

  -- #471: a departing non-owner cannot strand their own draft as an
  -- undeletable #466 group blocker. Only status='draft' expenses they
  -- created are removed; active/settled history and other members'
  -- drafts are untouched. The expenses BEFORE DELETE guard still
  -- raises PST07 for an impossibly linked draft, rolling this whole
  -- exit back rather than cascading history.
  SELECT array_agg(id) INTO v_draft_ids
    FROM (
      SELECT id
        FROM public.expenses
       WHERE group_id = p_group_id AND creator_id = v_caller AND status = 'draft'
       ORDER BY id
       FOR UPDATE
    ) locked_drafts;

  IF v_draft_ids IS NOT NULL THEN
    DELETE FROM public.expenses WHERE id = ANY(v_draft_ids);
  END IF;

  DELETE FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_group_member(
  p_group_id uuid,
  p_user_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller         uuid := auth.uid();
  v_group_creator  uuid;
  v_draft_ids      uuid[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT creator_id INTO v_group_creator
  FROM public.groups
  WHERE id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;

  IF v_caller != v_group_creator THEN
    RAISE EXCEPTION 'permission_denied: only the group creator can remove members';
  END IF;

  IF p_user_id = v_group_creator THEN
    RAISE EXCEPTION 'invalid_operation: cannot remove the group creator';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'member_not_found: user is not a member of this group';
  END IF;

  IF public.has_outstanding_balance(p_group_id, p_user_id) THEN
    RAISE EXCEPTION 'has_outstanding_balance: member has unsettled debts in this group';
  END IF;

  -- #471: same scoped draft-cleanup amendment as leave_group above,
  -- targeting the removed member's own drafts.
  SELECT array_agg(id) INTO v_draft_ids
    FROM (
      SELECT id
        FROM public.expenses
       WHERE group_id = p_group_id AND creator_id = p_user_id AND status = 'draft'
       ORDER BY id
       FOR UPDATE
    ) locked_drafts;

  IF v_draft_ids IS NOT NULL THEN
    DELETE FROM public.expenses WHERE id = ANY(v_draft_ids);
  END IF;

  DELETE FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_group(uuid) TO authenticated;

-- ============================================================
-- 13. expenses BEFORE DELETE guard: corrupt-draft check before #467's
--     retirement scrub, in one consolidated trigger function.
-- ============================================================

CREATE OR REPLACE FUNCTION public.retire_chat_expense_confirmations_for_expense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    -- Authenticated direct creator delete or #505 exit cleanup. A
    -- draft that already has an allocation plan, a live committed/
    -- cancelled confirmation-operation link, or a system_expense
    -- message is an impossible state for a still-draft expense —
    -- corruption, never silently retired/cascaded away.
    IF OLD.status = 'draft' THEN
      IF EXISTS (
        SELECT 1 FROM public.expense_allocation_entities e WHERE e.expense_id = OLD.id
      ) OR EXISTS (
        SELECT 1 FROM public.expense_balance_allocation_plans p WHERE p.expense_id = OLD.id
      ) OR EXISTS (
        SELECT 1 FROM public.chat_expense_confirmation_operations o
         WHERE o.expense_id = OLD.id AND o.outcome IN ('committed', 'cancelled')
      ) OR EXISTS (
        SELECT 1 FROM public.chat_messages m
         WHERE m.expense_id = OLD.id AND m.message_type = 'system_expense'
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'graph_state_corrupt';
      END IF;
    END IF;

    RETURN OLD;
  END IF;

  -- Trusted service/admin deletion (account/group teardown): continue
  -- into retirement instead of blocking teardown.
  UPDATE public.chat_expense_confirmation_operations
     SET outcome = 'retired',
         group_id = NULL,
         canonical_request = NULL,
         expense_id = NULL,
         system_message_id = NULL,
         terminal_code = 'expense_deleted',
         committed_at = NULL,
         cancelled_at = NULL,
         retired_at = statement_timestamp()
   WHERE expense_id = OLD.id
     AND outcome IN ('committed', 'cancelled');
  RETURN OLD;
END;
$$;

-- ============================================================
-- 14. #471: retire the old six-JSON draft writer entirely.
-- ============================================================

DROP FUNCTION IF EXISTS public.save_expense_draft(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb);

COMMENT ON FUNCTION public.save_expense_draft_graph IS
  'Issues #467/#468/#471/#477 prerequisite graph save: the sole public draft-graph writer. Current authority is the locked group''s creator or an accepted member, plus expense-creator ownership for an existing draft; revisioned CAS and durable operation replay. The old six-JSON save_expense_draft is dropped.';

-- ============================================================
-- 15. #471: fix activate_saved_expense's lock order to match
--     save_expense_draft_graph and every other #466 balance writer
--     (group first, then expense). The prerequisite bridge locked the
--     expense row first and only reached groups indirectly inside
--     activate_expense(), inverting the group-first convention and
--     deadlocking against a concurrent save_expense_draft_graph call
--     on the same expense.
-- ============================================================

CREATE OR REPLACE FUNCTION public.activate_saved_expense(
  p_expense_id uuid,
  p_expected_graph_revision integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller             uuid := auth.uid();
  v_candidate_group_id uuid;
  v_expense            public.expenses%ROWTYPE;
  v_revision           integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST01', MESSAGE = 'auth_required';
  END IF;

  -- Non-locking discovery of the candidate group, matching
  -- save_expense_draft_graph's "existing saves discover their real
  -- group from the parent" pattern.
  SELECT group_id INTO v_candidate_group_id
    FROM public.expenses
   WHERE id = p_expense_id;

  IF v_candidate_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
  END IF;

  -- Group-first lock, matching every other #466 balance/lifecycle
  -- writer (save_expense_draft_graph, leave_group, remove_group_member,
  -- accept/decline_group_invitation, record_settlements, delete_group).
  PERFORM id FROM public.groups WHERE id = v_candidate_group_id FOR UPDATE;

  SELECT *
    INTO v_expense
    FROM public.expenses
   WHERE id = p_expense_id
   FOR UPDATE;

  IF NOT FOUND
     OR v_expense.group_id IS DISTINCT FROM v_candidate_group_id
     OR v_expense.creator_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
  END IF;

  IF p_expected_graph_revision IS NULL
     OR p_expected_graph_revision <> v_expense.graph_revision
     OR v_expense.status <> 'draft'
     OR v_expense.graph_revision = 2147483647 THEN
    RAISE EXCEPTION USING ERRCODE = 'PST08', MESSAGE = 'stale_graph_revision';
  END IF;

  v_revision := v_expense.graph_revision;
  -- activate_expense re-locks the same already-held groups row
  -- internally; PostgreSQL row locks are reentrant within one
  -- transaction, so this is a no-op wait, never a second acquisition.
  PERFORM public.activate_expense(p_expense_id);

  UPDATE public.expenses
     SET graph_revision = v_revision + 1
   WHERE id = p_expense_id;

  RETURN pg_catalog.jsonb_build_object(
    'id', p_expense_id,
    'status', 'active',
    'graph_revision', v_revision + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_saved_expense(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activate_saved_expense(uuid, integer)
  TO authenticated;

COMMENT ON FUNCTION public.activate_saved_expense(uuid, integer) IS
  'Issue #477 prerequisite activation bridge: creator-only revision CAS around the current atomic activation body. #471: group-first lock order matches every other #466 balance writer.';
