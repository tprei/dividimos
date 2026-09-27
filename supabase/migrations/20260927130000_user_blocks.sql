-- explicit user blocking: directed user_blocks pair, symmetric contact guard for later enforcement, own-block-list read, caller-owned block lifecycle, and service-only push eligibility
CREATE TABLE public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);

CREATE INDEX user_blocks_blocked_id_idx ON public.user_blocks(blocked_id, blocker_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_blocks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_blocks TO service_role;

CREATE FUNCTION public.assert_user_contact_allowed(p_actor uuid, p_other uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM public.users WHERE id IN (p_actor, p_other) ORDER BY id FOR SHARE;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = p_actor AND b.blocked_id = p_other)
       OR (b.blocker_id = p_other AND b.blocked_id = p_actor)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_user_contact_allowed(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_user_contact_allowed(uuid, uuid) TO service_role;

CREATE FUNCTION public.get_user_blocks() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_user_id();
  RETURN COALESCE((
    SELECT jsonb_agg(public.ledger_user_profile_json(b.blocked_id) ORDER BY b.created_at DESC, b.blocked_id)
    FROM public.user_blocks b WHERE b.blocker_id = v_actor
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_blocks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_blocks() TO authenticated, service_role;

CREATE FUNCTION public.block_user(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_user_id();
  IF p_user_id IS NULL OR p_user_id = v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id AND onboarded) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;
  PERFORM 1 FROM public.users WHERE id = v_actor FOR NO KEY UPDATE;
  INSERT INTO public.user_blocks(blocker_id, blocked_id) VALUES (v_actor, p_user_id)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;
  PERFORM realtime.send('{}'::jsonb, 'blocks_changed', 'user:' || v_actor::text, true);
  RETURN public.get_user_blocks();
END;
$$;

REVOKE ALL ON FUNCTION public.block_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_user(uuid) TO authenticated, service_role;

CREATE FUNCTION public.unblock_user(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_user_id();
  IF p_user_id IS NULL OR p_user_id = v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  PERFORM 1 FROM public.users WHERE id = v_actor FOR NO KEY UPDATE;
  DELETE FROM public.user_blocks WHERE blocker_id = v_actor AND blocked_id = p_user_id;
  PERFORM realtime.send('{}'::jsonb, 'blocks_changed', 'user:' || v_actor::text, true);
  RETURN public.get_user_blocks();
END;
$$;

REVOKE ALL ON FUNCTION public.unblock_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_user(uuid) TO authenticated, service_role;

CREATE FUNCTION public.get_push_blockers(p_actor_id uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(b.blocker_id ORDER BY b.blocker_id), ARRAY[]::uuid[])
  FROM public.user_blocks b WHERE b.blocked_id = p_actor_id
$$;

REVOKE ALL ON FUNCTION public.get_push_blockers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_blockers(uuid) TO service_role;
