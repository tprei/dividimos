-- 735b: page expense histories and report true totals.

drop function if exists "public"."get_group_expenses"(p_group_id uuid, p_before timestamp with time zone, p_limit integer);

CREATE INDEX expenses_group_created_idx ON public.expenses USING btree (group_id, created_at DESC, id DESC);

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_group_expenses(p_group_id uuid, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_expenses jsonb;
  v_cursor jsonb;
  v_complete boolean;
BEGIN
  v_user_id := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  -- Half a cursor cannot express the strict (created_at, id) boundary.
  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM assert_member(p_group_id, v_user_id);

  WITH page AS (
    SELECT id, created_at,
      row_number() OVER (ORDER BY created_at DESC, id DESC) AS row_no
    FROM expenses
    WHERE group_id = p_group_id
      AND (
        p_before_id IS NULL
        OR (created_at, id) < (p_before_created_at, p_before_id)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit + 1
  )
  SELECT
    COALESCE(jsonb_agg(ledger_expense_summary_json(p.id, v_user_id) ORDER BY p.created_at DESC, p.id DESC)
      FILTER (WHERE p.row_no <= p_limit), '[]'::jsonb),
    count(*) <= p_limit,
    COALESCE((
      SELECT jsonb_build_object('createdAt', to_jsonb(last_row.created_at), 'id', last_row.id)
      FROM page last_row
      WHERE last_row.row_no = p_limit AND (SELECT count(*) FROM page) > p_limit
    ), 'null'::jsonb)
  INTO v_expenses, v_complete, v_cursor
  FROM page p;

  RETURN jsonb_build_object(
    'expenses', v_expenses,
    'nextCursor', v_cursor,
    'complete', v_complete,
    -- Total over the whole group, not the page, so the UI never advertises a
    -- count that only describes what happens to be loaded.
    'total', (SELECT count(*)::integer FROM expenses WHERE group_id = p_group_id)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_expenses(p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_expenses jsonb;
  v_cursor jsonb;
  v_complete boolean;
BEGIN
  v_user_id := current_user_id();

  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  WITH visible AS (
    SELECT e.id, e.created_at
    FROM expenses e
    WHERE e.group_id IN (
      SELECT gm.group_id FROM group_members gm
      WHERE gm.user_id = v_user_id AND gm.status = 'accepted'
    )
  ), page AS (
    SELECT id, created_at,
      row_number() OVER (ORDER BY created_at DESC, id DESC) AS row_no
    FROM visible
    WHERE p_before_id IS NULL
      OR (created_at, id) < (p_before_created_at, p_before_id)
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit + 1
  )
  SELECT
    COALESCE(jsonb_agg(ledger_expense_summary_json(p.id, v_user_id) ORDER BY p.created_at DESC, p.id DESC)
      FILTER (WHERE p.row_no <= p_limit), '[]'::jsonb),
    count(*) <= p_limit,
    COALESCE((
      SELECT jsonb_build_object('createdAt', to_jsonb(last_row.created_at), 'id', last_row.id)
      FROM page last_row
      WHERE last_row.row_no = p_limit AND (SELECT count(*) FROM page) > p_limit
    ), 'null'::jsonb)
  INTO v_expenses, v_complete, v_cursor
  FROM page p;

  RETURN jsonb_build_object(
    'expenses', v_expenses,
    'nextCursor', v_cursor,
    'complete', v_complete,
    'total', (
      SELECT count(*)::integer FROM expenses e
      WHERE e.group_id IN (
        SELECT gm.group_id FROM group_members gm
        WHERE gm.user_id = v_user_id AND gm.status = 'accepted'
      )
    )
  );
END;
$function$
;



REVOKE ALL ON FUNCTION public.get_group_expenses(uuid, timestamptz, uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_group_expenses(uuid, timestamptz, uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_expenses(timestamptz, uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_expenses(timestamptz, uuid, integer) TO authenticated;
