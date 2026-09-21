-- Assignment-room guest claim bridge.
--
-- Finalizing a room creates one ledger expense whose version-1 payload stores
-- every active attendee's original identity under the same index that
-- `finalize_assignment_room` persisted on
-- `assignment_room_participants.expense_participant_index`. An anonymous
-- attendee holds only a room member bearer (`armm1_…`), which no existing
-- endpoint could trade for the ledger guest share it represents: the shared
-- `gst1_…` claim tokens are minted per guest by members, and
-- `create_guest_claim_token` requires accepted membership the room guest does
-- not have. This migration adds that bridge without changing guest-link
-- behavior:
--
--   public.claim_guest_participant(uuid)
--       Internal-only financial transition extracted verbatim from the former
--       `public.claim_guest` body: locks group then guest/expense, rechecks
--       every existing domain denial, writes guest ownership and accepted
--       membership, latches shared history, recomputes balances, emits the
--       `guest_claimed` event and broadcasts the group. Granted to nobody.
--   public.claim_guest(text)
--       Same shipped signature, error codes and result; the body is now token
--       identification, the group/guest/expense lock, the claim-token
--       credential lock and its `clock_timestamp()` expiry validation,
--       followed by the shared transition while the credential row lock is
--       still held.
--   public.claim_assignment_room_guest(uuid, text)
--       Authenticated-only bridge returning the existing `MutationAck` shape.
--       One unlocked identification read discovers the group; then it locks
--       group -> room -> participant -> room member credential and rechecks
--       the exact token digest, room binding, expiry, revocation, active
--       participant, finalized status, stored participant index, version-1
--       guest ref and `user_id IS NULL` before delegating to the shared
--       transition.
--
-- The bridge leaves the room participant identity unchanged. After the shared
-- financial transition succeeds, it advances the room revision and broadcasts
-- the assignment topic so connected room clients refresh their bill state.
--
-- Stable denial codes: `unauthenticated`; `invalid_token` (missing/malformed
-- token, wrong room, expired or revoked credential, removed participant,
-- orphaned guest slot, unmappable stored index, missing guest row);
-- `room_incomplete` (room not finalized); `invalid_operation` (bearer of a
-- non-guest room identity such as an account attendee or the host);
-- `already_claimed`; `expense_deleted`; `already_participant`;
-- `member_excluded`; the DM pair guard in `assert_dm_pair_allowed` is
-- unchanged. On any denial the transaction leaves guest, membership,
-- balances and credentials unchanged.

