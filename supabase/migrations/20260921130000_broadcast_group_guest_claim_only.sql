-- Room invalidation ownership splits by cause. The assignment-room expense
-- trigger (20260921120200) owns every mutation that rewrites the expense row
-- (edits, deletes, restores): it bumps the finalized room and broadcasts
-- before broadcast_group runs, so joining rooms on those events here
-- double-invalidated every linked bill edit. A guest claim is the one event
-- kind that changes a finalized room's bill without touching the expenses
-- row: effective_expense_payload swaps the claimed guest for the claiming
-- user once guests.claimed_version_no matches the current version, so the
-- guest_claimed group event remains the only in-transaction signal that the
-- room's bill changed. Restrict the room join to guest_claimed; every other
-- ledger event keeps its single group broadcast and no longer touches rooms.
CREATE OR REPLACE FUNCTION public.broadcast_group(
  p_group_id uuid,
  p_ledger_version bigint,
  p_event_id bigint
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_id uuid;
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'group_id', p_group_id,
      'ledger_version', p_ledger_version,
      'event_id', p_event_id
    ),
    'ledger',
    'group:' || p_group_id::text,
    true
  );

  SELECT r.id INTO v_room_id
  FROM public.group_events e
  JOIN public.assignment_rooms r
    ON r.expense_id = e.expense_id
   AND r.status = 'finalized'
  WHERE e.id = p_event_id
    AND e.group_id = p_group_id
    AND e.kind = 'guest_claimed'
  FOR UPDATE OF r;

  IF v_room_id IS NOT NULL THEN
    UPDATE public.assignment_rooms
    SET revision = revision + 1
    WHERE id = v_room_id;
    PERFORM public.broadcast_assignment_room(v_room_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_group(uuid, bigint, bigint)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.broadcast_group(uuid, bigint, bigint)
  TO service_role;
