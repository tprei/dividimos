-- Guest support for expenses.
--
-- Guests are placeholder participants who don't have a Pagajaja account yet.
-- The expense creator adds them by display name. Each guest gets a unique
-- claim_token (UUID) that can be shared via link/QR code. When a real user
-- "claims" a guest spot, their account replaces the guest in the expense.
--
-- Two new tables:
--   expense_guests       — guest metadata + claim state
--   expense_guest_shares — guest consumption shares (parallel to expense_shares)
--
-- One new RPC:
--   claim_guest_spot(p_claim_token uuid) — links a guest to the calling user

-- ============================================================
-- EXPENSE_GUESTS
-- ============================================================
-- Each row is a named guest placeholder on an expense.
-- claim_token is generated at creation and never changes.
-- claimed_by is NULL until a real user claims the spot.

CREATE TABLE expense_guests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id    uuid        NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  display_name  text        NOT NULL,
  claim_token   uuid        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  claimed_by    uuid        REFERENCES users(id) ON DELETE SET NULL,
  claimed_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_guests_expense_id  ON expense_guests(expense_id);
CREATE INDEX idx_expense_guests_claim_token ON expense_guests(claim_token);
CREATE INDEX idx_expense_guests_claimed_by  ON expense_guests(claimed_by);

-- ============================================================
-- EXPENSE_GUEST_SHARES
-- ============================================================
-- Parallel to expense_shares but references a guest instead of a user.
-- When a guest is claimed, the claim RPC moves this into expense_shares.

CREATE TABLE expense_guest_shares (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id          uuid    NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  guest_id            uuid    NOT NULL REFERENCES expense_guests(id) ON DELETE CASCADE,
  share_amount_cents  integer NOT NULL CHECK (share_amount_cents >= 0),
  UNIQUE(expense_id, guest_id)
);

