-- A pending re-invitation used to switch off the former-member balance
-- guard: recompute_group_balances only protected users with no
-- group_members row, so anyone could invite a departed member back and
-- then void their settlements or rewrite their old shares, and a bill
-- naming both a pending invitee as payer and a departed member made that
-- invitation undeclinable (blocking the victim's account deletion).
-- Departures are now recorded explicitly, so a user who ever departed
-- stays protected until they accept membership again. Declining an
-- invitation also never rewrites a departed member's net: when voiding a
-- payer-decliner's bill would touch a departed member, the decliner's
-- slot becomes a named guest instead, which moves nobody's balance.

SET lock_timeout = '5s';

CREATE TABLE public.group_member_departures (
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  departed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

ALTER TABLE public.group_member_departures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.group_member_departures FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_former_member(p_group_id uuid, p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = p_group_id
         AND gm.user_id = p_user_id
         AND gm.status = 'accepted'
     )
     AND (
       NOT EXISTS (
         SELECT 1 FROM public.group_members gm
         WHERE gm.group_id = p_group_id
           AND gm.user_id = p_user_id
       )
       OR EXISTS (
         SELECT 1 FROM public.group_member_departures d
         WHERE d.group_id = p_group_id
           AND d.user_id = p_user_id
       )
     );
$$;

REVOKE ALL ON FUNCTION public.is_former_member(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.recompute_group_balances(p_group_id uuid) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_version bigint;
  v_former_balances jsonb;
BEGIN
  SELECT COALESCE(jsonb_object_agg(gb.participant_id, gb.net_cents), '{}'::jsonb)
    INTO v_former_balances
    FROM public.group_balances gb
   WHERE gb.group_id = p_group_id
     AND gb.kind = 'user'
     AND public.is_former_member(p_group_id, gb.participant_id);

  DELETE FROM public.group_balances WHERE group_id = p_group_id;
  INSERT INTO public.group_balances (group_id, kind, participant_id, net_cents)
  SELECT p_group_id, kind, participant_id, SUM(delta)
  FROM (
    SELECT cep.kind, COALESCE(cep.user_id, cep.guest_id) AS participant_id,
           (cep.paid_cents - cep.share_cents)::bigint AS delta
    FROM public.current_expense_participants cep
    JOIN public.expenses e ON e.id = cep.expense_id
    WHERE e.group_id = p_group_id
    UNION ALL
    SELECT 'user'::public.participant_kind, s.from_user_id, s.amount_cents::bigint FROM public.settlements s
     WHERE s.group_id = p_group_id AND s.status = 'confirmed'
    UNION ALL
    SELECT 'user'::public.participant_kind, s.to_user_id, -s.amount_cents::bigint FROM public.settlements s
     WHERE s.group_id = p_group_id AND s.status = 'confirmed'
  ) t
  GROUP BY kind, participant_id
  HAVING SUM(delta) <> 0;
  IF EXISTS (
    SELECT 1
    FROM public.group_balances gb
   WHERE gb.group_id = p_group_id
     AND gb.kind = 'user'
     AND public.is_former_member(p_group_id, gb.participant_id)
     AND COALESCE(v_former_balances ->> (gb.participant_id::text), '0')::bigint <> gb.net_cents
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'former_member_balance';
  END IF;
  UPDATE public.group_members gm
  SET archived_at = NULL
  WHERE gm.group_id = p_group_id
    AND gm.archived_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.group_balances gb
      WHERE gb.group_id = p_group_id AND gb.kind = 'user' AND gb.participant_id = gm.user_id
    );
  UPDATE public.groups SET ledger_version = ledger_version + 1 WHERE id = p_group_id
    RETURNING ledger_version INTO v_version;
  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_group_balances(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.leave_group(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_kind group_kind;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  SELECT kind, ledger_version INTO v_kind, v_ledger_version FROM groups WHERE id = p_group_id;
  IF v_kind = 'dm' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cannot_leave_dm';
  END IF;

  IF EXISTS (
    SELECT 1 FROM group_balances
    WHERE group_id = p_group_id AND kind = 'user' AND participant_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'outstanding_balance';
  END IF;

  DELETE FROM group_members
  WHERE group_id = p_group_id AND user_id = v_actor;

  INSERT INTO group_member_departures (group_id, user_id, departed_at)
  VALUES (p_group_id, v_actor, now())
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET departed_at = EXCLUDED.departed_at;

  v_event_id := emit_event(
    p_group_id,
    'member_left',
    v_actor,
    p_subject_user_id => v_actor,
    p_payload => '{}'::jsonb
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.leave_group(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leave_group(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_member(p_group_id uuid, p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_creator_id uuid;
  v_kind group_kind;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

  SELECT creator_id, kind, ledger_version INTO v_creator_id, v_kind, v_ledger_version FROM groups WHERE id = p_group_id;
  IF v_creator_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_creator';
  END IF;

  PERFORM assert_member(p_group_id, v_actor);

  IF p_user_id = v_creator_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM group_members WHERE group_id = p_group_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
  END IF;

  IF v_kind = 'dm' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cannot_leave_dm';
  END IF;

  IF EXISTS (
    SELECT 1 FROM group_balances
    WHERE group_id = p_group_id AND kind = 'user' AND participant_id = p_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'outstanding_balance';
  END IF;

  DELETE FROM group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;

  INSERT INTO group_member_exclusions (group_id, user_id, excluded_by, excluded_at)
  VALUES (p_group_id, p_user_id, v_actor, now())
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET excluded_by = EXCLUDED.excluded_by,
                excluded_at = EXCLUDED.excluded_at;

  INSERT INTO group_member_departures (group_id, user_id, departed_at)
  VALUES (p_group_id, p_user_id, now())
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET departed_at = EXCLUDED.departed_at;

  v_event_id := emit_event(
    p_group_id,
    'member_removed',
    v_actor,
    p_subject_user_id => p_user_id,
    p_payload => '{}'::jsonb
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_member(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_invitation(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_invited_by uuid;
  v_kind group_kind;
  v_event_id bigint;
  v_invalidated boolean := false;
  v_new_payload jsonb;
  v_new_version_no integer;
  v_change_summary jsonb;
  v_display_name text;
  v_is_payer boolean;
  v_rec record;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

  IF EXISTS (
    SELECT 1 FROM group_member_exclusions
    WHERE group_id = p_group_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  SELECT status, invited_by INTO v_status, v_invited_by FROM group_members
  WHERE group_id = p_group_id AND user_id = v_actor
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'invited' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_invited';
  END IF;

  SELECT kind, ledger_version INTO v_kind, v_ledger_version FROM groups WHERE id = p_group_id;

  IF v_kind = 'dm' THEN
    IF v_invited_by IS NOT NULL THEN
      PERFORM broadcast_user(v_invited_by, p_group_id);
    END IF;
    INSERT INTO public.dm_opt_outs (user_id, other_user_id)
    VALUES (
      v_actor,
      (
        SELECT CASE WHEN g.dm_user_a = v_actor THEN g.dm_user_b ELSE g.dm_user_a END
        FROM groups AS g
        WHERE g.id = p_group_id
      )
    )
    ON CONFLICT DO NOTHING;
    DELETE FROM groups WHERE id = p_group_id;
  ELSE
    BEGIN
      FOR v_rec IN
        SELECT
          e.id AS expense_id,
          e.status AS expense_status,
          e.current_version_no,
          ev.occurred_on,
          ev.title,
          ev.merchant_name,
          ev.expense_type,
          ev.total_cents,
          ev.service_fee_bps,
          ev.fixed_fee_cents,
          ep.payload,
          pi.participant_index
        FROM expenses e
        JOIN expense_versions ev
          ON ev.expense_id = e.id AND ev.version_no = e.current_version_no
        CROSS JOIN LATERAL effective_expense_payload(e.id, e.current_version_no) AS ep(payload)
        CROSS JOIN LATERAL (
          SELECT (ord.idx - 1)::integer AS participant_index
          FROM jsonb_array_elements(COALESCE(ep.payload->'participants', '[]'::jsonb))
            WITH ORDINALITY AS ord(p, idx)
          WHERE ord.p->>'kind' = 'user'
            AND ord.p ? 'userId'
            AND ord.p->>'userId' = v_actor::text
          LIMIT 1
        ) pi
        WHERE e.group_id = p_group_id
        FOR UPDATE OF e
      LOOP
        v_is_payer := EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(v_rec.payload->'payers', '[]'::jsonb)) AS py(p)
          WHERE (py.p->>'participantIndex')::integer = v_rec.participant_index
        );

        IF v_is_payer AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(v_rec.payload->'participants', '[]'::jsonb)) AS pp(p)
          WHERE pp.p->>'kind' = 'user'
            AND pp.p ? 'userId'
            AND (pp.p->>'userId')::uuid <> v_actor
            AND public.is_former_member(p_group_id, (pp.p->>'userId')::uuid)
        ) THEN
          v_is_payer := false;
        END IF;

        IF v_is_payer THEN
          IF v_rec.expense_status = 'active' THEN
            UPDATE expenses
            SET status = 'deleted',
                deleted_at = now(),
                deleted_by = v_actor,
                declined_user_ids = CASE
                  WHEN v_actor = ANY(declined_user_ids) THEN declined_user_ids
                  ELSE array_append(declined_user_ids, v_actor)
                END
            WHERE id = v_rec.expense_id;

            v_event_id := emit_event(
              p_group_id, 'expense_deleted', v_actor, v_rec.expense_id,
              NULL, NULL, jsonb_build_object('title', v_rec.title, 'totalCents', v_rec.total_cents)
            );
            v_invalidated := true;
          ELSE
            UPDATE expenses
            SET declined_user_ids = CASE
                  WHEN v_actor = ANY(declined_user_ids) THEN declined_user_ids
                  ELSE array_append(declined_user_ids, v_actor)
                END
            WHERE id = v_rec.expense_id;
          END IF;
        ELSE
          v_display_name := (
            SELECT name FROM public.users WHERE id = v_actor
          );
          v_new_payload := jsonb_set(
            v_rec.payload,
            ARRAY['participants', v_rec.participant_index::text],
            jsonb_build_object('kind', 'guest', 'displayName', v_display_name)
          );
          v_new_payload := resolve_expense_participants(v_rec.expense_id, v_new_payload);
          v_new_version_no := v_rec.current_version_no + 1;
          INSERT INTO expense_versions (
            expense_id, version_no, author_id, occurred_on, title, merchant_name, expense_type,
            total_cents, service_fee_bps, fixed_fee_cents, payload, change_summary
          ) VALUES (
            v_rec.expense_id, v_new_version_no, v_actor, v_rec.occurred_on, v_rec.title, v_rec.merchant_name,
            v_rec.expense_type, v_rec.total_cents, v_rec.service_fee_bps, v_rec.fixed_fee_cents,
            v_new_payload, NULL
          );
          v_change_summary := expense_change_summary(v_rec.expense_id, v_rec.current_version_no, v_new_version_no);
          UPDATE expense_versions SET change_summary = v_change_summary
          WHERE expense_id = v_rec.expense_id AND version_no = v_new_version_no;

          UPDATE expenses
          SET current_version_no = v_new_version_no,
              declined_user_ids = array_remove(declined_user_ids, v_actor)
          WHERE id = v_rec.expense_id;

          IF v_rec.expense_status = 'active' THEN
            v_event_id := emit_event(
              p_group_id, 'expense_edited', v_actor, v_rec.expense_id,
              NULL, NULL, v_change_summary
            );
          END IF;
          v_invalidated := true;
        END IF;
      END LOOP;

      IF v_invalidated THEN
        v_ledger_version := recompute_group_balances(p_group_id);
        PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);
      END IF;
    EXCEPTION
      WHEN others THEN
        IF SQLERRM = 'former_member_balance'
           AND public.is_former_member(p_group_id, v_actor) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'outstanding_balance';
        END IF;
        RAISE;
    END;

    IF EXISTS (
      SELECT 1 FROM group_balances
      WHERE group_id = p_group_id AND kind = 'user' AND participant_id = v_actor
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'outstanding_balance';
    END IF;

    DELETE FROM group_members
    WHERE group_id = p_group_id AND user_id = v_actor;
    IF v_invited_by IS NOT NULL THEN
      PERFORM broadcast_user(v_invited_by, p_group_id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.decline_invitation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decline_invitation(uuid) TO service_role, authenticated;
