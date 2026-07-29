-- Issue #534: expense activation push must require active status plus a
-- committed one-shot activation event, not a bare client-driven call after
-- activate_saved_expense succeeds. A direct repeat call (or a race between
-- two tabs/devices) must never emit twice, and draft/settled/noncreator
-- callers must never emit at all.
--
-- Adds one nullable timestamp column. The application layer (push-notify.ts)
-- performs the one-shot claim itself as a single atomic
-- `UPDATE ... WHERE status = 'active' AND creator_id = :caller AND
-- activation_notified_at IS NULL RETURNING ...` via the trusted admin
-- client — exactly one concurrent caller can ever observe a returned row
-- for a given expense, and only after status has actually flipped to
-- 'active'. No new RPC is needed: the admin client already has full table
-- access, and the atomicity comes from Postgres's own row-level UPDATE
-- semantics, not from a new SECURITY DEFINER wrapper.

ALTER TABLE public.expenses
  ADD COLUMN activation_notified_at timestamptz;

COMMENT ON COLUMN public.expenses.activation_notified_at IS
  'Issue #534: set exactly once, atomically, by the first successful activation-push claim. NULL means no push has been sent yet (or the expense has never been active). Never reset.';

-- The pre-existing creator draft-update policy (20260412010000) permits a
-- creator to freely change any column on their own draft row; it does not
-- know this column exists. Without a further restriction, a creator could
-- directly UPDATE this column to a non-null value while the expense is
-- still a draft (the only status this policy's USING/WITH CHECK ever
-- matches), before ever calling activate_saved_expense. That value
-- survives the later draft -> active transition (performed by an
-- unrelated RPC that never touches this column), so notifyExpenseActivated's
-- one-shot claim UPDATE would find activation_notified_at already non-null
-- and silently skip sending the real activation push to every other group
-- member. A legitimate draft is never claimed, so require the column to
-- stay NULL through any direct creator-owned draft update.
DROP POLICY IF EXISTS "expenses_update" ON public.expenses;

CREATE POLICY "expenses_update" ON public.expenses
  FOR UPDATE TO authenticated
  USING (
    creator_id = auth.uid()
    AND group_id IN (SELECT public.my_accepted_group_ids())
    AND status = 'draft'
  )
  WITH CHECK (
    creator_id = auth.uid()
    AND status = 'draft'
    AND activation_notified_at IS NULL
  );
