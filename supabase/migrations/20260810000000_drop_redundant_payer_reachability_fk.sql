-- Issue #495 cleanup: drop the redundant, never-validated prerequisite FK.
--
-- 20260726210000_payer_reachability_activation_bridge.sql (an earlier
-- #495-prerequisite migration) added expense_payers_share_reachability_fk
-- as NOT VALID and never validated it. 20260807000000's
-- expense_payers_participant_fkey is the exact composite FK #495's own
-- spec names -- same columns, same referenced key, VALIDATEd -- so the
-- older constraint has been dead weight since that migration landed:
-- never enforced for pre-existing rows, structurally redundant with the
-- validated constraint for every new/updated row, and not the one name
-- the spec's catalog contract describes ("Postflight requires... a
-- validated composite FK", singular). Two FKs enforcing the identical
-- rule is exactly the kind of duplicate mechanism #495's "one clean
-- cutover" explicitly rules out ("Do not add an alias... or a second
-- validator at any stage").
ALTER TABLE public.expense_payers
  DROP CONSTRAINT expense_payers_share_reachability_fk;
