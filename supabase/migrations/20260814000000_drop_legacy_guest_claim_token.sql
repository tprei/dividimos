-- Issue #581 (final): drop the legacy plaintext expense_guests.claim_token
-- bearer and lock direct guest-table DML to the trusted RPCs.
--
-- The opaque credential is fully live: issue_guest_claim_token /
-- resolve_guest_claim_token / claim_guest_spot(text) are the sole guest-claim
-- paths, and the credential digest lives in the non-exposed guest_credentials
-- schema. The uuid column, its default, unique constraint, and index -- and
-- the uuid claim_guest_spot overload, already dropped in 20260813000000 -- are
-- now dead surface area. Dropping the column also removes it from the
-- supabase_realtime payload for expense_guests without touching the
-- publication.

DROP INDEX IF EXISTS public.idx_expense_guests_claim_token;
ALTER TABLE public.expense_guests
  DROP CONSTRAINT IF EXISTS expense_guests_claim_token_key;
ALTER TABLE public.expense_guests
  DROP COLUMN claim_token;

-- Guest-table writes go only through save_expense_draft_graph (guest insert)
-- and claim_guest_spot (claim transition). Revoke direct DML from every API
-- role so no client can bypass the claim-state monotonicity trigger or insert
-- a caller-chosen credential.
REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.expense_guests, public.expense_guest_shares
  FROM PUBLIC, anon, authenticated, service_role;
