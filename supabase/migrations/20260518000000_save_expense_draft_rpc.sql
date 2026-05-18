-- Wrap the expense draft save in a single SECURITY DEFINER transaction.
--
-- The prior client-side approach issued 7 separate PostgREST round-trips
-- (1 UPSERT + 5 DELETEs + N INSERTs) with no atomicity guarantees. A
-- concurrent activate_expense call that ran between the DELETE and INSERT
-- phases could activate an expense with zero child rows, leaving it
-- permanently stuck in an inconsistent state.
--
-- This RPC:
--   1. Acquires a FOR UPDATE lock on the parent expenses row.
--   2. Validates caller identity and expense status.
--   3. Performs all child-table delete-and-reinsert inside one transaction.
--
-- Guest shares must be deleted before guests due to the FK constraint.

CREATE OR REPLACE FUNCTION public.save_expense_draft(
  p_expense      jsonb,
  p_items        jsonb,
  p_shares       jsonb,
  p_payers       jsonb,
  p_guests       jsonb,
  p_guest_shares jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_expense_id uuid;
  v_existing   public.expenses%ROWTYPE;
  v_item       jsonb;
  v_share      jsonb;
  v_payer      jsonb;
  v_guest      jsonb;
  v_gs         jsonb;
  v_guest_id   uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth_required: must be authenticated';
  END IF;

  v_expense_id := (p_expense->>'id')::uuid;

  IF v_expense_id IS NULL THEN
    -- Verify caller is an accepted member of the target group.
    -- SECURITY DEFINER bypasses RLS, so this check replaces the
    -- expenses_insert policy that previously guarded group membership.
    IF NOT EXISTS (
      SELECT 1 FROM public.group_members
       WHERE group_id = (p_expense->>'group_id')::uuid
         AND user_id = v_caller
         AND status = 'accepted'
    ) THEN
      RAISE EXCEPTION 'permission_denied: not a member of group %',
        (p_expense->>'group_id')::uuid;
    END IF;

    -- New draft: insert and return the generated id.
    INSERT INTO public.expenses (
      group_id,
      creator_id,
      title,
      merchant_name,
      expense_type,
      total_amount,
      service_fee_percent,
      fixed_fees,
      status
    ) VALUES (
      (p_expense->>'group_id')::uuid,
      v_caller,
      p_expense->>'title',
      NULLIF(p_expense->>'merchant_name', ''),
      (p_expense->>'expense_type')::public.expense_type,
      (p_expense->>'total_amount')::integer,
      (p_expense->>'service_fee_percent')::numeric,
      (p_expense->>'fixed_fees')::integer,
      'draft'
    )
    RETURNING id INTO v_expense_id;
  ELSE
    -- Existing expense: lock the row first so a concurrent activate_expense
    -- must wait until this transaction completes.
    SELECT * INTO v_existing
      FROM public.expenses
     WHERE id = v_expense_id
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'expense_not_found: %', v_expense_id;
    END IF;

    IF v_existing.creator_id != v_caller THEN
      RAISE EXCEPTION 'permission_denied: only the creator can edit this expense';
    END IF;

    IF v_existing.status != 'draft' THEN
      RAISE EXCEPTION 'invalid_status: expense is %, expected draft', v_existing.status;
    END IF;

    UPDATE public.expenses
       SET title               = p_expense->>'title',
           merchant_name       = NULLIF(p_expense->>'merchant_name', ''),
           expense_type        = (p_expense->>'expense_type')::public.expense_type,
           total_amount        = (p_expense->>'total_amount')::integer,
           service_fee_percent = (p_expense->>'service_fee_percent')::numeric,
           fixed_fees          = (p_expense->>'fixed_fees')::integer,
           updated_at          = now()
     WHERE id = v_expense_id;
  END IF;

  -- ----------------------------------------------------------------
  -- Replace child rows atomically.
  -- guest_shares must go first (FK: expense_guest_shares → expense_guests).
  -- ----------------------------------------------------------------
  DELETE FROM public.expense_guest_shares WHERE expense_id = v_expense_id;
  DELETE FROM public.expense_items       WHERE expense_id = v_expense_id;
  DELETE FROM public.expense_shares      WHERE expense_id = v_expense_id;
  DELETE FROM public.expense_payers      WHERE expense_id = v_expense_id;
  DELETE FROM public.expense_guests      WHERE expense_id = v_expense_id;

  -- Insert items
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.expense_items (
        expense_id, description, quantity, unit_price_cents, total_price_cents
      ) VALUES (
        v_expense_id,
        v_item->>'description',
        (v_item->>'quantity')::integer,
        (v_item->>'unit_price_cents')::integer,
        (v_item->>'total_price_cents')::integer
      );
    END LOOP;
  END IF;

  -- Insert shares
  IF p_shares IS NOT NULL AND jsonb_array_length(p_shares) > 0 THEN
    FOR v_share IN SELECT * FROM jsonb_array_elements(p_shares)
    LOOP
      INSERT INTO public.expense_shares (
        expense_id, user_id, share_amount_cents
      ) VALUES (
        v_expense_id,
        (v_share->>'user_id')::uuid,
        (v_share->>'share_amount_cents')::integer
      );
    END LOOP;
  END IF;

  -- Insert payers
  IF p_payers IS NOT NULL AND jsonb_array_length(p_payers) > 0 THEN
    FOR v_payer IN SELECT * FROM jsonb_array_elements(p_payers)
    LOOP
      INSERT INTO public.expense_payers (
        expense_id, user_id, amount_cents
      ) VALUES (
        v_expense_id,
        (v_payer->>'user_id')::uuid,
        (v_payer->>'amount_cents')::integer
      );
    END LOOP;
  END IF;

  -- Insert guests and their shares in two passes (FK dependency).
  IF p_guests IS NOT NULL AND jsonb_array_length(p_guests) > 0 THEN
    -- Reject duplicate local_id values within either array.
    IF EXISTS (
      SELECT g->>'local_id'
        FROM jsonb_array_elements(p_guests) g
       GROUP BY g->>'local_id'
      HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION 'invalid_input: duplicate local_id in guests';
    END IF;

    IF p_guest_shares IS NOT NULL AND jsonb_array_length(p_guest_shares) > 0 THEN
      IF EXISTS (
        SELECT gs->>'local_id'
          FROM jsonb_array_elements(p_guest_shares) gs
         GROUP BY gs->>'local_id'
        HAVING COUNT(*) > 1
      ) THEN
        RAISE EXCEPTION 'invalid_input: duplicate local_id in guest_shares';
      END IF;
    END IF;

    FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests)
    LOOP
      INSERT INTO public.expense_guests (
        expense_id, display_name
      ) VALUES (
        v_expense_id,
        v_guest->>'display_name'
      )
      RETURNING id INTO v_guest_id;

      -- Find the matching guest share by local_id (client-side correlation key).
      IF p_guest_shares IS NOT NULL AND jsonb_array_length(p_guest_shares) > 0 THEN
        SELECT gs INTO v_gs
          FROM jsonb_array_elements(p_guest_shares) gs
         WHERE gs->>'local_id' = v_guest->>'local_id'
         LIMIT 1;

        IF v_gs IS NOT NULL THEN
          INSERT INTO public.expense_guest_shares (
            expense_id, guest_id, share_amount_cents
          ) VALUES (
            v_expense_id,
            v_guest_id,
            (v_gs->>'share_amount_cents')::integer
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('id', v_expense_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_expense_draft(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated;