CREATE FUNCTION public.claim_guest_participant(p_guest_id uuid)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_group_id uuid;
  v_rec RECORD;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := public.current_user_id();

  IF p_guest_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  -- Identify the guest's group unlocked so the group lock is always taken
  -- before the guest/expense row locks, exactly as the former claim_guest
  -- body ordered them. Both callers already hold this lock; re-acquiring it
  -- in the same transaction is a no-op and keeps this helper safe for any
  -- future internal caller that arrives without it.
  SELECT e.group_id
  INTO v_group_id
  FROM public.guests g
  JOIN public.expenses e ON e.id = g.expense_id
  WHERE g.id = p_guest_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  PERFORM public.lock_group(v_group_id);

  SELECT g.id, g.expense_id, g.display_name, g.claimed_by, e.group_id, e.status AS expense_status, e.current_version_no
  INTO v_rec
  FROM public.guests g
  JOIN public.expenses e ON e.id = g.expense_id
  WHERE g.id = p_guest_id
  FOR UPDATE OF g, e;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF v_rec.claimed_by IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_claimed';
  END IF;

  IF v_rec.expense_status = 'deleted' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
  END IF;

  -- A guest dropped by a later edit keeps its row but no participant slot;
  -- redeeming that orphaned token would hand group membership to a stranger.
  IF NOT EXISTS (
    SELECT 1 FROM public.current_expense_participants
    WHERE expense_id = v_rec.expense_id AND guest_id = v_rec.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.current_expense_participants
    WHERE expense_id = v_rec.expense_id AND user_id = v_actor AND kind = 'user'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_participant';
  END IF;

  PERFORM public.assert_dm_pair_allowed(v_rec.group_id, v_actor);

  IF EXISTS (
    SELECT 1 FROM public.group_member_exclusions
    WHERE group_id = v_rec.group_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  UPDATE public.guests
  SET claimed_by = v_actor,
      claimed_at = now(),
      claimed_version_no = v_rec.current_version_no
  WHERE id = v_rec.id;

  INSERT INTO public.group_members (group_id, user_id, status, accepted_at)
  VALUES (v_rec.group_id, v_actor, 'accepted', now())
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET status = 'accepted', accepted_at = COALESCE(public.group_members.accepted_at, now());

  -- Shared-history latch: the claim just granted membership for an existing
  -- expense to a new user, so the expense's facts are shared from now on.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = v_rec.group_id AND financial_history_shared_at IS NULL;

  v_ledger_version := public.recompute_group_balances(v_rec.group_id);

  v_event_id := public.emit_event(
    p_group_id => v_rec.group_id,
    p_kind => 'guest_claimed',
    p_actor => v_actor,
    p_expense_id => v_rec.expense_id,
    p_settlement_id => NULL,
    p_subject_user_id => v_actor,
    p_payload => jsonb_build_object('displayName', v_rec.display_name)
  );

  PERFORM public.broadcast_group(v_rec.group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', v_rec.expense_id,
    'groupId', v_rec.group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_guest_participant(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_guest(p_token text)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_digest bytea;
  v_group_id uuid;
  v_guest_id uuid;
  v_rec RECORD;
  v_cred RECORD;
BEGIN
  -- Kept ahead of token validation so an anonymous caller keeps receiving
  -- `unauthenticated` exactly as before; the shared transition re-derives the
  -- actor under its own locks.
  v_actor := public.current_user_id();

  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  v_digest := extensions.digest(convert_to(p_token, 'UTF8'), 'sha256');

  SELECT ct.guest_id, e.group_id
  INTO v_guest_id, v_group_id
  FROM guest_credentials.claim_tokens ct
  JOIN public.guests g ON g.id = ct.guest_id
  JOIN public.expenses e ON e.id = g.expense_id
  WHERE ct.token_digest = v_digest;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  PERFORM public.lock_group(v_group_id);

  SELECT g.id, g.expense_id, g.display_name, g.claimed_by, e.group_id, e.status AS expense_status, e.current_version_no
  INTO v_rec
  FROM public.guests g
  JOIN public.expenses e ON e.id = g.expense_id
  WHERE g.id = v_guest_id
  FOR UPDATE OF g, e;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT ct.guest_id, ct.expires_at
  INTO v_cred
  FROM guest_credentials.claim_tokens ct
  WHERE ct.guest_id = v_rec.id AND ct.token_digest = v_digest
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF v_cred.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  -- The claim-token credential row lock stays held through the shared
  -- transition; the guest/expense row locks are already held, so no other
  -- claim path can interleave.
  RETURN public.claim_guest_participant(v_rec.id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_guest(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest(text)
  TO authenticated;

CREATE FUNCTION public.claim_assignment_room_guest(
  p_room_id uuid,
  p_member_token text
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_status text;
  v_expense_id uuid;
  v_group_id uuid;
  v_room public.assignment_rooms%ROWTYPE;
  v_participant public.assignment_room_participants%ROWTYPE;
  v_participant_id uuid;
  v_member guest_credentials.assignment_room_members%ROWTYPE;
  v_member_digest bytea;
  v_ref jsonb;
  v_guest_id uuid;
  v_ack jsonb;
BEGIN
  v_actor := public.current_user_id();

  IF p_room_id IS NULL
     OR p_member_token IS NULL
     OR p_member_token !~ '^armm1_[A-Za-z0-9_-]{43}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  v_member_digest := extensions.digest(convert_to(p_member_token, 'UTF8'), 'sha256');

  -- Unlocked identification only: locate the group whose bill this room
  -- produced. Every predicate below is rechecked under locks.
  SELECT r.status, r.expense_id
  INTO v_status, v_expense_id
  FROM public.assignment_rooms r
  WHERE r.id = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  -- Only a finalized room carries a ledger expense to claim into; open,
  -- closed and cancelled rooms have nothing to link.
  IF v_status <> 'finalized' OR v_expense_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_incomplete';
  END IF;

  SELECT e.group_id
  INTO v_group_id
  FROM public.expenses e
  WHERE e.id = v_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_incomplete';
  END IF;

  PERFORM public.lock_group(v_group_id);

  SELECT * INTO v_room
  FROM public.assignment_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;
  IF v_room.status <> 'finalized' OR v_room.expense_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_incomplete';
  END IF;

  -- The token digest is unique across rooms, so a miss also covers a token
  -- that belongs to a different room. The row mapping is re-read under lock
  -- below: rotating a member token rewrites the digest on the same
  -- (room_id, participant_id) row, never moves it.
  SELECT m.participant_id
  INTO v_participant_id
  FROM guest_credentials.assignment_room_members m
  WHERE m.room_id = p_room_id AND m.token_digest = v_member_digest;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT * INTO v_participant
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id AND id = v_participant_id
  FOR UPDATE;
  IF NOT FOUND OR v_participant.removed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT * INTO v_member
  FROM guest_credentials.assignment_room_members
  WHERE room_id = p_room_id AND participant_id = v_participant.id
  FOR UPDATE;
  IF NOT FOUND
     OR v_member.token_digest <> v_member_digest
     OR v_member.revoked_at IS NOT NULL
     OR v_member.expires_at <= clock_timestamp()
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  -- Without the stored index the bearer cannot be mapped to its original
  -- ledger identity, so the share it represents is unverifiable.
  IF v_participant.expense_participant_index IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  -- Version 1 is immutable and was aligned with `expense_participant_index`
  -- at finalization (both ordered by participant ordinal over the same
  -- active set). Current payload arrays can reorder after later edits, so
  -- the original ref is read from version 1 only.
  SELECT v1.payload->'participants'->v_participant.expense_participant_index
  INTO v_ref
  FROM public.expense_versions v1
  WHERE v1.expense_id = v_room.expense_id
    AND v1.version_no = 1;

  IF v_ref IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  -- An account attendee's bearer keeps its ledger user identity and must
  -- never be convertible into a guest claim; only a room participant that
  -- was anonymous at finalization may link a share.
  IF v_participant.user_id IS NOT NULL
     OR v_ref->>'kind' IS DISTINCT FROM 'guest'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
  END IF;

  IF NOT (v_ref ? 'guestId')
     OR jsonb_typeof(v_ref->'guestId') <> 'string'
     OR v_ref->>'guestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;
  v_guest_id := (v_ref->>'guestId')::uuid;

  -- The stored ref must point at a guest row of this room's expense; the
  -- shared transition re-locks and rechecks it authoritatively.
  IF NOT EXISTS (
    SELECT 1 FROM public.guests
    WHERE id = v_guest_id AND expense_id = v_room.expense_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  v_ack := public.claim_guest_participant(v_guest_id);
  UPDATE public.assignment_rooms
  SET revision = revision + 1
  WHERE id = p_room_id;
  PERFORM public.broadcast_assignment_room(p_room_id);
  RETURN v_ack;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_assignment_room_guest(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_assignment_room_guest(uuid, text)
  TO authenticated;
