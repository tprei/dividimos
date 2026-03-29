-- ============================================================
-- expense_guests table & claim_guest_spot RPC
-- ============================================================
-- Adds support for guest participants in expenses. Guests are
-- placeholders for people who haven't signed up yet. Each guest
-- gets a unique claim_token that can be shared via link/QR code.
-- When a new user claims a guest spot, the RPC atomically:
--   1. Marks the guest as claimed
--   2. Creates an expense_share for the claiming user
--   3. Adds the user to the group (if not already a member)
--   4. If expense is active, computes and applies balance deltas

-- ============================================================
-- TABLE: expense_guests
-- ============================================================

CREATE TABLE expense_guests (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id         uuid        NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  display_name       text        NOT NULL CHECK (length(trim(display_name)) > 0),
  share_amount_cents integer     NOT NULL CHECK (share_amount_cents >= 0),
  claim_token        text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  claimed_by         uuid        REFERENCES users(id) ON DELETE SET NULL,
  claimed_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX expense_guests_expense_id_idx ON expense_guests(expense_id);
CREATE INDEX expense_guests_claim_token_idx ON expense_guests(claim_token);

-- ============================================================
-- RLS POLICIES
-- ============================================================

ALTER TABLE expense_guests ENABLE ROW LEVEL SECURITY;

-- SELECT: accepted group members can read
CREATE POLICY expense_guests_select ON expense_guests
  FOR SELECT USING (
    expense_id IN (
      SELECT id FROM expenses WHERE group_id IN (SELECT my_accepted_group_ids())
    )
  );

-- INSERT: only expense creator can add guests
CREATE POLICY expense_guests_insert ON expense_guests
  FOR INSERT WITH CHECK (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- UPDATE: only expense creator can edit guests
-- (claim_guest_spot RPC runs as SECURITY DEFINER, bypasses RLS)
CREATE POLICY expense_guests_update ON expense_guests
  FOR UPDATE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- DELETE: only expense creator can remove guests
CREATE POLICY expense_guests_delete ON expense_guests
  FOR DELETE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- ============================================================
-- REALTIME
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE expense_guests;

-- ============================================================
-- UPDATE activate_expense: include unclaimed guests in share validation
-- ============================================================
-- When an expense has guest participants, their shares are stored in
-- expense_guests (not expense_shares). The validation must account
-- for both: sum(expense_shares) + sum(unclaimed expense_guests) = total.

CREATE OR REPLACE FUNCTION activate_expense(p_expense_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense    RECORD;
  v_total      integer;
  v_sum_shares integer;
  v_sum_payers integer;
  r_pair       RECORD;
BEGIN
  SELECT *
    INTO v_expense
    FROM expenses
   WHERE id = p_expense_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense_not_found: %', p_expense_id;
  END IF;

  IF v_expense.creator_id != auth.uid() THEN
    RAISE EXCEPTION 'permission_denied: only the creator can activate';
  END IF;

  IF v_expense.group_id NOT IN (SELECT my_group_ids()) THEN
    RAISE EXCEPTION 'permission_denied: not a group member';
  END IF;

  IF v_expense.status != 'draft' THEN
    RAISE EXCEPTION 'invalid_status: expense is %, expected draft', v_expense.status;
  END IF;

  v_total := v_expense.total_amount;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: total_amount must be positive';
  END IF;

  -- Validate shares: registered participants + unclaimed guests = total
  SELECT COALESCE(SUM(share_amount_cents), 0)
    INTO v_sum_shares
    FROM (
      SELECT share_amount_cents FROM expense_shares WHERE expense_id = p_expense_id
      UNION ALL
      SELECT share_amount_cents FROM expense_guests
       WHERE expense_id = p_expense_id AND claimed_by IS NULL
    ) all_shares;

  IF v_sum_shares != v_total THEN
    RAISE EXCEPTION 'shares_mismatch: shares sum to %, expected %', v_sum_shares, v_total;
  END IF;

  -- Validate payers exist and sum correctly
  SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_sum_payers
    FROM expense_payers
   WHERE expense_id = p_expense_id;

  IF v_sum_payers != v_total THEN
    RAISE EXCEPTION 'payers_mismatch: payers sum to %, expected %', v_sum_payers, v_total;
  END IF;

  -- Compute balance deltas only for registered participants.
  -- Guest shares are deferred until they claim their spot.
  FOR r_pair IN
    SELECT
      LEAST(s.user_id, p.user_id)    AS user_a,
      GREATEST(s.user_id, p.user_id) AS user_b,
      SUM(
        CASE
          WHEN s.user_id < p.user_id
            THEN  ROUND(s.share_amount_cents::numeric * p.amount_cents::numeric / v_total)::integer
          WHEN s.user_id > p.user_id
            THEN -ROUND(s.share_amount_cents::numeric * p.amount_cents::numeric / v_total)::integer
        END
      ) AS delta
    FROM expense_shares s
    CROSS JOIN expense_payers p
    WHERE s.expense_id = p_expense_id
      AND p.expense_id = p_expense_id
      AND s.user_id != p.user_id
    GROUP BY LEAST(s.user_id, p.user_id), GREATEST(s.user_id, p.user_id)
    HAVING SUM(
      CASE
        WHEN s.user_id < p.user_id
          THEN  ROUND(s.share_amount_cents::numeric * p.amount_cents::numeric / v_total)::integer
        WHEN s.user_id > p.user_id
          THEN -ROUND(s.share_amount_cents::numeric * p.amount_cents::numeric / v_total)::integer
      END
    ) != 0
  LOOP
    INSERT INTO balances (group_id, user_a, user_b, amount_cents)
    VALUES (v_expense.group_id, r_pair.user_a, r_pair.user_b, r_pair.delta)
    ON CONFLICT (group_id, user_a, user_b)
    DO UPDATE SET
      amount_cents = balances.amount_cents + EXCLUDED.amount_cents,
      updated_at   = now();
  END LOOP;

  UPDATE expenses
     SET status = 'active'
   WHERE id = p_expense_id;
END;
$$;

-- ============================================================
-- RPC: claim_guest_spot(p_claim_token text)
-- ============================================================
-- Called by an authenticated user to claim a guest spot.
-- Returns a JSON object with guest_id, expense_id, group_id.
--
-- If the expense is already active, atomically computes and
-- applies balance deltas using the same math as activate_expense.

CREATE OR REPLACE FUNCTION claim_guest_spot(p_claim_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_guest   RECORD;
  v_expense RECORD;
  v_total   numeric;
  r_payer   RECORD;
  v_user_a  uuid;
  v_user_b  uuid;
  v_delta   integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: must be authenticated';
  END IF;

  -- Lock guest row to prevent concurrent claims
  SELECT * INTO v_guest
    FROM expense_guests
   WHERE claim_token = p_claim_token
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_TOKEN: guest spot not found';
  END IF;

  IF v_guest.claimed_by IS NOT NULL THEN
    -- Idempotent: if same user reclaims, return success
    IF v_guest.claimed_by = v_caller THEN
      SELECT * INTO v_expense FROM expenses WHERE id = v_guest.expense_id;
      RETURN jsonb_build_object(
        'guest_id', v_guest.id,
        'expense_id', v_guest.expense_id,
        'group_id', v_expense.group_id,
        'share_amount_cents', v_guest.share_amount_cents,
        'already_claimed', true
      );
    END IF;
    RAISE EXCEPTION 'ALREADY_CLAIMED: this spot has already been claimed';
  END IF;

  -- Verify caller is not already a participant in this expense
  IF EXISTS (
    SELECT 1 FROM expense_shares
     WHERE expense_id = v_guest.expense_id AND user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'ALREADY_PARTICIPANT: you are already a participant in this expense';
  END IF;

  -- Get expense details
  SELECT * INTO v_expense
    FROM expenses
   WHERE id = v_guest.expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXPENSE_NOT_FOUND: associated expense no longer exists';
  END IF;

  -- Mark guest as claimed
  UPDATE expense_guests
     SET claimed_by = v_caller,
         claimed_at = now()
   WHERE id = v_guest.id;

  -- Create expense share for the claiming user
  INSERT INTO expense_shares (expense_id, user_id, share_amount_cents)
  VALUES (v_guest.expense_id, v_caller, v_guest.share_amount_cents);

  -- Add user to the group as accepted member (idempotent)
  INSERT INTO group_members (group_id, user_id, status, invited_by, accepted_at)
  VALUES (v_expense.group_id, v_caller, 'accepted', v_expense.creator_id, now())
  ON CONFLICT (group_id, user_id) DO UPDATE
    SET status = 'accepted', accepted_at = COALESCE(group_members.accepted_at, now())
    WHERE group_members.status = 'invited';

  -- If expense is active, compute and apply balance deltas
  IF v_expense.status = 'active' THEN
    v_total := v_expense.total_amount;

    FOR r_payer IN
      SELECT user_id, amount_cents
        FROM expense_payers
       WHERE expense_id = v_guest.expense_id
    LOOP
      -- Skip self-pay (guest is also a payer)
      IF v_caller = r_payer.user_id THEN
        CONTINUE;
      END IF;

      -- Canonical ordering: user_a < user_b
      IF v_caller < r_payer.user_id THEN
        v_user_a := v_caller;
        v_user_b := r_payer.user_id;
        v_delta := ROUND(v_guest.share_amount_cents::numeric * r_payer.amount_cents / v_total)::integer;
      ELSE
        v_user_a := r_payer.user_id;
        v_user_b := v_caller;
        v_delta := -ROUND(v_guest.share_amount_cents::numeric * r_payer.amount_cents / v_total)::integer;
      END IF;

      IF v_delta != 0 THEN
        INSERT INTO balances (group_id, user_a, user_b, amount_cents)
        VALUES (v_expense.group_id, v_user_a, v_user_b, v_delta)
        ON CONFLICT (group_id, user_a, user_b)
        DO UPDATE SET
          amount_cents = balances.amount_cents + EXCLUDED.amount_cents,
          updated_at   = now();
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'guest_id', v_guest.id,
    'expense_id', v_guest.expense_id,
    'group_id', v_expense.group_id,
    'share_amount_cents', v_guest.share_amount_cents,
    'already_claimed', false
  );
END;
$$;

-- ============================================================
-- GRANTS
-- ============================================================

GRANT EXECUTE ON FUNCTION claim_guest_spot(text) TO authenticated;
