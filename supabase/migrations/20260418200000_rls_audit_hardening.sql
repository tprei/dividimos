-- RLS audit hardening (2026-04-18).
--
-- Plugs the gaps that allowed UPDATE policies to mutate fields the
-- WITH CHECK clause did not pin, and tightens a couple of low-severity
-- INSERT/UPDATE WITH CHECK gaps so the status invariants we rely on
-- elsewhere are enforced at the database level.
--
-- Findings addressed:
--
-- [HIGH] group_members_accept forgery. The UPDATE policy's USING
--   admitted any row where user_id = auth.uid() and the WITH CHECK only
--   required status = 'accepted'. A user could:
--     * Flip their own status = 'invited' row's group_id to some other
--       group they were never invited to, emerging as an accepted member.
--     * Touch their already-accepted row to rewrite invited_by / group_id
--       in place, corrupting membership metadata.
--   Fix: restrict USING to status = 'invited', require user_id = auth.uid()
--   in WITH CHECK, and add a BEFORE UPDATE trigger that pins group_id,
--   user_id, invited_by, and created_at. The SECURITY DEFINER RPCs that
--   legitimately update group_members (claim_guest_spot, join_group_via_link)
--   only touch status / accepted_at, so they continue to work.
--
-- [MEDIUM] users_update_own had no WITH CHECK at all. A user could update
--   their own row mutating email, avatar_url, or created_at directly
--   (id is guarded by the auth.users FK), which is neither expected nor
--   consistent with the trust boundary: email flows from auth.users and
--   avatar_url is set by the handle_new_user trigger at signup. Fix: add
--   WITH CHECK (auth.uid() = id) and a BEFORE UPDATE trigger that pins
--   id, email, avatar_url, and created_at for authenticated writers.
--   Service role (auth.uid() IS NULL) bypasses the trigger so admin
--   operations and future migrations remain unconstrained.
--
-- [MEDIUM] groups UPDATE did not pin is_dm. A creator could flip
--   is_dm = true on an existing non-DM group (hiding it from the groups
--   tab filter) or flip is_dm = false on a DM group (leaking it into the
--   groups tab). Mirrors the hardening already applied to the INSERT
--   policy. DMs remain writable via get_or_create_dm_group (SECURITY
--   DEFINER, bypasses RLS).
--
-- [LOW] chat_messages_update WITH CHECK omitted message_type = 'text'.
--   A sender could UPDATE their own text message into a system_expense
--   / system_settlement row with an arbitrary expense_id / settlement_id
--   and forge system-message UI inside a DM thread. The viewer still
--   needs visibility on the referenced expense/settlement, but the
--   forgery surface should not exist at all.
--
-- [LOW] settlements_insert did not constrain status or confirmed_at.
--   A debtor could insert a row with status = 'confirmed',
--   confirmed_at = <arbitrary>, polluting the settlement history. The
--   balances ledger is unaffected (writes go through confirm_settlement
--   and record_and_settle RPCs only), but the row shows up as confirmed
--   in settlement history. Mirrors the vendor_charges_insert hardening.

-- ============================================================
-- 1. group_members_accept — require user_id + invited status
-- ============================================================

DROP POLICY IF EXISTS "group_members_accept" ON public.group_members;

CREATE POLICY "group_members_accept" ON public.group_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'invited')
  WITH CHECK (user_id = auth.uid() AND status = 'accepted');

CREATE OR REPLACE FUNCTION public.enforce_group_members_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

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

DROP TRIGGER IF EXISTS group_members_enforce_immutable ON public.group_members;
CREATE TRIGGER group_members_enforce_immutable
  BEFORE UPDATE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_group_members_immutable();

-- ============================================================
-- 2. users_update_own — add WITH CHECK + pin immutable columns
-- ============================================================

DROP POLICY IF EXISTS "users_update_own" ON public.users;

CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.enforce_users_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'users.id is immutable';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'users.email cannot be modified by clients';
  END IF;
  IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN
    RAISE EXCEPTION 'users.avatar_url cannot be modified by clients';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'users.created_at is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_enforce_immutable ON public.users;
CREATE TRIGGER users_enforce_immutable
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_users_immutable();

-- ============================================================
-- 3. groups UPDATE — pin is_dm to false
-- ============================================================

DROP POLICY IF EXISTS "group_update" ON public.groups;

CREATE POLICY "group_update" ON public.groups
  FOR UPDATE TO authenticated
  USING (creator_id = auth.uid() AND is_dm = false)
  WITH CHECK (creator_id = auth.uid() AND is_dm = false);

-- ============================================================
-- 4. chat_messages_update — require text type in WITH CHECK
-- ============================================================

DROP POLICY IF EXISTS chat_messages_update ON public.chat_messages;

CREATE POLICY chat_messages_update ON public.chat_messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() AND message_type = 'text')
  WITH CHECK (sender_id = auth.uid() AND message_type = 'text');

-- ============================================================
-- 5. settlements_insert — pin status/confirmed_at at insert time
-- ============================================================

DROP POLICY IF EXISTS settlements_insert ON public.settlements;

CREATE POLICY settlements_insert ON public.settlements
  FOR INSERT TO authenticated
  WITH CHECK (
    from_user_id = auth.uid()
    AND group_id IN (SELECT public.my_accepted_group_ids())
    AND status = 'pending'
    AND confirmed_at IS NULL
  );
