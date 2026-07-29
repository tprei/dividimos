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
