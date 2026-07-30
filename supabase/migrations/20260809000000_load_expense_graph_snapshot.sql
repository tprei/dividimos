-- Issue #477: load_expense_graph_snapshot(p_expense_id uuid) — the fourth and
-- final core RPC signature named by the spec ("Final signatures are
-- save_expense_draft_graph, resolve_expense_graph_save_result,
-- activate_saved_expense, and load_expense_graph_snapshot"). Its client-side
-- decoder (decodeExpenseGraphSnapshot in src/lib/expense-money.ts) already
-- exists and is fully unit-tested; this migration is the missing server half.
--
-- Authenticated-only, SECURITY DEFINER, non-leaking: not-found and
-- no-access both return NULL (no existence disclosure). Follows the same
-- group->expense lock order and my_accepted_group_ids() authority predicate
-- every other expense-graph RPC/RLS policy already uses (creator OR accepted
-- member; pair-aware for DM groups via dm_pairs). A detected DM shape
-- corruption fails closed with PST07 rather than returning a graph, matching
-- #472's assert_dm_group_shape contract used everywhere else.
--
-- Draft vs persisted participant map (#468):
--   - draft: expense_allocation_entities is guaranteed empty (the guard's
--     validate_graph_mode rejects any row there for a draft-status expense),
--     so there is no persisted map to read. The loader instead computes the
--     same deterministic preview order activate_expense itself computes at
--     activation time (share users by user_id, then payer-only users by
--     user_id, then unclaimed guests by id) - never persisted, purely a
--     read-time projection.
--   - draft guests: claim_guest_spot already supports claiming a guest spot
--     before activation ("case 1") - it deletes the guest's
--     expense_guest_shares row and folds the claimant into expense_shares,
--     leaving expense_guests.claimed_by set as a pure audit trail. Per the
--     decoder contract ("draft guests must be unclaimed - case 1 is
--     hidden"), the draft `guests` wire array includes only currently-
--     unclaimed guests; every already-claimed guest is hidden entirely, and
--     its claimant's user id is surfaced instead via
--     draft_claim_protected_user_ids (so the draft-session layer can protect
--     that identity from removal even though its guest origin is no longer
--     visible).
--   - active/settled: participant_order and guests are read directly from
--     the immutable, activation-time expense_allocation_entities snapshot in
--     participant_index order. draft_claim_protected_user_ids is always []
--     (post-activation claims are visible directly on the guest row instead;
--     the client's projectClaimAwareParticipantOrder does the claim-aware
--     projection from the raw persisted order + guest claim fields).

CREATE OR REPLACE FUNCTION public.load_expense_graph_snapshot(p_expense_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller             uuid := auth.uid();
  v_group_id           uuid;
  v_expense            public.expenses%ROWTYPE;
  v_items              jsonb;
  v_item_ids           jsonb;
  v_participant_order  jsonb;
  v_shares             jsonb;
  v_guest_shares       jsonb;
  v_payers             jsonb;
  v_guests             jsonb;
  v_protected          jsonb;
  v_maintenance         boolean;
BEGIN
  -- #477/#495: "Run #477's financial compatibility guard as the first
  -- body action and require authentication." This covers the
  -- read/review/detail surface too, not only writes.
  SELECT maintenance INTO v_maintenance
    FROM financial_internal.financial_compatibility_state
   WHERE id = true;

  IF v_maintenance THEN
    RAISE EXCEPTION USING ERRCODE = 'PST09', MESSAGE = 'financial_maintenance';
  END IF;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST01', MESSAGE = 'not_authenticated';
  END IF;

  -- Non-locking discovery of the candidate group (mirrors #471's bounded
  -- discovery pattern in save_expense_draft_graph). Not-found is
  -- non-disclosing: no distinction from "exists but no access" below.
  SELECT e.group_id INTO v_group_id FROM public.expenses e WHERE e.id = p_expense_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Group-first lock order, FOR SHARE (a pure read never needs to exclude
  -- other concurrent readers, only to wait out an in-flight FOR UPDATE
  -- writer so every subsequent read in this transaction sees a fully
  -- committed, consistent graph).
  PERFORM 1 FROM public.groups WHERE id = v_group_id FOR SHARE;

  -- #472 defense in depth: the constraint triggers installed by
  -- 20260729100000 already prevent a corrupt DM shape from persisting, but
  -- a loader that trusted an unchecked is_dm/dm_pairs read anyway would be
  -- the one place that silently serves a corrupt graph instead of failing
  -- closed like every other DM-authority caller.
  PERFORM public.assert_dm_group_shape(v_group_id, false);

  -- Current read authority: creator or accepted member, pair-aware for DM
  -- (matches expenses_select and every child table's identical RLS predicate
  -- exactly - this loader is not a new authority model).
  IF v_group_id NOT IN (SELECT public.my_accepted_group_ids()) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- expense_items.quantity is stored as branded ExpenseQuantity milliunits
  -- (the same convention the wizard/manual-entry path already writes); the
  -- wire contract decodeExpenseGraphSnapshot -> #578's parseExpenseQuantity
  -- expects a plain decimal ("1", "1.5", "0.001"), not raw milliunits, so
  -- this loader is the one place responsible for converting back. Integer
  -- milliunits divided by 1000 in `numeric` is always an exact, terminating
  -- decimal (milliunits in [1, 999999999]), so this never loses precision.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', i.id,
           'description', i.description,
           'quantity', (i.quantity::numeric / 1000),
           'unit_price_cents', i.unit_price_cents,
           'total_price_cents', i.total_price_cents
         ) ORDER BY i.created_at, i.id), '[]'::jsonb)
    INTO v_items
    FROM public.expense_items i
   WHERE i.expense_id = p_expense_id;

  SELECT COALESCE(jsonb_agg(i.id ORDER BY i.created_at, i.id), '[]'::jsonb)
    INTO v_item_ids
    FROM public.expense_items i
   WHERE i.expense_id = p_expense_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id', s.user_id,
           'share_amount_cents', s.share_amount_cents
         )), '[]'::jsonb)
    INTO v_shares
    FROM public.expense_shares s
   WHERE s.expense_id = p_expense_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'guest_local_id', gs.guest_id::text,
           'share_amount_cents', gs.share_amount_cents
         )), '[]'::jsonb)
    INTO v_guest_shares
    FROM public.expense_guest_shares gs
   WHERE gs.expense_id = p_expense_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id', p.user_id,
           'amount_cents', p.amount_cents
         )), '[]'::jsonb)
    INTO v_payers
    FROM public.expense_payers p
   WHERE p.expense_id = p_expense_id;

  IF v_expense.status = 'draft' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'local_id', g.id::text,
             'display_name', g.display_name,
             'original_share_amount_cents', COALESCE(gs.share_amount_cents, 0),
             'claimed_by_user_id', NULL,
             'claimed_at', NULL
           )), '[]'::jsonb)
      INTO v_guests
      FROM public.expense_guests g
      LEFT JOIN public.expense_guest_shares gs
        ON gs.guest_id = g.id AND gs.expense_id = g.expense_id
     WHERE g.expense_id = p_expense_id
       AND g.claimed_by IS NULL;

    SELECT COALESCE(jsonb_agg(DISTINCT g.claimed_by), '[]'::jsonb)
      INTO v_protected
      FROM public.expense_guests g
     WHERE g.expense_id = p_expense_id
       AND g.claimed_by IS NOT NULL;

    WITH ranked AS (
      SELECT 'user'::text AS kind, s.user_id AS uid, NULL::uuid AS gid,
             1 AS sort_group, s.user_id AS sort_key
        FROM public.expense_shares s
       WHERE s.expense_id = p_expense_id
      UNION ALL
      SELECT 'user'::text, p.user_id, NULL::uuid, 2, p.user_id
        FROM public.expense_payers p
       WHERE p.expense_id = p_expense_id
         AND NOT EXISTS (
           SELECT 1 FROM public.expense_shares s
            WHERE s.expense_id = p_expense_id AND s.user_id = p.user_id
         )
      UNION ALL
      SELECT 'guest'::text, NULL::uuid, g.id, 3, g.id
        FROM public.expense_guests g
       WHERE g.expense_id = p_expense_id
         AND g.claimed_by IS NULL
    )
    SELECT COALESCE(jsonb_agg(
             CASE WHEN kind = 'user'
                    THEN jsonb_build_object('kind', 'user', 'user_id', uid)
                  ELSE jsonb_build_object('kind', 'guest', 'guest_local_id', gid::text)
             END
             ORDER BY sort_group, sort_key
           ), '[]'::jsonb)
      INTO v_participant_order
      FROM ranked;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'local_id', g.id::text,
             'display_name', g.display_name,
             'original_share_amount_cents', e.share_amount_cents,
             'claimed_by_user_id', g.claimed_by,
             'claimed_at', g.claimed_at
           ) ORDER BY e.participant_index), '[]'::jsonb)
      INTO v_guests
      FROM public.expense_allocation_entities e
      JOIN public.expense_guests g ON g.id = e.guest_id
     WHERE e.expense_id = p_expense_id
       AND e.entity_kind = 'guest';

    v_protected := '[]'::jsonb;

    SELECT COALESCE(jsonb_agg(
             CASE WHEN e.entity_kind = 'user'
                    THEN jsonb_build_object('kind', 'user', 'user_id', e.user_id)
                  ELSE jsonb_build_object('kind', 'guest', 'guest_local_id', e.guest_id::text)
             END
             ORDER BY e.participant_index
           ), '[]'::jsonb)
      INTO v_participant_order
      FROM public.expense_allocation_entities e
     WHERE e.expense_id = p_expense_id;
  END IF;

  RETURN jsonb_build_object(
    'expense_id', v_expense.id,
    'group_id', v_expense.group_id,
    'graph_revision', v_expense.graph_revision,
    'title', v_expense.title,
    'merchant_name', v_expense.merchant_name,
    'expense_type', v_expense.expense_type,
    'total_amount', v_expense.total_amount,
    'service_fee_basis_points', v_expense.service_fee_basis_points,
    'fixed_fees', v_expense.fixed_fees,
    'items', v_items,
    'item_ids', v_item_ids,
    'draft_claim_protected_user_ids', v_protected,
    'status', v_expense.status,
    'participant_order', v_participant_order,
    'shares', v_shares,
    'guest_shares', v_guest_shares,
    'payers', v_payers,
    'guests', v_guests
  );
END;
$$;

REVOKE ALL ON FUNCTION public.load_expense_graph_snapshot(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.load_expense_graph_snapshot(uuid) TO authenticated;

COMMENT ON FUNCTION public.load_expense_graph_snapshot(uuid) IS
  'Issue #477: authenticated, non-leaking loader for the complete expense '
  'graph (parent + items + shares + payers + guest shares + guests + '
  'participant_order + graph_revision), matching decodeExpenseGraphSnapshot''s '
  'exact wire contract. Draft snapshots compute a non-persisted preview '
  'participant order; active/settled snapshots read the immutable '
  '#468 activation-time map.';
