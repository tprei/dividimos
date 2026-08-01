-- Issue #495 Slice 3: composite FK + defense-in-depth for payer reachability.
--
-- Per #495 spec:
--   ALTER TABLE public.expense_payers
--     ADD CONSTRAINT expense_payers_participant_fkey
--     FOREIGN KEY (expense_id, user_id)
--     REFERENCES public.expense_shares (expense_id, user_id)
--     ON DELETE CASCADE
--     DEFERRABLE INITIALLY DEFERRED
--     NOT VALID;
--
--   ALTER TABLE public.expense_payers
--     VALIDATE CONSTRAINT expense_payers_participant_fkey;
--
-- The existing unique constraint expense_shares_expense_id_user_id_key
-- is the referenced key. ON DELETE CASCADE is defense in depth for a
-- registered trusted draft mutation; public graph writers still validate
-- and reject an inconsistent request before DML. The FK is added after
-- confirming zero orphan payers and is validated before commit.

-- Preflight: assert zero orphan payers (a nonzero count means the
-- repair migration must run first).
DO $$
DECLARE
  v_orphans integer;
BEGIN
  SELECT count(*) INTO v_orphans
    FROM public.expense_payers ep
   WHERE NOT EXISTS (
     SELECT 1 FROM public.expense_shares es
      WHERE es.expense_id = ep.expense_id
        AND es.user_id = ep.user_id
   );

  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'Preflight failed: % orphan payer(s) found. Run payer reachability repair first.', v_orphans;
  END IF;
END;
$$;

-- Add the composite FK as NOT VALID first (doesn't scan existing rows),
-- then validate it (scans and asserts all rows satisfy the constraint).
ALTER TABLE public.expense_payers
  ADD CONSTRAINT expense_payers_participant_fkey
  FOREIGN KEY (expense_id, user_id)
  REFERENCES public.expense_shares (expense_id, user_id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED
  NOT VALID;

ALTER TABLE public.expense_payers
  VALIDATE CONSTRAINT expense_payers_participant_fkey;

COMMENT ON CONSTRAINT expense_payers_participant_fkey ON public.expense_payers IS
  'Issue #495: ensures every payer has a matching expense_shares row. '
  'ON DELETE CASCADE removes a payer when its share is deleted. '
  'DEFERRABLE INITIALLY DEFERRED allows save_expense_draft_graph to '
  'delete-and-reinsert children in FK-safe order.';