CREATE INDEX idx_expense_guest_shares_expense_id ON expense_guest_shares(expense_id);
CREATE INDEX idx_expense_guest_shares_guest_id   ON expense_guest_shares(guest_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE expense_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_guest_shares ENABLE ROW LEVEL SECURITY;

-- expense_guests: accepted group members can read; creator can manage
CREATE POLICY expense_guests_select ON expense_guests
  FOR SELECT USING (
    expense_id IN (
      SELECT id FROM expenses WHERE group_id IN (SELECT my_accepted_group_ids())
    )
  );

CREATE POLICY expense_guests_insert ON expense_guests
  FOR INSERT WITH CHECK (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

CREATE POLICY expense_guests_update ON expense_guests
  FOR UPDATE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

CREATE POLICY expense_guests_delete ON expense_guests
  FOR DELETE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- expense_guest_shares: accepted group members can read; creator can manage
CREATE POLICY expense_guest_shares_select ON expense_guest_shares
  FOR SELECT USING (
    expense_id IN (
      SELECT id FROM expenses WHERE group_id IN (SELECT my_accepted_group_ids())
    )
  );

CREATE POLICY expense_guest_shares_insert ON expense_guest_shares
  FOR INSERT WITH CHECK (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

CREATE POLICY expense_guest_shares_update ON expense_guest_shares
  FOR UPDATE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

CREATE POLICY expense_guest_shares_delete ON expense_guest_shares
  FOR DELETE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- ============================================================
-- CLAIM GUEST SPOT RPC
-- ============================================================
-- Called by an authenticated user with a claim_token (from a link/QR).
-- Atomically:
--   1. Validates the token exists and is unclaimed
--   2. Marks the guest as claimed by the calling user
--   3. If expense is active, creates an expense_share from the guest_share
--      and updates balances (same delta logic as activate_expense)
--   4. Adds the user to the expense's group if not already a member

CREATE OR REPLACE FUNCTION claim_guest_spot(p_claim_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest        RECORD;
  v_guest_share  RECORD;
  v_expense      RECORD;
  v_caller_id    uuid;
  v_existing     uuid;
  r_payer        RECORD;
  v_delta        integer;
  v_user_a       uuid;
  v_user_b       uuid;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'auth_required: must be authenticated';
  END IF;

  -- Lock and fetch guest row
  SELECT *
    INTO v_guest
    FROM expense_guests
   WHERE claim_token = p_claim_token
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token: claim token not found';
  END IF;

  IF v_guest.claimed_by IS NOT NULL THEN
    -- If already claimed by this same user, return success idempotently
    IF v_guest.claimed_by = v_caller_id THEN
      RETURN jsonb_build_object(
        'guest_id', v_guest.id,
        'expense_id', v_guest.expense_id,
        'already_claimed', true
      );
    END IF;
    RAISE EXCEPTION 'already_claimed: this guest spot has been claimed by another user';
  END IF;

  -- Check if caller already has a share on this expense (prevent duplicates)
  SELECT id INTO v_existing
    FROM expense_shares
   WHERE expense_id = v_guest.expense_id
     AND user_id = v_caller_id;

  IF FOUND THEN
    RAISE EXCEPTION 'duplicate_participant: you already have a share on this expense';
  END IF;

  -- Fetch expense details
  SELECT *
    INTO v_expense
    FROM expenses
   WHERE id = v_guest.expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense_not_found: associated expense does not exist';
  END IF;

  -- Fetch guest share
  SELECT *
    INTO v_guest_share
    FROM expense_guest_shares
   WHERE guest_id = v_guest.id
     AND expense_id = v_guest.expense_id;

  -- Mark guest as claimed
  UPDATE expense_guests
     SET claimed_by = v_caller_id,
         claimed_at = now()
   WHERE id = v_guest.id;

  -- Add user to group if not already a member
  INSERT INTO group_members (group_id, user_id, status, invited_by, accepted_at)
  VALUES (v_expense.group_id, v_caller_id, 'accepted', v_expense.creator_id, now())
  ON CONFLICT (group_id, user_id) DO NOTHING;

  -- If the guest had a share, create a real expense_share
  IF v_guest_share IS NOT NULL AND v_guest_share.share_amount_cents > 0 THEN
    INSERT INTO expense_shares (expense_id, user_id, share_amount_cents)
    VALUES (v_guest.expense_id, v_caller_id, v_guest_share.share_amount_cents);

    -- If expense is active, update balances for this new participant
    IF v_expense.status = 'active' AND v_expense.total_amount > 0 THEN
      -- For each payer, compute balance delta (same logic as activate_expense)
      FOR r_payer IN
        SELECT user_id, amount_cents
          FROM expense_payers
         WHERE expense_id = v_guest.expense_id
           AND user_id != v_caller_id
      LOOP
        v_delta := ROUND(
          v_guest_share.share_amount_cents::numeric
          * r_payer.amount_cents::numeric
          / v_expense.total_amount
        )::integer;

        IF v_delta != 0 THEN
          -- Canonical ordering
          IF v_caller_id < r_payer.user_id THEN
            v_user_a := v_caller_id;
            v_user_b := r_payer.user_id;
            -- caller (consumer) < payer → positive delta (caller owes payer)
          ELSE
            v_user_a := r_payer.user_id;
            v_user_b := v_caller_id;
            v_delta  := -v_delta;
            -- payer < caller (consumer) → negative delta
          END IF;

          INSERT INTO balances (group_id, user_a, user_b, amount_cents)
          VALUES (v_expense.group_id, v_user_a, v_user_b, v_delta)
          ON CONFLICT (group_id, user_a, user_b)
          DO UPDATE SET
            amount_cents = balances.amount_cents + EXCLUDED.amount_cents,
            updated_at   = now();
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'guest_id', v_guest.id,
    'expense_id', v_guest.expense_id,
    'already_claimed', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION claim_guest_spot(uuid) TO authenticated;

-- ============================================================
-- REALTIME
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE expense_guests;
