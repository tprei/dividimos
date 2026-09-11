-- Ledger baseline. This file is the concatenation of supabase/schemas/*.sql in
-- lexical order and is regenerated whenever a schema file changes:
--
--   ./scripts/build-baseline.sh
--
-- The declarative files under supabase/schemas/ are the source of truth.

-- ---- 00_extensions.sql ----
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS guest_credentials;

-- ---- 01_tables.sql ----
CREATE TYPE public.group_kind AS ENUM ('group', 'dm');
CREATE TYPE public.member_status AS ENUM ('invited', 'accepted');
CREATE TYPE public.expense_type AS ENUM ('itemized', 'single_amount');
CREATE TYPE public.expense_status AS ENUM ('active', 'deleted');
CREATE TYPE public.participant_kind AS ENUM ('user', 'guest');
CREATE TYPE public.settlement_status AS ENUM ('confirmed', 'voided');
CREATE TYPE public.pix_key_type AS ENUM ('cpf', 'email', 'phone', 'random');
CREATE TYPE public.event_kind AS ENUM (
  'expense_created', 'expense_edited', 'expense_deleted', 'expense_restored',
  'settlement_recorded', 'settlement_voided',
  'member_invited', 'member_joined', 'member_left', 'member_removed',
  'guest_claimed', 'nudge'
);

CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  handle text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9_]{3,30}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  email text NOT NULL,
  avatar_url text,
  pix_key_type public.pix_key_type,
  pix_key_hint text,
  pix_key_encrypted text,
  onboarded boolean NOT NULL DEFAULT false,
  notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind public.group_kind NOT NULL DEFAULT 'group',
  name text NOT NULL CHECK (
    (kind = 'dm' AND name = '') OR (kind = 'group' AND length(name) BETWEEN 1 AND 80)
  ),
  creator_id uuid NOT NULL REFERENCES public.users(id),
  dm_user_a uuid REFERENCES public.users(id),
  dm_user_b uuid REFERENCES public.users(id),
  ledger_version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'group' AND dm_user_a IS NULL AND dm_user_b IS NULL) OR
    (kind = 'dm' AND dm_user_a IS NOT NULL AND dm_user_b IS NOT NULL AND dm_user_a < dm_user_b)
  ),
  UNIQUE (dm_user_a, dm_user_b)
);

CREATE TABLE public.group_members (
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status public.member_status NOT NULL DEFAULT 'invited',
  invited_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON public.group_members (user_id) WHERE status = 'accepted';

CREATE TABLE public.group_invite_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES public.users(id),
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  use_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX group_invite_links_one_active ON public.group_invite_links (group_id) WHERE is_active;

CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE,
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES public.users(id),
  status public.expense_status NOT NULL DEFAULT 'active',
  current_version_no integer NOT NULL DEFAULT 1,
  occurred_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id)
);
CREATE INDEX expenses_group_idx ON public.expenses (group_id, occurred_on DESC, created_at DESC);

CREATE TABLE public.expense_versions (
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no >= 1),
  author_id uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  merchant_name text CHECK (merchant_name IS NULL OR length(merchant_name) <= 160),
  expense_type public.expense_type NOT NULL,
  total_cents integer NOT NULL CHECK (total_cents BETWEEN 1 AND 99999999),
  service_fee_bps integer NOT NULL DEFAULT 0 CHECK (service_fee_bps BETWEEN 0 AND 10000),
  fixed_fee_cents integer NOT NULL DEFAULT 0 CHECK (fixed_fee_cents BETWEEN 0 AND 99999999),
  payload jsonb NOT NULL,
  change_summary jsonb,
  PRIMARY KEY (expense_id, version_no)
);

CREATE TABLE public.guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  claimed_by uuid REFERENCES public.users(id),
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((claimed_by IS NULL) = (claimed_at IS NULL))
);
CREATE INDEX guests_expense_idx ON public.guests (expense_id);

CREATE TABLE public.expense_participants (
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  participant_index integer NOT NULL CHECK (participant_index >= 0),
  kind public.participant_kind NOT NULL,
  user_id uuid REFERENCES public.users(id),
  guest_id uuid REFERENCES public.guests(id),
  share_cents integer NOT NULL CHECK (share_cents BETWEEN 0 AND 99999999),
  paid_cents integer NOT NULL DEFAULT 0 CHECK (paid_cents BETWEEN 0 AND 99999999),
  PRIMARY KEY (expense_id, participant_index),
  CHECK ((kind = 'user' AND user_id IS NOT NULL AND guest_id IS NULL) OR
         (kind = 'guest' AND guest_id IS NOT NULL AND user_id IS NULL AND paid_cents = 0)),
  UNIQUE (expense_id, user_id),
  UNIQUE (expense_id, guest_id)
);
CREATE INDEX expense_participants_user_idx ON public.expense_participants (user_id);

CREATE TABLE public.settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL UNIQUE,
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES public.users(id),
  to_user_id uuid NOT NULL REFERENCES public.users(id),
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999),
  status public.settlement_status NOT NULL DEFAULT 'confirmed',
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  voided_at timestamptz,
  voided_by uuid REFERENCES public.users(id),
  CHECK (from_user_id <> to_user_id)
);
CREATE INDEX settlements_group_idx ON public.settlements (group_id, created_at DESC);

CREATE TABLE public.group_balances (
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  kind public.participant_kind NOT NULL,
  participant_id uuid NOT NULL,
  net_cents bigint NOT NULL,
  PRIMARY KEY (group_id, kind, participant_id)
);
-- net_cents > 0: participant is owed; < 0: participant owes. Zero rows are never stored.

CREATE TABLE public.group_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.users(id),
  kind public.event_kind NOT NULL,
  expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  settlement_id uuid REFERENCES public.settlements(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES public.users(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);
CREATE INDEX group_events_group_idx ON public.group_events (group_id, id DESC);

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE,
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users(id),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_group_idx ON public.chat_messages (group_id, created_at DESC);

CREATE TABLE public.conversation_reads (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('web', 'fcm')),
  endpoint_digest bytea NOT NULL,
  subscription_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint_digest)
);

CREATE TABLE guest_credentials.claim_tokens (
  guest_id uuid PRIMARY KEY REFERENCES public.guests(id) ON DELETE CASCADE,
  token_digest bytea NOT NULL UNIQUE,
  generation integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_invite_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_credentials.claim_tokens ENABLE ROW LEVEL SECURITY;

-- ---- 02_functions_internal.sql ----
CREATE FUNCTION public.current_user_id() RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT auth.uid() INTO v_user_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'unauthenticated';
  END IF;
  RETURN v_user_id;
END;
$$;

CREATE FUNCTION public.assert_member(p_group_id uuid, p_user_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_id AND status = 'accepted'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
  END IF;
END;
$$;

CREATE FUNCTION public.assert_member_or_invited(p_group_id uuid, p_user_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_id AND status IN ('invited', 'accepted')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
  END IF;
END;
$$;

CREATE FUNCTION public.is_member(p_group_id uuid, p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_id AND status = 'accepted'
  )
$$;

CREATE FUNCTION public.is_member_or_invited(p_group_id uuid, p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_id AND status IN ('invited', 'accepted')
  )
$$;

CREATE FUNCTION public.lock_group(p_group_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'group_not_found';
  END IF;
END;
$$;

CREATE FUNCTION public.recompute_group_balances(p_group_id uuid) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_version bigint;
BEGIN
  DELETE FROM group_balances WHERE group_id = p_group_id;
  INSERT INTO group_balances (group_id, kind, participant_id, net_cents)
  SELECT p_group_id, kind, participant_id, SUM(delta)
  FROM (
    SELECT ep.kind, COALESCE(ep.user_id, ep.guest_id) AS participant_id,
           (ep.paid_cents - ep.share_cents)::bigint AS delta
    FROM expense_participants ep
    JOIN expenses e ON e.id = ep.expense_id
    WHERE e.group_id = p_group_id AND e.status = 'active'
    UNION ALL
    SELECT 'user'::participant_kind, s.from_user_id, s.amount_cents::bigint FROM settlements s
     WHERE s.group_id = p_group_id AND s.status = 'confirmed'
    UNION ALL
    SELECT 'user'::participant_kind, s.to_user_id, -s.amount_cents::bigint FROM settlements s
     WHERE s.group_id = p_group_id AND s.status = 'confirmed'
  ) t
  GROUP BY kind, participant_id
  HAVING SUM(delta) <> 0;
  UPDATE groups SET ledger_version = ledger_version + 1 WHERE id = p_group_id
    RETURNING ledger_version INTO v_version;
  RETURN v_version;
END;
$$;

CREATE FUNCTION public.emit_event(
  p_group_id uuid, p_kind event_kind, p_actor uuid,
  p_expense_id uuid DEFAULT NULL, p_settlement_id uuid DEFAULT NULL,
  p_subject_user_id uuid DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_event_id bigint;
BEGIN
  INSERT INTO group_events (group_id, actor_id, kind, expense_id, settlement_id, subject_user_id, payload)
  VALUES (p_group_id, p_actor, p_kind, p_expense_id, p_settlement_id, p_subject_user_id, p_payload)
  RETURNING id INTO v_event_id;
  RETURN v_event_id;
END;
$$;

CREATE FUNCTION public.broadcast_group(p_group_id uuid, p_ledger_version bigint, p_event_id bigint) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('group_id', p_group_id, 'ledger_version', p_ledger_version, 'event_id', p_event_id),
    'ledger', 'group:' || p_group_id::text, true
  );
END;
$$;

CREATE FUNCTION public.broadcast_user(p_user_id uuid, p_group_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('group_id', p_group_id),
    'membership', 'user:' || p_user_id::text, true
  );
END;
$$;

CREATE FUNCTION public.validate_expense_payload(p jsonb, p_expense_type expense_type, p_total integer, p_fee_bps integer, p_fixed_fee integer)
RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_items jsonb;
  v_participants jsonb;
  v_shares jsonb;
  v_payers jsonb;
  v_item_assignments jsonb;
  v_n integer;
  v_i integer;
  v_participant jsonb;
  v_item jsonb;
  v_payer jsonb;
  v_assignment jsonb;
  v_share integer;
  v_share_sum bigint := 0;
  v_payer_sum bigint := 0;
  v_item_sum bigint := 0;
  v_fee bigint;
  v_payer_indexes integer[];
  v_seen_user_ids uuid[];
  v_seen_guest_ids uuid[];
  v_user_id uuid;
  v_guest_id uuid;
  v_item_index integer;
  v_participant_index integer;
  v_amount integer;
  v_num numeric;
  v_item_total integer;
  v_assignment_sum bigint;
  v_j integer;
  v_guest_id_for_user uuid;
  v_display_name text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  IF p_total IS NULL OR p_total < 1 OR p_total > 99999999 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  IF p_fee_bps IS NULL OR p_fee_bps < 0 OR p_fee_bps > 10000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  IF p_fixed_fee IS NULL OR p_fixed_fee < 0 OR p_fixed_fee > 99999999 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;

  IF p ? 'items' THEN v_items := p->'items'; ELSE v_items := NULL; END IF;
  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  v_n := jsonb_array_length(v_items);
  IF v_n > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'too_many_items';
  END IF;
  IF p_expense_type = 'itemized' AND v_n = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  v_i := 0;
  WHILE v_i < v_n LOOP
    v_item := v_items->v_i;
    IF v_item IS NULL OR jsonb_typeof(v_item) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) k
                  WHERE k NOT IN ('description', 'quantityMilliunits', 'unitPriceCents', 'totalPriceCents'))
       OR NOT (v_item ? 'description' AND v_item ? 'quantityMilliunits' AND v_item ? 'unitPriceCents' AND v_item ? 'totalPriceCents')
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF jsonb_typeof(v_item->'quantityMilliunits') <> 'number'
       OR (v_item->>'quantityMilliunits')::numeric <> floor((v_item->>'quantityMilliunits')::numeric)
       OR (v_item->>'quantityMilliunits')::numeric < 1
       OR (v_item->>'quantityMilliunits')::numeric > 999999999
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF jsonb_typeof(v_item->'unitPriceCents') <> 'number'
       OR (v_item->>'unitPriceCents')::text <> floor((v_item->>'unitPriceCents')::numeric)::text
       OR (v_item->>'unitPriceCents')::numeric < 0
       OR (v_item->>'unitPriceCents')::numeric > 99999999
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF jsonb_typeof(v_item->'totalPriceCents') <> 'number'
       OR (v_item->>'totalPriceCents')::text <> floor((v_item->>'totalPriceCents')::numeric)::text
       OR (v_item->>'totalPriceCents')::numeric < 0
       OR (v_item->>'totalPriceCents')::numeric > 99999999
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_num := floor(((v_item->>'quantityMilliunits')::numeric
                    * (v_item->>'unitPriceCents')::numeric + 500) / 1000);
    IF v_num <> (v_item->>'totalPriceCents')::numeric THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'line_total_mismatch';
    END IF;
    IF v_item->'description' IS NOT NULL AND jsonb_typeof(v_item->'description') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_i := v_i + 1;
  END LOOP;

  IF p ? 'participants' THEN v_participants := p->'participants'; ELSE v_participants := NULL; END IF;
  IF v_participants IS NULL OR jsonb_typeof(v_participants) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  v_n := jsonb_array_length(v_participants);
  IF v_n > 50 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'too_many_participants';
  END IF;
  v_i := 0;
  WHILE v_i < v_n LOOP
    v_participant := v_participants->v_i;
    IF v_participant IS NULL OR jsonb_typeof(v_participant) <> 'object' OR NOT (v_participant ? 'kind') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF v_participant->>'kind' = 'user' THEN
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_participant) k WHERE k NOT IN ('kind', 'userId'))
         OR jsonb_typeof(v_participant->'userId') <> 'string'
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      v_user_id := (v_participant->>'userId')::uuid;
      IF v_user_id = ANY (v_seen_user_ids) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_participant';
      END IF;
      v_seen_user_ids := array_append(v_seen_user_ids, v_user_id);
    ELSIF v_participant->>'kind' = 'guest' THEN
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_participant) k WHERE k NOT IN ('kind', 'guestId', 'displayName'))
         OR jsonb_typeof(v_participant->'displayName') <> 'string'
         OR length(v_participant->>'displayName') < 1
         OR length(v_participant->>'displayName') > 80
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      IF v_participant ? 'guestId' AND jsonb_typeof(v_participant->'guestId') NOT IN ('null', 'string') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      IF jsonb_typeof(v_participant->'guestId') = 'string' THEN
        v_guest_id := (v_participant->>'guestId')::uuid;
        IF v_guest_id = ANY (v_seen_guest_ids) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_participant';
        END IF;
        v_seen_guest_ids := array_append(v_seen_guest_ids, v_guest_id);
      ELSE
        v_guest_id := NULL;
      END IF;
      v_display_name := v_participant->>'displayName';
    ELSE
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_i := v_i + 1;
  END LOOP;
  IF v_n = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;

  IF p ? 'shares' THEN v_shares := p->'shares'; ELSE v_shares := NULL; END IF;
  IF v_shares IS NULL OR jsonb_typeof(v_shares) <> 'array'
     OR jsonb_array_length(v_shares) <> jsonb_array_length(v_participants)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  v_i := 0;
  WHILE v_i < jsonb_array_length(v_shares) LOOP
    IF jsonb_typeof(v_shares->v_i) <> 'number'
       OR (v_shares->>v_i)::text <> floor((v_shares->>v_i)::numeric)::text
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_num := (v_shares->>v_i)::numeric;
    IF v_num < 0 OR v_num > 99999999 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_share := v_num::integer;
    v_share_sum := v_share_sum + v_share;
    v_i := v_i + 1;
  END LOOP;
  IF v_share_sum <> p_total THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'share_total_mismatch';
  END IF;

  IF p ? 'payers' THEN v_payers := p->'payers'; ELSE v_payers := NULL; END IF;
  IF v_payers IS NULL OR jsonb_typeof(v_payers) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  v_i := 0;
  WHILE v_i < jsonb_array_length(v_payers) LOOP
    v_payer := v_payers->v_i;
    IF v_payer IS NULL OR jsonb_typeof(v_payer) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_payer) k WHERE k NOT IN ('participantIndex', 'amountCents'))
       OR NOT (v_payer ? 'participantIndex' AND v_payer ? 'amountCents')
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF jsonb_typeof(v_payer->'participantIndex') <> 'number'
       OR (v_payer->>'participantIndex')::text <> floor((v_payer->>'participantIndex')::numeric)::text
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_num := (v_payer->>'participantIndex')::numeric;
    IF v_num < 0 OR v_num >= jsonb_array_length(v_participants) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_participant_index := v_num::integer;
    IF v_participant_index = ANY (v_payer_indexes) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_payer_indexes := array_append(v_payer_indexes, v_participant_index);
    IF v_participants->v_participant_index->>'kind' <> 'user' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_cannot_pay';
    END IF;
    IF jsonb_typeof(v_payer->'amountCents') <> 'number'
       OR (v_payer->>'amountCents')::text <> floor((v_payer->>'amountCents')::numeric)::text
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_num := (v_payer->>'amountCents')::numeric;
    IF v_num < 1 OR v_num > 99999999 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_amount := v_num::integer;
    v_payer_sum := v_payer_sum + v_amount;
    v_i := v_i + 1;
  END LOOP;
  IF v_payer_sum <> p_total THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'payer_total_mismatch';
  END IF;

  IF p_expense_type = 'itemized' THEN
    v_i := 0;
    WHILE v_i < jsonb_array_length(v_items) LOOP
      v_item_sum := v_item_sum + (v_items->v_i->>'totalPriceCents')::integer;
      v_i := v_i + 1;
    END LOOP;
    v_fee := (v_item_sum * p_fee_bps + 5000) / 10000;
    IF v_item_sum + v_fee + p_fixed_fee <> p_total THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'itemized_total_mismatch';
    END IF;
  END IF;

  IF p ? 'itemAssignments' AND jsonb_typeof(p->'itemAssignments') <> 'null' THEN
    v_item_assignments := p->'itemAssignments';
    IF jsonb_typeof(v_item_assignments) <> 'array' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    -- 100 items x 50 participants is the structural maximum; without a cap the
    -- reconciliation below runs while lock_group is held.
    IF jsonb_array_length(v_item_assignments) > 5000 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_i := 0;
    WHILE v_i < jsonb_array_length(v_item_assignments) LOOP
      v_assignment := v_item_assignments->v_i;
      IF v_assignment IS NULL OR jsonb_typeof(v_assignment) <> 'object'
         OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_assignment) k WHERE k NOT IN ('itemIndex', 'participantIndex', 'amountCents'))
         OR NOT (v_assignment ? 'itemIndex' AND v_assignment ? 'participantIndex' AND v_assignment ? 'amountCents')
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      IF jsonb_typeof(v_assignment->'itemIndex') <> 'number'
         OR (v_assignment->>'itemIndex')::text <> floor((v_assignment->>'itemIndex')::numeric)::text
         OR jsonb_typeof(v_assignment->'participantIndex') <> 'number'
         OR (v_assignment->>'participantIndex')::text <> floor((v_assignment->>'participantIndex')::numeric)::text
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      v_num := (v_assignment->>'itemIndex')::numeric;
      IF v_num < 0 OR v_num >= jsonb_array_length(v_items) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      v_item_index := v_num::integer;
      v_num := (v_assignment->>'participantIndex')::numeric;
      IF v_num < 0 OR v_num >= jsonb_array_length(v_participants) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      v_participant_index := v_num::integer;
      IF jsonb_typeof(v_assignment->'amountCents') <> 'number'
         OR (v_assignment->>'amountCents')::text <> floor((v_assignment->>'amountCents')::numeric)::text
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      v_num := (v_assignment->>'amountCents')::numeric;
      IF v_num < 0 OR v_num > 99999999 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      v_amount := v_num::integer;
      v_i := v_i + 1;
    END LOOP;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_item_assignments) AS a(e)
      GROUP BY (a.e->>'itemIndex'), (a.e->>'participantIndex')
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF EXISTS (
      WITH assigned AS (
        SELECT (a.e->>'itemIndex')::integer AS item_index,
               sum((a.e->>'amountCents')::integer) AS assigned_cents
        FROM jsonb_array_elements(v_item_assignments) AS a(e)
        GROUP BY 1
      ), items AS (
        SELECT (ord - 1)::integer AS item_index,
               (x->>'totalPriceCents')::integer AS total_cents
        FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(x, ord)
      )
      SELECT 1 FROM items i
      FULL JOIN assigned a ON a.item_index = i.item_index
      WHERE COALESCE(a.assigned_cents, 0) <> COALESCE(i.total_cents, -1)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF EXISTS (
      WITH assigned AS (
        SELECT (a.e->>'participantIndex')::integer AS p_idx,
               sum((a.e->>'amountCents')::numeric) AS subtotal
        FROM jsonb_array_elements(v_item_assignments) AS a(e)
        GROUP BY 1
      ), parts AS (
        SELECT (ord - 1)::integer AS p_idx,
               (s->>0)::numeric AS share_cents,
               COALESCE(asg.subtotal, 0) AS item_subtotal
        FROM jsonb_array_elements(v_shares) WITH ORDINALITY AS t(s, ord)
        LEFT JOIN assigned asg ON asg.p_idx = (ord - 1)::integer
      ), fee_parts AS (
        SELECT p_idx, share_cents, item_subtotal,
               CASE WHEN v_item_sum = 0 THEN 0
                    ELSE floor((v_fee * item_subtotal) / v_item_sum) END AS fee_base,
               CASE WHEN v_item_sum = 0 THEN 0
                    ELSE (v_fee * item_subtotal) % v_item_sum END AS fee_rem
        FROM parts
      ), ranked AS (
        SELECT p_idx, share_cents, item_subtotal, fee_base,
               SUM(fee_base) OVER () AS fee_total,
               row_number() OVER (ORDER BY fee_rem DESC, p_idx ASC) AS rn
        FROM fee_parts
      )
      SELECT 1 FROM ranked
      WHERE item_subtotal
              + fee_base
              + CASE WHEN rn <= CASE WHEN v_item_sum = 0 THEN 0
                                ELSE v_fee - fee_total END
                THEN 1 ELSE 0 END
              + (p_fixed_fee / jsonb_array_length(v_shares))
              + CASE WHEN p_idx < (p_fixed_fee % jsonb_array_length(v_shares))
                THEN 1 ELSE 0 END
            <> share_cents
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'item_assignment_share_mismatch';
    END IF;
  ELSE
    v_item_assignments := NULL;
  END IF;

  RETURN jsonb_build_object(
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'description', x->'description',
        'quantityMilliunits', (x->>'quantityMilliunits')::bigint,
        'unitPriceCents', (x->>'unitPriceCents')::integer,
        'totalPriceCents', (x->>'totalPriceCents')::integer
      ) ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(x, ord)
    ),
    'participants', (
      SELECT COALESCE(jsonb_agg(
        CASE WHEN x->>'kind' = 'user'
          THEN jsonb_build_object('kind', 'user', 'userId', x->>'userId')
          ELSE jsonb_build_object('kind', 'guest', 'guestId', x->'guestId', 'displayName', x->>'displayName')
        END ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(v_participants) WITH ORDINALITY AS t(x, ord)
    ),
    'shares', (
      SELECT COALESCE(jsonb_agg((s->>0)::integer ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(v_shares) WITH ORDINALITY AS t(s, ord)
    ),
    'payers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'participantIndex', (x->>'participantIndex')::integer,
        'amountCents', (x->>'amountCents')::integer
      ) ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(v_payers) WITH ORDINALITY AS t(x, ord)
    ),
    'itemAssignments', CASE WHEN v_item_assignments IS NULL THEN NULL ELSE (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'itemIndex', (x->>'itemIndex')::integer,
        'participantIndex', (x->>'participantIndex')::integer,
        'amountCents', (x->>'amountCents')::integer
      ) ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(v_item_assignments) WITH ORDINALITY AS t(x, ord)
    ) END
  );
END;
$$;

CREATE FUNCTION public.materialize_participants(p_expense_id uuid, p_author uuid, p_payload jsonb)
RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_participants jsonb;
  v_n integer;
  v_i integer;
  v_participant jsonb;
  v_user_id uuid;
  v_guest_id uuid;
  v_new_guest_id uuid;
  v_display_name text;
  v_claimed_by uuid;
  v_share integer;
  v_paid integer;
  v_payers jsonb;
  v_j integer;
  v_payer jsonb;
  v_out_participants jsonb := '[]'::jsonb;
  v_out jsonb;
  v_seen_users uuid[] := '{}';
  v_current_version integer;
  v_prev_payload jsonb;
  v_existing_user_ids uuid[] := '{}';
BEGIN
  SELECT e.group_id, e.current_version_no INTO v_group_id, v_current_version
  FROM expenses e WHERE e.id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  SELECT payload INTO v_prev_payload FROM expense_versions
  WHERE expense_id = p_expense_id AND version_no = v_current_version;
  SELECT COALESCE(array_agg((pa.el->>'userId')::uuid), '{}') INTO v_existing_user_ids
  FROM jsonb_array_elements(COALESCE(v_prev_payload->'participants', '[]'::jsonb)) AS pa(el)
  WHERE pa.el->>'kind' = 'user' AND pa.el ? 'userId';

  v_participants := p_payload->'participants';
  v_n := jsonb_array_length(v_participants);
  v_payers := COALESCE(p_payload->'payers', '[]'::jsonb);

  DELETE FROM expense_participants WHERE expense_id = p_expense_id;

  v_i := 0;
  WHILE v_i < v_n LOOP
    v_participant := v_participants->v_i;
    v_user_id := NULL;
    v_guest_id := NULL;
    v_new_guest_id := NULL;
    v_claimed_by := NULL;
    v_display_name := NULL;
    IF v_participant->>'kind' = 'user' THEN
      v_user_id := (v_participant->>'userId')::uuid;
      IF NOT is_member_or_invited(v_group_id, v_user_id)
         AND NOT (v_user_id = ANY (v_existing_user_ids)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
      END IF;
    ELSIF v_participant->>'kind' = 'guest' THEN
      v_display_name := v_participant->>'displayName';
      IF jsonb_typeof(v_participant->'guestId') = 'string' THEN
        v_guest_id := (v_participant->>'guestId')::uuid;
        SELECT id, claimed_by INTO v_new_guest_id, v_claimed_by
        FROM guests WHERE id = v_guest_id AND expense_id = p_expense_id;
        IF v_new_guest_id IS NULL THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
        END IF;
      ELSE
        INSERT INTO guests (expense_id, display_name) VALUES (p_expense_id, v_display_name)
        RETURNING id INTO v_new_guest_id;
      END IF;
      IF v_claimed_by IS NOT NULL THEN
        v_guest_id := NULL;
        v_user_id := v_claimed_by;
        IF NOT is_member_or_invited(v_group_id, v_user_id)
           AND NOT (v_user_id = ANY (v_existing_user_ids)) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
        END IF;
      ELSE
        v_guest_id := v_new_guest_id;
      END IF;
    ELSE
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;

    IF v_user_id IS NOT NULL THEN
      IF v_user_id = ANY (v_seen_users) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_participant';
      END IF;
      v_seen_users := array_append(v_seen_users, v_user_id);
    END IF;

    v_share := (p_payload->'shares'->v_i)::integer;
    v_paid := 0;
    v_j := 0;
    WHILE v_j < jsonb_array_length(v_payers) LOOP
      v_payer := v_payers->v_j;
      IF (v_payer->>'participantIndex')::integer = v_i THEN
        v_paid := v_paid + (v_payer->>'amountCents')::integer;
      END IF;
      v_j := v_j + 1;
    END LOOP;

    INSERT INTO expense_participants (expense_id, participant_index, kind, user_id, guest_id, share_cents, paid_cents)
    VALUES (
      p_expense_id, v_i,
      CASE WHEN v_user_id IS NOT NULL THEN 'user'::participant_kind ELSE 'guest'::participant_kind END,
      v_user_id, v_guest_id, v_share, v_paid
    );

    IF v_user_id IS NOT NULL THEN
      v_out_participants := v_out_participants || jsonb_build_object('kind', 'user', 'userId', v_user_id);
    ELSE
      v_out_participants := v_out_participants || jsonb_build_object('kind', 'guest', 'guestId', v_guest_id, 'displayName', v_display_name);
    END IF;
    v_i := v_i + 1;
  END LOOP;

  -- An unclaimed guest with no participant slot left is unreachable; its
  -- claim token would otherwise still redeem into group membership.
  DELETE FROM guests g
  WHERE g.expense_id = p_expense_id
    AND g.claimed_by IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM expense_participants ep
      WHERE ep.expense_id = p_expense_id AND ep.guest_id = g.id
    );

  v_out := jsonb_set(p_payload, '{participants}', v_out_participants);
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.expense_change_summary(p_expense_id uuid, p_from integer, p_to integer) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r_old expense_versions;
  r_new expense_versions;
  v_old_ids uuid[];
  v_new_ids uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_i integer;
  v_id uuid;
  v_old_payers jsonb;
  v_new_payers jsonb;
  v_old_norm jsonb := '[]'::jsonb;
  v_new_norm jsonb := '[]'::jsonb;
  v_old_total bigint := 0;
  v_new_total bigint := 0;
  v_participants jsonb;
  v_n integer;
  v_j integer;
  v_payer jsonb;
  v_idx integer;
  v_participant jsonb;
  v_pid uuid;
BEGIN
  SELECT * INTO r_old FROM expense_versions
  WHERE expense_id = p_expense_id AND version_no = p_from;
  SELECT * INTO r_new FROM expense_versions
  WHERE expense_id = p_expense_id AND version_no = p_to;
  IF r_old.expense_id IS NULL OR r_new.expense_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;

  v_participants := r_old.payload->'participants';
  v_n := jsonb_array_length(v_participants);
  v_i := 0;
  WHILE v_i < v_n LOOP
    v_participant := v_participants->v_i;
    v_pid := CASE WHEN v_participant->>'kind' = 'user'
              THEN (v_participant->>'userId')::uuid
              ELSE (v_participant->>'guestId')::uuid END;
    v_old_ids := array_append(v_old_ids, v_pid);
    v_i := v_i + 1;
  END LOOP;
  v_participants := r_new.payload->'participants';
  v_n := jsonb_array_length(v_participants);
  v_i := 0;
  WHILE v_i < v_n LOOP
    v_participant := v_participants->v_i;
    v_pid := CASE WHEN v_participant->>'kind' = 'user'
              THEN (v_participant->>'userId')::uuid
              ELSE (v_participant->>'guestId')::uuid END;
    v_new_ids := array_append(v_new_ids, v_pid);
    v_i := v_i + 1;
  END LOOP;

  v_i := 0;
  WHILE v_i < COALESCE(array_length(v_new_ids, 1), 0) LOOP
    v_id := v_new_ids[v_i + 1];
    IF NOT (v_id = ANY (v_old_ids)) THEN
      v_added := array_append(v_added, v_id);
    END IF;
    v_i := v_i + 1;
  END LOOP;
  v_i := 0;
  WHILE v_i < COALESCE(array_length(v_old_ids, 1), 0) LOOP
    v_id := v_old_ids[v_i + 1];
    IF NOT (v_id = ANY (v_new_ids)) THEN
      v_removed := array_append(v_removed, v_id);
    END IF;
    v_i := v_i + 1;
  END LOOP;

  v_old_payers := r_old.payload->'payers';
  v_new_payers := r_new.payload->'payers';
  v_participants := r_old.payload->'participants';
  v_n := jsonb_array_length(v_participants);
  v_j := 0;
  WHILE v_j < jsonb_array_length(v_old_payers) LOOP
    v_payer := v_old_payers->v_j;
    v_idx := (v_payer->>'participantIndex')::integer;
    v_pid := CASE WHEN v_participants->v_idx->>'kind' = 'user'
              THEN (v_participants->v_idx->>'userId')::uuid
              ELSE (v_participants->v_idx->>'guestId')::uuid END;
    v_old_norm := v_old_norm || jsonb_build_object('participantId', v_pid, 'amountCents', (v_payer->>'amountCents')::integer);
    v_old_total := v_old_total + (v_payer->>'amountCents')::bigint;
    v_j := v_j + 1;
  END LOOP;
  v_participants := r_new.payload->'participants';
  v_n := jsonb_array_length(v_participants);
  v_j := 0;
  WHILE v_j < jsonb_array_length(v_new_payers) LOOP
    v_payer := v_new_payers->v_j;
    v_idx := (v_payer->>'participantIndex')::integer;
    v_pid := CASE WHEN v_participants->v_idx->>'kind' = 'user'
              THEN (v_participants->v_idx->>'userId')::uuid
              ELSE (v_participants->v_idx->>'guestId')::uuid END;
    v_new_norm := v_new_norm || jsonb_build_object('participantId', v_pid, 'amountCents', (v_payer->>'amountCents')::integer);
    v_new_total := v_new_total + (v_payer->>'amountCents')::bigint;
    v_j := v_j + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'title', CASE WHEN r_old.title = r_new.title THEN NULL
             ELSE jsonb_build_array(r_old.title, r_new.title) END,
    'totalCents', CASE WHEN r_old.total_cents = r_new.total_cents THEN NULL
                  ELSE jsonb_build_array(r_old.total_cents, r_new.total_cents) END,
    'participantsAdded', COALESCE(to_jsonb(v_added), '[]'::jsonb),
    'participantsRemoved', COALESCE(to_jsonb(v_removed), '[]'::jsonb),
    'payersChanged', NOT (
      v_old_total = v_new_total
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_old_norm) o(e)
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new_norm) n(e) WHERE n.e = o.e)
      )
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_new_norm) n2(e)
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_old_norm) o2(e) WHERE o2.e = n2.e)
      )
    )
  );
END;
$$;

CREATE FUNCTION public.pairwise_from_nets(
  p_kinds participant_kind[],
  p_ids uuid[],
  p_nets bigint[]
)
RETURNS TABLE (from_kind participant_kind, from_id uuid, to_id uuid, amount_cents bigint)
  LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  v_count integer := COALESCE(array_length(p_ids, 1), 0);
  v_debtor_kinds participant_kind[];
  v_debtor_ids uuid[];
  v_debtor_open bigint[];
  v_creditor_ids uuid[];
  v_creditor_open bigint[];
  v_di integer := 1;
  v_ci integer := 1;
  v_amount bigint;
BEGIN
  SELECT COALESCE(array_agg(n.kind ORDER BY n.net ASC, n.pid ASC), '{}'),
         COALESCE(array_agg(n.pid ORDER BY n.net ASC, n.pid ASC), '{}'),
         COALESCE(array_agg(-n.net ORDER BY n.net ASC, n.pid ASC), '{}')
    INTO v_debtor_kinds, v_debtor_ids, v_debtor_open
    FROM (
      SELECT p_kinds[g] AS kind, p_ids[g] AS pid, p_nets[g] AS net
      FROM generate_series(1, v_count) AS g
    ) n
   WHERE n.net < 0;
  SELECT COALESCE(array_agg(n.pid ORDER BY n.net DESC, n.pid ASC), '{}'),
         COALESCE(array_agg(n.net ORDER BY n.net DESC, n.pid ASC), '{}')
    INTO v_creditor_ids, v_creditor_open
    FROM (
      SELECT p_ids[g] AS pid, p_nets[g] AS net
      FROM generate_series(1, v_count) AS g
    ) n
   WHERE n.net > 0;

  WHILE v_di <= COALESCE(array_length(v_debtor_ids, 1), 0)
    AND v_ci <= COALESCE(array_length(v_creditor_ids, 1), 0) LOOP
    v_amount := LEAST(v_debtor_open[v_di], v_creditor_open[v_ci]);
    EXIT WHEN v_amount <= 0;
    from_kind := v_debtor_kinds[v_di];
    from_id := v_debtor_ids[v_di];
    to_id := v_creditor_ids[v_ci];
    amount_cents := v_amount;
    RETURN NEXT;
    v_debtor_open[v_di] := v_debtor_open[v_di] - v_amount;
    v_creditor_open[v_ci] := v_creditor_open[v_ci] - v_amount;
    IF v_debtor_open[v_di] <= 0 THEN v_di := v_di + 1; END IF;
    IF v_creditor_open[v_ci] <= 0 THEN v_ci := v_ci + 1; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION public.group_transfers(p_group_id uuid)
RETURNS TABLE (from_kind participant_kind, from_id uuid, to_id uuid, amount_cents bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT f.from_kind, f.from_id, f.to_id, f.amount_cents
    FROM public.pairwise_from_nets(
           COALESCE((SELECT array_agg(gb.kind ORDER BY gb.kind, gb.participant_id)
                       FROM public.group_balances gb
                      WHERE gb.group_id = p_group_id), '{}'::participant_kind[]),
           COALESCE((SELECT array_agg(gb.participant_id ORDER BY gb.kind, gb.participant_id)
                       FROM public.group_balances gb
                      WHERE gb.group_id = p_group_id), '{}'),
           COALESCE((SELECT array_agg(gb.net_cents ORDER BY gb.kind, gb.participant_id)
                       FROM public.group_balances gb
                      WHERE gb.group_id = p_group_id), '{}')
         ) f;
END;
$$;

CREATE FUNCTION public.group_pairwise_edges(p_group_id uuid)
RETURNS TABLE (from_kind participant_kind, from_id uuid, to_id uuid, amount_cents bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH nets AS (
    SELECT e.id AS expense_id,
           ep.kind,
           COALESCE(ep.user_id, ep.guest_id) AS participant_id,
           (ep.paid_cents - ep.share_cents)::bigint AS net
      FROM public.expenses e
      JOIN public.expense_participants ep ON ep.expense_id = e.id
     WHERE e.group_id = p_group_id AND e.status = 'active'
  ),
  expense_edges AS (
    SELECT one.expense_id, f.from_kind, f.from_id, f.to_id, f.amount_cents
      FROM (SELECT DISTINCT n.expense_id FROM nets n) one
      CROSS JOIN LATERAL public.pairwise_from_nets(
             COALESCE((SELECT array_agg(n.kind ORDER BY n.kind, n.participant_id)
                         FROM nets n WHERE n.expense_id = one.expense_id), '{}'::participant_kind[]),
             COALESCE((SELECT array_agg(n.participant_id ORDER BY n.kind, n.participant_id)
                         FROM nets n WHERE n.expense_id = one.expense_id), '{}'),
             COALESCE((SELECT array_agg(n.net ORDER BY n.kind, n.participant_id)
                         FROM nets n WHERE n.expense_id = one.expense_id), '{}')
           ) f
  ),
  edge_with_kinds AS (
    SELECT ee.from_id, ee.to_id, ee.from_kind, kt.kind AS to_kind, ee.amount_cents
      FROM expense_edges ee
      JOIN nets kt ON kt.expense_id = ee.expense_id AND kt.participant_id = ee.to_id
  ),
  normalized AS (
    SELECT CASE WHEN k.from_id < k.to_id THEN k.from_id ELSE k.to_id END AS left_id,
           CASE WHEN k.from_id < k.to_id THEN k.to_id ELSE k.from_id END AS right_id,
           CASE WHEN k.from_id < k.to_id THEN k.from_kind ELSE k.to_kind END AS left_kind,
           CASE WHEN k.from_id < k.to_id THEN k.to_kind ELSE k.from_kind END AS right_kind,
           CASE WHEN k.from_id < k.to_id THEN k.amount_cents ELSE -k.amount_cents END AS amount
      FROM edge_with_kinds k
  ),
  settlement_deltas AS (
    SELECT CASE WHEN s.from_user_id < s.to_user_id THEN s.from_user_id ELSE s.to_user_id END AS left_id,
           CASE WHEN s.from_user_id < s.to_user_id THEN s.to_user_id ELSE s.from_user_id END AS right_id,
           'user'::participant_kind AS left_kind,
           'user'::participant_kind AS right_kind,
           CASE WHEN s.from_user_id < s.to_user_id THEN -s.amount_cents ELSE s.amount_cents END AS amount
      FROM public.settlements s
     WHERE s.group_id = p_group_id AND s.status = 'confirmed'
  ),
  combined AS (
    SELECT d.left_id,
           d.right_id,
           MAX(d.left_kind) AS left_kind,
           MAX(d.right_kind) AS right_kind,
           SUM(d.amount) AS net
      FROM (
        SELECT left_id, right_id, left_kind, right_kind, amount FROM normalized
        UNION ALL
        SELECT left_id, right_id, left_kind, right_kind, amount FROM settlement_deltas
      ) d
     GROUP BY d.left_id, d.right_id
  )
  SELECT (CASE WHEN c.net > 0 THEN c.left_kind ELSE c.right_kind END)::participant_kind,
         (CASE WHEN c.net > 0 THEN c.left_id ELSE c.right_id END)::uuid,
         (CASE WHEN c.net > 0 THEN c.right_id ELSE c.left_id END)::uuid,
         (CASE WHEN c.net > 0 THEN c.net ELSE -c.net END)::bigint
    FROM combined c
   WHERE c.net <> 0
   ORDER BY 1, 2, 3;
END;
$$;

-- ---- 02_grants.sql ----
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM public, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA guest_credentials FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM public, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA guest_credentials TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA guest_credentials TO service_role;

-- ---- 03_rpc_read.sql ----
CREATE FUNCTION public.ledger_user_profile_json(p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object('id', u.id, 'handle', u.handle, 'name', u.name, 'avatarUrl', u.avatar_url)
    INTO v_out
    FROM users u
    WHERE u.id = p_user_id;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.ledger_me_json(p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', u.id,
    'handle', u.handle,
    'name', u.name,
    'avatarUrl', u.avatar_url,
    'email', u.email,
    'pixKeyType', u.pix_key_type,
    'pixKeyHint', u.pix_key_hint,
    'onboarded', u.onboarded,
    'notificationPreferences', u.notification_preferences
  ) INTO v_out
  FROM users u
  WHERE u.id = p_user_id;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.ledger_settlement_json(p_settlement_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', s.id,
    'operationId', s.operation_id,
    'groupId', s.group_id,
    'fromUserId', s.from_user_id,
    'toUserId', s.to_user_id,
    'amountCents', s.amount_cents,
    'status', s.status,
    'createdBy', s.created_by,
    'createdAt', to_jsonb(s.created_at),
    'confirmedAt', to_jsonb(s.confirmed_at),
    'voidedAt', to_jsonb(s.voided_at),
    'voidedBy', s.voided_by
  ) INTO v_out
  FROM settlements s
  WHERE s.id = p_settlement_id;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.ledger_chat_message_json(p_message_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', m.id,
    'clientId', m.client_id,
    'groupId', m.group_id,
    'senderId', m.sender_id,
    'content', m.content,
    'createdAt', to_jsonb(m.created_at),
    'sender', COALESCE(ledger_user_profile_json(m.sender_id), 'null'::jsonb)
  ) INTO v_out
  FROM chat_messages m
  WHERE m.id = p_message_id;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.ledger_expense_version_json(p_expense_id uuid, p_version_no integer) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'expenseId', v.expense_id,
    'versionNo', v.version_no,
    'authorId', v.author_id,
    'createdAt', to_jsonb(v.created_at),
    'occurredOn', to_jsonb(e.occurred_on),
    'title', v.title,
    'merchantName', v.merchant_name,
    'expenseType', v.expense_type,
    'totalCents', v.total_cents,
    'serviceFeeBasisPoints', v.service_fee_bps,
    'fixedFeeCents', v.fixed_fee_cents,
    'payload', v.payload,
    'changeSummary', v.change_summary
  ) INTO v_out
  FROM expense_versions v
  JOIN expenses e ON e.id = v.expense_id
  WHERE v.expense_id = p_expense_id AND v.version_no = p_version_no;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.ledger_expense_summary_json(p_expense_id uuid, p_viewer uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', e.id,
    'groupId', e.group_id,
    'creatorId', e.creator_id,
    'status', e.status,
    'occurredOn', to_jsonb(e.occurred_on),
    'createdAt', to_jsonb(e.created_at),
    'versionNo', e.current_version_no,
    'title', v.title,
    'merchantName', v.merchant_name,
    'expenseType', v.expense_type,
    'totalCents', v.total_cents,
    'myShareCents', COALESCE((
      SELECT ep.share_cents FROM expense_participants ep
      WHERE ep.expense_id = e.id AND ep.user_id = p_viewer
    ), 0),
    'myPaidCents', COALESCE((
      SELECT ep.paid_cents FROM expense_participants ep
      WHERE ep.expense_id = e.id AND ep.user_id = p_viewer
    ), 0),
    'participantCount', CASE WHEN e.status = 'deleted'
      THEN jsonb_array_length(COALESCE(v.payload -> 'participants', '[]'::jsonb))
      ELSE (SELECT count(*)::integer FROM expense_participants ep WHERE ep.expense_id = e.id)
    END
  ) INTO v_out
  FROM expenses e
  JOIN expense_versions v ON v.expense_id = e.id AND v.version_no = e.current_version_no
  WHERE e.id = p_expense_id;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.ledger_event_json(p_event_id bigint) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', ev.id,
    'groupId', ev.group_id,
    'actorId', ev.actor_id,
    'kind', ev.kind,
    'expenseId', ev.expense_id,
    'settlementId', ev.settlement_id,
    'subjectUserId', ev.subject_user_id,
    'payload', ev.payload,
    'createdAt', to_jsonb(ev.created_at),
    'actor', COALESCE(ledger_user_profile_json(ev.actor_id), 'null'::jsonb),
    'expenseTitle', (
      SELECT v.title
      FROM expenses e
      JOIN expense_versions v ON v.expense_id = e.id AND v.version_no = e.current_version_no
      WHERE e.id = ev.expense_id
    )
  ) INTO v_out
  FROM group_events ev
  WHERE ev.id = p_event_id;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.ledger_group_snapshot_json(p_group_id uuid, p_viewer uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
  v_status public.member_status;
BEGIN
  SELECT jsonb_build_object(
    'group', jsonb_build_object(
      'id', g.id,
      'kind', g.kind,
      'name', g.name,
      'creatorId', g.creator_id,
      'dmUserA', g.dm_user_a,
      'dmUserB', g.dm_user_b,
      'ledgerVersion', g.ledger_version,
      'createdAt', to_jsonb(g.created_at)
    ),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'groupId', gm.group_id,
        'userId', gm.user_id,
        'status', gm.status,
        'invitedBy', gm.invited_by,
        'acceptedAt', to_jsonb(gm.accepted_at),
        'user', COALESCE(ledger_user_profile_json(gm.user_id), 'null'::jsonb)
      ) ORDER BY gm.created_at, gm.user_id)
      FROM group_members gm
      WHERE gm.group_id = g.id
    ), '[]'::jsonb),
    'balances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', gb.kind,
        'participantId', gb.participant_id,
        'netCents', gb.net_cents
      ) ORDER BY gb.kind, gb.participant_id)
      FROM group_balances gb
      WHERE gb.group_id = g.id
    ), '[]'::jsonb),
    'guests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', gu.id,
        'displayName', gu.display_name,
        'expenseId', gu.expense_id
      ) ORDER BY gu.created_at, gu.id)
      FROM guests gu
      JOIN expenses e ON e.id = gu.expense_id
      WHERE e.group_id = g.id AND e.status = 'active' AND gu.claimed_by IS NULL
    ), '[]'::jsonb),
    'settlements', COALESCE((
      SELECT jsonb_agg(ledger_settlement_json(s.id) ORDER BY s.created_at DESC, s.id)
      FROM (
        SELECT id, created_at FROM settlements
        WHERE group_id = g.id AND status = 'confirmed'
        ORDER BY created_at DESC, id DESC
        LIMIT 50
      ) s
    ), '[]'::jsonb),
    'recentExpenses', COALESCE((
      SELECT jsonb_agg(ledger_expense_summary_json(e.id, p_viewer) ORDER BY e.created_at DESC, e.id DESC)
      FROM (
        SELECT id, created_at FROM expenses
        WHERE group_id = g.id
        ORDER BY created_at DESC, id DESC
        LIMIT 20
      ) e
    ), '[]'::jsonb),
    'lastEventId', COALESCE((
      SELECT max(ev.id) FROM group_events ev WHERE ev.group_id = g.id
    ), 0),
    'unreadCount', (
      SELECT count(*)::integer FROM chat_messages m
      WHERE m.group_id = g.id
        AND m.sender_id <> p_viewer
        AND m.created_at > COALESCE((
          SELECT cr.last_read_at FROM conversation_reads cr
          WHERE cr.user_id = p_viewer AND cr.group_id = g.id
        ), '-infinity'::timestamptz)
    ),
    'lastMessage', COALESCE((
      SELECT jsonb_build_object('content', m.content, 'senderId', m.sender_id, 'createdAt', to_jsonb(m.created_at))
      FROM chat_messages m
      WHERE m.group_id = g.id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ), 'null'::jsonb),
    'lastActivityAt', to_jsonb(GREATEST(
      g.created_at,
      (SELECT max(ev.created_at) FROM group_events ev WHERE ev.group_id = g.id),
      (SELECT max(m.created_at) FROM chat_messages m WHERE m.group_id = g.id)
    )),
    'expenseCount', (
      SELECT count(*) FROM expenses e
      WHERE e.group_id = g.id AND e.status = 'active'
    ),
    'pairwiseEdges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fromKind', pe.from_kind,
        'fromId', pe.from_id,
        'toId', pe.to_id,
        'amountCents', pe.amount_cents
      ) ORDER BY pe.from_kind, pe.from_id, pe.to_id)
      FROM public.group_pairwise_edges(g.id) pe
    ), '[]'::jsonb)
  ) INTO v_out
  FROM groups g
  WHERE g.id = p_group_id;

  SELECT status INTO v_status
  FROM group_members
  WHERE group_id = p_group_id AND user_id = p_viewer;

  -- An invited user has not consented yet: they see who invited them and
  -- nothing about the group's money or conversation.
  IF v_status = 'invited' THEN
    v_out := v_out
      || jsonb_build_object(
           'members', (
             SELECT COALESCE(jsonb_agg(m ORDER BY m ->> 'userId'), '[]'::jsonb)
             FROM jsonb_array_elements(v_out -> 'members') AS t(m)
             WHERE m ->> 'userId' IN (
               p_viewer::text,
               (SELECT invited_by::text FROM group_members
                WHERE group_id = p_group_id AND user_id = p_viewer)
             )
           ),
           'balances', '[]'::jsonb,
           'guests', '[]'::jsonb,
           'settlements', '[]'::jsonb,
           'pairwiseEdges', '[]'::jsonb,
           'recentExpenses', '[]'::jsonb,
           'expenseCount', 0,
           'unreadCount', 0,
           'lastMessage', 'null'::jsonb
        );
  END IF;

  RETURN v_out;
END;
$$;

CREATE FUNCTION public.bootstrap() RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := current_user_id();
  RETURN jsonb_build_object(
    'me', ledger_me_json(v_user_id),
    'groups', COALESCE((
      SELECT jsonb_agg(snap ORDER BY (snap ->> 'lastActivityAt')::timestamptz DESC)
      FROM (
        SELECT ledger_group_snapshot_json(gm.group_id, v_user_id) AS snap
        FROM group_members gm
        WHERE gm.user_id = v_user_id AND gm.status IN ('invited', 'accepted')
      ) s
    ), '[]'::jsonb),
    'serverTime', to_jsonb(now())
  );
END;
$$;

CREATE FUNCTION public.get_group(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := current_user_id();
  PERFORM assert_member_or_invited(p_group_id, v_user_id);
  RETURN ledger_group_snapshot_json(p_group_id, v_user_id);
END;
$$;

CREATE FUNCTION public.get_group_expenses(p_group_id uuid, p_before timestamptz, p_limit integer DEFAULT 30) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_limit integer;
BEGIN
  v_user_id := current_user_id();
  PERFORM assert_member(p_group_id, v_user_id);
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 30), 100));
  RETURN COALESCE((
    SELECT jsonb_agg(ledger_expense_summary_json(e.id, v_user_id) ORDER BY e.created_at DESC, e.id DESC)
    FROM (
      SELECT id, created_at FROM expenses
      WHERE group_id = p_group_id
        AND created_at < COALESCE(p_before, 'infinity'::timestamptz)
      ORDER BY created_at DESC, id DESC
      LIMIT v_limit
    ) e
  ), '[]'::jsonb);
END;
$$;

CREATE FUNCTION public.get_expense(p_expense_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_group_id uuid;
  v_out jsonb;
BEGIN
  v_user_id := current_user_id();
  SELECT group_id INTO v_group_id FROM expenses WHERE id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_found';
  END IF;
  PERFORM assert_member(v_group_id, v_user_id);
  SELECT jsonb_build_object(
    'expense', jsonb_build_object(
      'id', e.id,
      'groupId', e.group_id,
      'creatorId', e.creator_id,
      'status', e.status,
      'currentVersionNo', e.current_version_no,
      'occurredOn', to_jsonb(e.occurred_on),
      'createdAt', to_jsonb(e.created_at),
      'deletedAt', to_jsonb(e.deleted_at),
      'deletedBy', e.deleted_by
    ),
    'current', ledger_expense_version_json(e.id, e.current_version_no),
    'versions', COALESCE((
      SELECT jsonb_agg(ledger_expense_version_json(v.expense_id, v.version_no) ORDER BY v.version_no DESC)
      FROM expense_versions v
      WHERE v.expense_id = e.id
    ), '[]'::jsonb),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'participantIndex', ep.participant_index,
        'kind', ep.kind,
        'shareCents', ep.share_cents,
        'paidCents', ep.paid_cents,
        'user', COALESCE(ledger_user_profile_json(ep.user_id), 'null'::jsonb),
        'guest', COALESCE((
          SELECT jsonb_build_object('id', gst.id, 'displayName', gst.display_name, 'claimedBy', gst.claimed_by, 'claimLinkGeneration', COALESCE((SELECT ct.generation FROM guest_credentials.claim_tokens ct WHERE ct.guest_id = gst.id), 0))
          FROM guests gst
          WHERE gst.id = ep.guest_id
        ), 'null'::jsonb)
      ) ORDER BY ep.participant_index ASC)
      FROM expense_participants ep
      WHERE ep.expense_id = e.id
    ), '[]'::jsonb),
    'group', (
      SELECT jsonb_build_object('id', gg.id, 'name', gg.name, 'kind', gg.kind)
      FROM groups gg
      WHERE gg.id = e.group_id
    )
  ) INTO v_out
  FROM expenses e
  WHERE e.id = p_expense_id;
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.get_activity(p_before_id bigint, p_limit integer DEFAULT 50) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_limit integer;
BEGIN
  v_user_id := current_user_id();
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  RETURN COALESCE((
    SELECT jsonb_agg(ledger_event_json(ev.id) ORDER BY ev.id DESC)
    FROM (
      SELECT ev.id
      FROM group_events ev
      WHERE (p_before_id IS NULL OR ev.id < p_before_id)
        AND ev.group_id IN (
          SELECT gm.group_id FROM group_members gm
          WHERE gm.user_id = v_user_id AND gm.status = 'accepted'
        )
      ORDER BY ev.id DESC
      LIMIT v_limit
    ) ev
  ), '[]'::jsonb);
END;
$$;

CREATE FUNCTION public.get_conversation(p_group_id uuid, p_before timestamptz, p_limit integer DEFAULT 50) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_limit integer;
BEGIN
  v_user_id := current_user_id();
  PERFORM assert_member(p_group_id, v_user_id);
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  RETURN jsonb_build_object(
    'messages', COALESCE((
      SELECT jsonb_agg(ledger_chat_message_json(m.id) ORDER BY m.created_at DESC, m.id DESC)
      FROM (
        SELECT id, created_at FROM chat_messages
        WHERE group_id = p_group_id
          AND created_at < COALESCE(p_before, 'infinity'::timestamptz)
        ORDER BY created_at DESC, id DESC
        LIMIT v_limit
      ) m
    ), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(ledger_event_json(ev.id) ORDER BY ev.created_at DESC, ev.id DESC)
      FROM (
        SELECT id, created_at FROM group_events
        WHERE group_id = p_group_id
          AND created_at < COALESCE(p_before, 'infinity'::timestamptz)
        ORDER BY created_at DESC, id DESC
        LIMIT v_limit
      ) ev
    ), '[]'::jsonb)
  );
END;
$$;

CREATE FUNCTION public.get_my_profile() RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := current_user_id();
  RETURN ledger_me_json(v_user_id);
END;
$$;

CREATE FUNCTION public.lookup_user_by_handle(p_handle text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT COALESCE(ledger_user_profile_json(u.id), 'null'::jsonb) INTO v_out
  FROM users u
  WHERE u.handle = lower(trim(p_handle));
  RETURN COALESCE(v_out, 'null'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.ledger_user_profile_json(uuid) FROM public;
REVOKE ALL ON FUNCTION public.ledger_me_json(uuid) FROM public;
REVOKE ALL ON FUNCTION public.ledger_settlement_json(uuid) FROM public;
REVOKE ALL ON FUNCTION public.ledger_chat_message_json(uuid) FROM public;
REVOKE ALL ON FUNCTION public.ledger_expense_version_json(uuid, integer) FROM public;
REVOKE ALL ON FUNCTION public.ledger_expense_summary_json(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.ledger_event_json(bigint) FROM public;
REVOKE ALL ON FUNCTION public.ledger_group_snapshot_json(uuid, uuid) FROM public;

REVOKE ALL ON FUNCTION public.bootstrap() FROM public;
GRANT EXECUTE ON FUNCTION public.bootstrap() TO authenticated;
REVOKE ALL ON FUNCTION public.get_group(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_group(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_group_expenses(uuid, timestamptz, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_group_expenses(uuid, timestamptz, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_expense(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_expense(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_activity(bigint, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_activity(bigint, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_conversation(uuid, timestamptz, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_conversation(uuid, timestamptz, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_profile() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
REVOKE ALL ON FUNCTION public.lookup_user_by_handle(text) FROM public;
GRANT EXECUTE ON FUNCTION public.lookup_user_by_handle(text) TO authenticated;

-- ---- 04_rpc_expense.sql ----
CREATE FUNCTION public.create_expense(
  p_client_id uuid, p_group_id uuid, p_occurred_on date,
  p_title text, p_merchant_name text, p_expense_type expense_type,
  p_total_cents integer, p_service_fee_bps integer, p_fixed_fee_cents integer,
  p_payload jsonb
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_title text;
  v_payload jsonb;
  v_expense_id uuid;
  v_existing_id uuid;
  v_existing_group_id uuid;
  v_existing_status public.expense_status;
  v_existing_version_no integer;
  v_existing_ledger_version bigint;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  SELECT id, group_id, status, current_version_no
    INTO v_existing_id, v_existing_group_id, v_existing_status, v_existing_version_no
  FROM expenses WHERE client_id = p_client_id;
  IF v_existing_id IS NOT NULL THEN
    IF v_existing_status = 'deleted' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
    END IF;
    IF v_existing_group_id <> p_group_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    SELECT ledger_version INTO v_existing_ledger_version FROM groups WHERE id = p_group_id;
    RETURN jsonb_build_object(
      'expenseId', v_existing_id,
      'groupId', p_group_id,
      'versionNo', v_existing_version_no,
      'ledgerVersion', v_existing_ledger_version,
      'eventId', NULL
    );
  END IF;

  v_title := btrim(p_title);
  IF v_title IS NULL OR length(v_title) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_merchant_name IS NOT NULL AND length(btrim(p_merchant_name)) > 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_occurred_on IS NULL OR p_expense_type IS NULL OR p_client_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_total_cents IS NULL OR p_total_cents NOT BETWEEN 1 AND 99999999
     OR p_service_fee_bps IS NULL OR p_service_fee_bps NOT BETWEEN 0 AND 10000
     OR p_fixed_fee_cents IS NULL OR p_fixed_fee_cents NOT BETWEEN 0 AND 99999999
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  v_payload := validate_expense_payload(p_payload, p_expense_type, p_total_cents, p_service_fee_bps, p_fixed_fee_cents);

  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_payload->'participants') AS pp(p)
    WHERE pp.p->>'kind' = 'user' AND (pp.p->>'userId')::uuid = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'creator_not_participant';
  END IF;

  BEGIN
    INSERT INTO expenses (client_id, group_id, creator_id, occurred_on)
    VALUES (p_client_id, p_group_id, v_actor, p_occurred_on)
    RETURNING id INTO v_expense_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- A concurrent create in another group won the global client_id race;
      -- surface the same domain error as the sequential wrong-group path.
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END;

  v_payload := materialize_participants(v_expense_id, v_actor, v_payload);

  INSERT INTO expense_versions (
    expense_id, version_no, author_id, title, merchant_name, expense_type,
    total_cents, service_fee_bps, fixed_fee_cents, payload, change_summary
  ) VALUES (
    v_expense_id, 1, v_actor, v_title, btrim(p_merchant_name), p_expense_type,
    p_total_cents, p_service_fee_bps, p_fixed_fee_cents, v_payload, NULL
  );

  v_ledger_version := recompute_group_balances(p_group_id);
  v_event_id := emit_event(
    p_group_id, 'expense_created', v_actor, v_expense_id,
    NULL, NULL, jsonb_build_object('title', v_title, 'totalCents', p_total_cents)
  );
  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', v_expense_id,
    'groupId', p_group_id,
    'versionNo', 1,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

CREATE FUNCTION public.edit_expense(
  p_expense_id uuid, p_expected_version_no integer,
  p_occurred_on date, p_title text, p_merchant_name text, p_expense_type expense_type,
  p_total_cents integer, p_service_fee_bps integer, p_fixed_fee_cents integer,
  p_payload jsonb
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_group_id uuid;
  v_creator_id uuid;
  v_status public.expense_status;
  v_current_version_no integer;
  v_new_version_no integer;
  v_title text;
  v_payload jsonb;
  v_change_summary jsonb;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  SELECT group_id INTO v_group_id FROM expenses WHERE id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_found';
  END IF;

  PERFORM lock_group(v_group_id);
  PERFORM assert_member(v_group_id, v_actor);

  -- Re-read under the lock: an unlocked read lets two racing edits both pass
  -- the version check and collide on expense_versions_pkey.
  SELECT status, current_version_no, creator_id
    INTO v_status, v_current_version_no, v_creator_id
  FROM expenses WHERE id = p_expense_id;

  IF v_creator_id IS DISTINCT FROM v_actor AND NOT EXISTS (
    SELECT 1 FROM expense_participants
    WHERE expense_id = p_expense_id AND kind = 'user' AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_expense_party';
  END IF;

  IF v_status = 'deleted' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
  END IF;
  IF p_expected_version_no IS NULL OR v_current_version_no <> p_expected_version_no THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_version';
  END IF;

  v_title := btrim(p_title);
  IF v_title IS NULL OR length(v_title) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_merchant_name IS NOT NULL AND length(btrim(p_merchant_name)) > 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_occurred_on IS NULL OR p_expense_type IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_total_cents IS NULL OR p_total_cents NOT BETWEEN 1 AND 99999999
     OR p_service_fee_bps IS NULL OR p_service_fee_bps NOT BETWEEN 0 AND 10000
     OR p_fixed_fee_cents IS NULL OR p_fixed_fee_cents NOT BETWEEN 0 AND 99999999
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  v_payload := validate_expense_payload(p_payload, p_expense_type, p_total_cents, p_service_fee_bps, p_fixed_fee_cents);

  v_new_version_no := v_current_version_no + 1;
  v_payload := materialize_participants(p_expense_id, v_actor, v_payload);

  INSERT INTO expense_versions (
    expense_id, version_no, author_id, title, merchant_name, expense_type,
    total_cents, service_fee_bps, fixed_fee_cents, payload, change_summary
  ) VALUES (
    p_expense_id, v_new_version_no, v_actor, v_title, btrim(p_merchant_name), p_expense_type,
    p_total_cents, p_service_fee_bps, p_fixed_fee_cents, v_payload, NULL
  );

  v_change_summary := expense_change_summary(p_expense_id, v_current_version_no, v_new_version_no);
  UPDATE expense_versions SET change_summary = v_change_summary
  WHERE expense_id = p_expense_id AND version_no = v_new_version_no;

  UPDATE expenses SET occurred_on = p_occurred_on, current_version_no = v_new_version_no
  WHERE id = p_expense_id;

  v_ledger_version := recompute_group_balances(v_group_id);
  v_event_id := emit_event(v_group_id, 'expense_edited', v_actor, p_expense_id, NULL, NULL, v_change_summary);
  PERFORM broadcast_group(v_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', p_expense_id,
    'groupId', v_group_id,
    'versionNo', v_new_version_no,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

CREATE FUNCTION public.delete_expense(p_expense_id uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_group_id uuid;
  v_creator_id uuid;
  v_status public.expense_status;
  v_version_no integer;
  v_title text;
  v_total_cents integer;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  SELECT group_id INTO v_group_id FROM expenses WHERE id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_found';
  END IF;

  PERFORM lock_group(v_group_id);
  PERFORM assert_member(v_group_id, v_actor);

  SELECT status, current_version_no, creator_id
    INTO v_status, v_version_no, v_creator_id
  FROM expenses WHERE id = p_expense_id;

  IF v_creator_id IS DISTINCT FROM v_actor AND NOT EXISTS (
    SELECT 1 FROM expense_participants
    WHERE expense_id = p_expense_id AND kind = 'user' AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_expense_party';
  END IF;

  IF v_status = 'deleted' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
  END IF;

  UPDATE expenses SET status = 'deleted', deleted_at = now(), deleted_by = v_actor
  WHERE id = p_expense_id;
  DELETE FROM expense_participants WHERE expense_id = p_expense_id;

  SELECT title, total_cents INTO v_title, v_total_cents
  FROM expense_versions
  WHERE expense_id = p_expense_id AND version_no = v_version_no;

  v_ledger_version := recompute_group_balances(v_group_id);
  v_event_id := emit_event(
    v_group_id, 'expense_deleted', v_actor, p_expense_id,
    NULL, NULL, jsonb_build_object('title', v_title, 'totalCents', v_total_cents)
  );
  PERFORM broadcast_group(v_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', p_expense_id,
    'groupId', v_group_id,
    'versionNo', v_version_no,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

CREATE FUNCTION public.restore_expense(p_expense_id uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_group_id uuid;
  v_creator_id uuid;
  v_status public.expense_status;
  v_version_no integer;
  v_title text;
  v_total_cents integer;
  v_payload jsonb;
  v_materialized jsonb;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  SELECT group_id INTO v_group_id FROM expenses WHERE id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_found';
  END IF;

  PERFORM lock_group(v_group_id);
  PERFORM assert_member(v_group_id, v_actor);

  SELECT status, current_version_no, creator_id
    INTO v_status, v_version_no, v_creator_id
  FROM expenses WHERE id = p_expense_id;

  SELECT payload, title, total_cents INTO v_payload, v_title, v_total_cents
  FROM expense_versions
  WHERE expense_id = p_expense_id AND version_no = v_version_no;

  -- delete_expense empties expense_participants, so authorization for restore
  -- must come from the stored version payload, not the live rows.
  IF v_creator_id IS DISTINCT FROM v_actor AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(v_payload->'participants', '[]'::jsonb)) AS pp(p)
    WHERE pp.p->>'kind' = 'user' AND pp.p ? 'userId'
      AND pp.p->>'userId' = v_actor::text
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_expense_party';
  END IF;

  IF v_status = 'active' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_deleted';
  END IF;

  UPDATE expenses SET status = 'active', deleted_at = NULL, deleted_by = NULL
  WHERE id = p_expense_id;

  v_materialized := materialize_participants(p_expense_id, v_actor, v_payload);
  IF v_materialized IS DISTINCT FROM v_payload THEN
    UPDATE expense_versions SET payload = v_materialized
    WHERE expense_id = p_expense_id AND version_no = v_version_no;
  END IF;

  v_ledger_version := recompute_group_balances(v_group_id);
  v_event_id := emit_event(
    v_group_id, 'expense_restored', v_actor, p_expense_id,
    NULL, NULL, jsonb_build_object('title', v_title, 'totalCents', v_total_cents)
  );
  PERFORM broadcast_group(v_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', p_expense_id,
    'groupId', v_group_id,
    'versionNo', v_version_no,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_expense(uuid, uuid, date, text, text, expense_type, integer, integer, integer, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.create_expense(uuid, uuid, date, text, text, expense_type, integer, integer, integer, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.edit_expense(uuid, integer, date, text, text, expense_type, integer, integer, integer, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.edit_expense(uuid, integer, date, text, text, expense_type, integer, integer, integer, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_expense(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_expense(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.restore_expense(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.restore_expense(uuid) TO authenticated;

-- ---- 05_rpc_settlement.sql ----
CREATE FUNCTION public.record_settlement(
  p_operation_id uuid,
  p_group_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_amount_cents integer
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_existing RECORD;
  v_settlement_id uuid;
  v_ledger_version bigint;
  v_from_net bigint;
  v_to_net bigint;
  v_event_id bigint;
  v_subject_user_id uuid;
BEGIN
  v_actor := current_user_id();

  IF p_operation_id IS NULL OR p_group_id IS NULL
     OR p_from_user_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF v_actor <> p_from_user_id AND v_actor <> p_to_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_party';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents < 1 OR p_amount_cents > 99999999 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  SELECT * INTO v_existing FROM settlements WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.from_user_id <> p_from_user_id OR v_existing.group_id <> p_group_id
       OR v_existing.to_user_id <> p_to_user_id OR v_existing.amount_cents <> p_amount_cents THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    IF v_existing.status = 'voided' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'settlement_voided';
    END IF;

    SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;
    RETURN jsonb_build_object(
      'settlementId', v_existing.id,
      'groupId', v_existing.group_id,
      'ledgerVersion', v_ledger_version,
      'eventId', NULL
    );
  END IF;

  IF NOT is_member(p_group_id, CASE WHEN v_actor = p_from_user_id THEN p_to_user_id ELSE p_from_user_id END) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'counterparty_not_member';
  END IF;

  SELECT COALESCE((
    SELECT net_cents FROM group_balances
    WHERE group_id = p_group_id AND kind = 'user' AND participant_id = p_from_user_id
  ), 0) INTO v_from_net;
  SELECT COALESCE((
    SELECT net_cents FROM group_balances
    WHERE group_id = p_group_id AND kind = 'user' AND participant_id = p_to_user_id
  ), 0) INTO v_to_net;

  IF v_from_net >= 0 OR p_amount_cents > -v_from_net
     OR v_to_net <= 0 OR p_amount_cents > v_to_net THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'amount_exceeds_debt';
  END IF;

  INSERT INTO settlements (operation_id, group_id, from_user_id, to_user_id, amount_cents, status, confirmed_at, created_by)
  VALUES (p_operation_id, p_group_id, p_from_user_id, p_to_user_id, p_amount_cents, 'confirmed', now(), v_actor)
  RETURNING id INTO v_settlement_id;

  v_ledger_version := recompute_group_balances(p_group_id);

  v_subject_user_id := CASE WHEN v_actor = p_from_user_id THEN p_to_user_id ELSE p_from_user_id END;

  v_event_id := emit_event(
    p_group_id,
    'settlement_recorded',
    v_actor,
    p_settlement_id => v_settlement_id,
    p_subject_user_id => v_subject_user_id,
    p_payload => jsonb_build_object('amountCents', p_amount_cents, 'fromUserId', p_from_user_id, 'toUserId', p_to_user_id)
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'settlementId', v_settlement_id,
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

CREATE FUNCTION public.void_settlement(p_settlement_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_s RECORD;
  v_ledger_version bigint;
  v_event_id bigint;
  v_other_party uuid;
BEGIN
  v_actor := current_user_id();

  IF p_settlement_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'settlement_not_found';
  END IF;

  SELECT * INTO v_s FROM settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'settlement_not_found';
  END IF;

  PERFORM lock_group(v_s.group_id);

  SELECT * INTO v_s FROM settlements WHERE id = p_settlement_id FOR UPDATE;

  IF v_actor <> v_s.from_user_id AND v_actor <> v_s.to_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_party';
  END IF;

  PERFORM assert_member(v_s.group_id, v_actor);

  v_other_party := CASE WHEN v_actor = v_s.from_user_id THEN v_s.to_user_id ELSE v_s.from_user_id END;

  IF v_s.status = 'voided' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'settlement_voided';
  END IF;

  UPDATE settlements
  SET status = 'voided', voided_at = now(), voided_by = v_actor
  WHERE id = p_settlement_id;

  v_ledger_version := recompute_group_balances(v_s.group_id);

  v_event_id := emit_event(
    v_s.group_id,
    'settlement_voided',
    v_actor,
    p_settlement_id => p_settlement_id,
    p_subject_user_id => v_other_party,
    p_payload => jsonb_build_object(
      'amountCents', v_s.amount_cents,
      'fromUserId', v_s.from_user_id,
      'toUserId', v_s.to_user_id
    )
  );

  PERFORM broadcast_group(v_s.group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'settlementId', p_settlement_id,
    'groupId', v_s.group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_settlement(uuid, uuid, uuid, uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.record_settlement(uuid, uuid, uuid, uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.void_settlement(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.void_settlement(uuid) TO authenticated;

-- ---- 06_rpc_group.sql ----
CREATE FUNCTION public.create_group(p_name text, p_member_ids uuid[]) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_name text;
  v_clean_member_ids uuid[];
  v_group_id uuid;
  v_ledger_version bigint;
  v_event_id bigint;
  v_subject_user_id uuid;
BEGIN
  v_actor := current_user_id();

  v_name := btrim(p_name);
  IF v_name IS NULL OR length(v_name) < 1 OR length(v_name) > 80 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_name';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::uuid[])
  INTO v_clean_member_ids
  FROM unnest(COALESCE(p_member_ids, ARRAY[]::uuid[])) AS u
  WHERE u <> v_actor;

  IF COALESCE(array_length(v_clean_member_ids, 1), 0) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM unnest(v_clean_member_ids) AS u
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = u)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
    END IF;
  END IF;

  INSERT INTO groups (kind, name, creator_id)
  VALUES ('group', v_name, v_actor)
  RETURNING id, ledger_version INTO v_group_id, v_ledger_version;

  INSERT INTO group_members (group_id, user_id, status, accepted_at)
  VALUES (v_group_id, v_actor, 'accepted', now());

  IF COALESCE(array_length(v_clean_member_ids, 1), 0) > 0 THEN
    INSERT INTO group_members (group_id, user_id, status, invited_by)
    SELECT v_group_id, u, 'invited', v_actor
    FROM unnest(v_clean_member_ids) AS u;

    v_subject_user_id := CASE WHEN array_length(v_clean_member_ids, 1) = 1 THEN v_clean_member_ids[1] ELSE NULL END;
    v_event_id := emit_event(
      v_group_id,
      'member_invited',
      v_actor,
      p_subject_user_id => v_subject_user_id,
      p_payload => jsonb_build_object('userIds', to_jsonb(v_clean_member_ids))
    );
    PERFORM broadcast_group(v_group_id, v_ledger_version, v_event_id);
    PERFORM broadcast_user(u, v_group_id) FROM unnest(v_clean_member_ids) AS u;
  ELSE
    v_event_id := NULL;
  END IF;

  RETURN jsonb_build_object(
    'groupId', v_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

CREATE FUNCTION public.invite_member(p_group_id uuid, p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;

  SELECT status INTO v_status FROM group_members WHERE group_id = p_group_id AND user_id = p_user_id;
  IF FOUND THEN
    IF v_status = 'accepted' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_member';
    ELSIF v_status = 'invited' THEN
      SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;
      RETURN jsonb_build_object(
        'groupId', p_group_id,
        'ledgerVersion', v_ledger_version,
        'eventId', NULL
      );
    END IF;
  END IF;

  INSERT INTO group_members (group_id, user_id, status, invited_by)
  VALUES (p_group_id, p_user_id, 'invited', v_actor);

  SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;

  v_event_id := emit_event(
    p_group_id,
    'member_invited',
    v_actor,
    p_subject_user_id => p_user_id,
    p_payload => jsonb_build_object('userIds', jsonb_build_array(p_user_id))
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);
  PERFORM broadcast_user(p_user_id, p_group_id);

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

CREATE FUNCTION public.accept_invitation(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_event_id bigint;
  v_invited_by uuid;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

  SELECT status, invited_by INTO v_status, v_invited_by FROM group_members
  WHERE group_id = p_group_id AND user_id = v_actor
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'invited' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_invited';
  END IF;

  UPDATE group_members
  SET status = 'accepted', accepted_at = now()
  WHERE group_id = p_group_id AND user_id = v_actor;

  SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;

  v_event_id := emit_event(
    p_group_id,
    'member_joined',
    v_actor,
    p_subject_user_id => v_actor,
    p_payload => '{}'::jsonb
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);
  IF v_invited_by IS NOT NULL THEN
    PERFORM broadcast_user(v_invited_by, p_group_id);
  END IF;

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

CREATE FUNCTION public.decline_invitation(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_invited_by uuid;
  v_kind group_kind;
  v_expense_id uuid;
  v_title text;
  v_total_cents integer;
  v_event_id bigint;
  v_invalidated boolean := false;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

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
    DELETE FROM groups WHERE id = p_group_id;
  ELSE
    FOR v_expense_id, v_title, v_total_cents IN
      WITH declined_expenses AS (
        UPDATE expenses e
        SET status = 'deleted', deleted_at = now(), deleted_by = v_actor
        WHERE e.group_id = p_group_id
          AND e.status = 'active'
          AND EXISTS (
            SELECT 1 FROM expense_participants p
            WHERE p.expense_id = e.id AND p.user_id = v_actor
          )
        RETURNING e.id, e.current_version_no
      )
      SELECT d.id, ev.title, ev.total_cents
      FROM declined_expenses d
      JOIN expense_versions ev
        ON ev.expense_id = d.id AND ev.version_no = d.current_version_no
    LOOP
      DELETE FROM expense_participants WHERE expense_id = v_expense_id;
      v_event_id := emit_event(
        p_group_id, 'expense_deleted', v_actor, v_expense_id,
        NULL, NULL, jsonb_build_object('title', v_title, 'totalCents', v_total_cents)
      );
      v_invalidated := true;
    END LOOP;

    IF v_invalidated THEN
      v_ledger_version := recompute_group_balances(p_group_id);
      PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);
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
$$;

CREATE FUNCTION public.leave_group(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

CREATE FUNCTION public.remove_member(p_group_id uuid, p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

CREATE FUNCTION public.delete_group(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_creator_id uuid;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

  SELECT creator_id INTO v_creator_id FROM groups WHERE id = p_group_id;
  IF v_creator_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_creator';
  END IF;

  IF EXISTS (SELECT 1 FROM group_balances WHERE group_id = p_group_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'outstanding_balance';
  END IF;

  IF (SELECT count(*) FROM group_members WHERE group_id = p_group_id) > 1
     AND (EXISTS (SELECT 1 FROM expenses WHERE group_id = p_group_id)
          OR EXISTS (SELECT 1 FROM settlements WHERE group_id = p_group_id)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'group_has_history';
  END IF;

  DELETE FROM groups WHERE id = p_group_id;

  RETURN jsonb_build_object('groupId', p_group_id);
END;
$$;

CREATE FUNCTION public.get_or_create_dm(p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_user_a uuid;
  v_user_b uuid;
  v_group_id uuid;
  v_ledger_version bigint;
  v_created boolean;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_user_id IS NULL OR p_user_id = v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;

  v_user_a := LEAST(v_actor, p_user_id);
  v_user_b := GREATEST(v_actor, p_user_id);

  INSERT INTO groups (kind, name, creator_id, dm_user_a, dm_user_b)
  VALUES ('dm', '', v_actor, v_user_a, v_user_b)
  ON CONFLICT (dm_user_a, dm_user_b) DO NOTHING
  RETURNING id, ledger_version INTO v_group_id, v_ledger_version;

  IF v_group_id IS NOT NULL THEN
    v_created := true;
    INSERT INTO group_members (group_id, user_id, status, accepted_at)
    VALUES (v_group_id, v_actor, 'accepted', now());

    INSERT INTO group_members (group_id, user_id, status, invited_by)
    VALUES (v_group_id, p_user_id, 'invited', v_actor);

    v_event_id := emit_event(
      v_group_id,
      'member_invited',
      v_actor,
      p_subject_user_id => p_user_id,
      p_payload => jsonb_build_object('userIds', jsonb_build_array(p_user_id))
    );

    PERFORM broadcast_user(p_user_id, v_group_id);
  ELSE
    v_created := false;
    SELECT id, ledger_version INTO v_group_id, v_ledger_version
    FROM groups
    WHERE dm_user_a = v_user_a AND dm_user_b = v_user_b;
  END IF;

  RETURN jsonb_build_object(
    'groupId', v_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id,
    'created', v_created
  );
END;
$$;

CREATE FUNCTION public.create_invite_link(
  p_group_id uuid,
  p_expires_at timestamptz DEFAULT NULL,
  p_max_uses integer DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_kind group_kind;
  v_token text;
  v_expires_at timestamptz;
  v_max_uses integer;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  SELECT kind INTO v_kind FROM groups WHERE id = p_group_id;
  IF v_kind = 'dm' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
  END IF;

  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  UPDATE group_invite_links
  SET is_active = false
  WHERE group_id = p_group_id AND is_active = true;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');

  INSERT INTO group_invite_links (group_id, token, created_by, is_active, expires_at, max_uses)
  VALUES (p_group_id, v_token, v_actor, true, p_expires_at, p_max_uses)
  RETURNING token, expires_at, max_uses INTO v_token, v_expires_at, v_max_uses;

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'token', v_token,
    'expiresAt', to_jsonb(v_expires_at),
    'maxUses', v_max_uses
  );
END;
$$;

CREATE FUNCTION public.deactivate_invite_link(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  UPDATE group_invite_links
  SET is_active = false
  WHERE group_id = p_group_id AND is_active = true;

  RETURN jsonb_build_object('groupId', p_group_id);
END;
$$;

CREATE FUNCTION public.preview_invite_link(p_token text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_link RECORD;
  v_group RECORD;
  v_creator_name text;
  v_member_count integer;
  v_is_valid boolean;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object(
      'groupName', NULL,
      'memberCount', NULL,
      'creatorName', NULL,
      'valid', false
    );
  END IF;

  SELECT * INTO v_link FROM group_invite_links WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'groupName', NULL,
      'memberCount', NULL,
      'creatorName', NULL,
      'valid', false
    );
  END IF;

  v_is_valid := v_link.is_active
    AND (v_link.expires_at IS NULL OR v_link.expires_at > now())
    AND (v_link.max_uses IS NULL OR v_link.use_count < v_link.max_uses);

  IF NOT v_is_valid THEN
    RETURN jsonb_build_object(
      'groupName', NULL,
      'memberCount', NULL,
      'creatorName', NULL,
      'valid', false
    );
  END IF;

  SELECT * INTO v_group FROM groups WHERE id = v_link.group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'groupName', NULL,
      'memberCount', NULL,
      'creatorName', NULL,
      'valid', false
    );
  END IF;

  SELECT name INTO v_creator_name FROM users WHERE id = v_link.created_by;
  SELECT count(*)::integer INTO v_member_count
  FROM group_members
  WHERE group_id = v_link.group_id AND status = 'accepted';

  RETURN jsonb_build_object(
    'groupName', v_group.name,
    'memberCount', v_member_count,
    'creatorName', v_creator_name,
    'valid', true
  );
END;
$$;

CREATE FUNCTION public.join_via_link(p_token text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_link RECORD;
  v_status member_status;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_link';
  END IF;

  SELECT * INTO v_link FROM group_invite_links WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_link';
  END IF;

  PERFORM lock_group(v_link.group_id);

  SELECT * INTO v_link FROM group_invite_links WHERE id = v_link.id FOR UPDATE;

  IF NOT v_link.is_active
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now())
     OR (v_link.max_uses IS NOT NULL AND v_link.use_count >= v_link.max_uses)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_link';
  END IF;

  SELECT status INTO v_status FROM group_members
  WHERE group_id = v_link.group_id AND user_id = v_actor
  FOR UPDATE;

  IF FOUND AND v_status = 'accepted' THEN
    SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = v_link.group_id;
    RETURN jsonb_build_object(
      'groupId', v_link.group_id,
      'ledgerVersion', v_ledger_version,
      'eventId', NULL
    );
  END IF;

  UPDATE group_invite_links
  SET use_count = use_count + 1
  WHERE id = v_link.id;

  IF FOUND AND v_status = 'invited' THEN
    UPDATE group_members
    SET status = 'accepted', accepted_at = now()
    WHERE group_id = v_link.group_id AND user_id = v_actor;
  ELSE
    INSERT INTO group_members (group_id, user_id, status, accepted_at)
    VALUES (v_link.group_id, v_actor, 'accepted', now());
  END IF;

  SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = v_link.group_id;

  v_event_id := emit_event(
    v_link.group_id,
    'member_joined',
    v_actor,
    p_subject_user_id => v_actor,
    p_payload => '{}'::jsonb
  );

  PERFORM broadcast_group(v_link.group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'groupId', v_link.group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

CREATE FUNCTION public.update_profile(
  p_name text DEFAULT NULL,
  p_handle text DEFAULT NULL,
  p_notification_preferences jsonb DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_name text;
  v_handle text;
  v_user users;
BEGIN
  v_actor := current_user_id();

  IF p_name IS NOT NULL THEN
    v_name := btrim(p_name);
    IF length(v_name) < 1 OR length(v_name) > 80 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_name';
    END IF;
  END IF;

  IF p_handle IS NOT NULL THEN
    v_handle := lower(btrim(p_handle));
    IF v_handle !~ '^[a-z0-9_]{3,30}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_handle';
    END IF;
    IF EXISTS (SELECT 1 FROM users WHERE handle = v_handle AND id <> v_actor) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'handle_taken';
    END IF;
  END IF;

  IF p_notification_preferences IS NOT NULL THEN
    IF jsonb_typeof(p_notification_preferences) <> 'object' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_notification_preferences';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_notification_preferences) AS k(key)
      WHERE k.key NOT IN ('expenses', 'settlements', 'nudges', 'groups', 'messages')
        OR jsonb_typeof(p_notification_preferences -> k.key) <> 'boolean'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_notification_preferences';
    END IF;
  END IF;

  UPDATE users
  SET
    name = COALESCE(v_name, name),
    handle = COALESCE(v_handle, handle),
    notification_preferences = notification_preferences || COALESCE(p_notification_preferences, '{}'::jsonb),
    onboarded = true,
    updated_at = now()
  WHERE id = v_actor
  RETURNING * INTO v_user;

  RETURN jsonb_build_object(
    'id', v_user.id,
    'handle', v_user.handle,
    'name', v_user.name,
    'avatarUrl', v_user.avatar_url,
    'email', v_user.email,
    'pixKeyType', v_user.pix_key_type,
    'pixKeyHint', v_user.pix_key_hint,
    'onboarded', v_user.onboarded,
    'notificationPreferences', v_user.notification_preferences
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_group(text, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.create_group(text, uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.invite_member(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.invite_member(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.accept_invitation(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_invitation(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.decline_invitation(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.decline_invitation(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.leave_group(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.leave_group(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.remove_member(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.remove_member(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_group(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_group(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_or_create_dm(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_invite_link(uuid, timestamptz, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.create_invite_link(uuid, timestamptz, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.deactivate_invite_link(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.deactivate_invite_link(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.preview_invite_link(text) FROM public;
GRANT EXECUTE ON FUNCTION public.preview_invite_link(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.join_via_link(text) FROM public;
GRANT EXECUTE ON FUNCTION public.join_via_link(text) TO authenticated;

REVOKE ALL ON FUNCTION public.update_profile(text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.update_profile(text, text, jsonb) TO authenticated;

-- ---- 07_rpc_chat.sql ----
CREATE FUNCTION public.send_message(p_client_id uuid, p_group_id uuid, p_content text)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_content text;
  v_existing_id uuid;
  v_existing_sender uuid;
  v_existing_group uuid;
  v_message_id uuid;
  v_result jsonb;
BEGIN
  v_actor := current_user_id();

  IF p_client_id IS NULL OR p_group_id IS NULL OR p_content IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  v_content := trim(p_content);
  IF length(v_content) < 1 OR length(v_content) > 2000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM assert_member(p_group_id, v_actor);

  SELECT id, sender_id, group_id INTO v_existing_id, v_existing_sender, v_existing_group
  FROM chat_messages
  WHERE client_id = p_client_id;

  IF FOUND THEN
    IF v_existing_sender <> v_actor OR v_existing_group <> p_group_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    RETURN public.ledger_chat_message_json(v_existing_id);
  END IF;

  -- Concurrent retries of the same client_id must both resolve to one row.
  INSERT INTO chat_messages (client_id, group_id, sender_id, content)
  VALUES (p_client_id, p_group_id, v_actor, v_content)
  ON CONFLICT (client_id) DO NOTHING
  RETURNING id INTO v_message_id;

  IF v_message_id IS NULL THEN
    SELECT id, sender_id, group_id INTO v_existing_id, v_existing_sender, v_existing_group
    FROM chat_messages WHERE client_id = p_client_id;
    IF v_existing_sender <> v_actor OR v_existing_group <> p_group_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    RETURN public.ledger_chat_message_json(v_existing_id);
  END IF;

  v_result := public.ledger_chat_message_json(v_message_id);

  PERFORM realtime.send(v_result, 'message', 'chat:' || p_group_id::text, true);

  RETURN v_result;
END;
$$;

CREATE FUNCTION public.mark_read(p_group_id uuid)
RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM assert_member(p_group_id, v_actor);

  INSERT INTO conversation_reads (user_id, group_id, last_read_at)
  VALUES (v_actor, p_group_id, now())
  ON CONFLICT (user_id, group_id)
  DO UPDATE SET last_read_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.send_message(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_read(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_read(uuid) TO authenticated;

-- ---- 08_rpc_guest.sql ----
CREATE FUNCTION public.issue_guest_claim_token(p_guest_id uuid)
RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_guest RECORD;
  v_bytes bytea;
  v_token text;
  v_digest bytea;
  v_generation integer;
BEGIN
  v_actor := current_user_id();

  IF p_guest_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_not_found';
  END IF;

  SELECT g.id, g.claimed_by, e.group_id
  INTO v_guest
  FROM guests g
  JOIN expenses e ON e.id = g.expense_id
  WHERE g.id = p_guest_id
  FOR UPDATE OF g;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_not_found';
  END IF;

  PERFORM assert_member(v_guest.group_id, v_actor);

  IF v_guest.claimed_by IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_already_claimed';
  END IF;
  SELECT generation INTO v_generation
  FROM guest_credentials.claim_tokens
  WHERE guest_id = p_guest_id;

  IF v_generation >= 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_link_replacement_limit';
  END IF;

  v_bytes := extensions.gen_random_bytes(32);
  v_token := 'gst1_' || rtrim(translate(encode(v_bytes, 'base64'), '+/', '-_'), '=');
  v_digest := extensions.digest(convert_to(v_token, 'utf8'), 'sha256');

  INSERT INTO guest_credentials.claim_tokens AS ct (guest_id, token_digest, generation, created_at)
  VALUES (p_guest_id, v_digest, 1, now())
  ON CONFLICT (guest_id)
  DO UPDATE SET token_digest = EXCLUDED.token_digest,
                generation = ct.generation + 1,
                created_at = now();

  RETURN v_token;
END;
$$;

CREATE FUNCTION public.resolve_guest_claim_token(p_token text)
RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_digest bytea;
  v_rec RECORD;
  v_status text;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN jsonb_build_object(
      'guestId', NULL,
      'displayName', NULL,
      'expenseTitle', NULL,
      'groupName', NULL,
      'shareCents', NULL,
      'status', 'not_found'
    );
  END IF;

  v_digest := extensions.digest(convert_to(p_token, 'utf8'), 'sha256');

  SELECT
    g.id AS guest_id,
    g.display_name,
    g.claimed_by,
    ev.title AS expense_title,
    grp.name AS group_name,
    COALESCE(ep.share_cents, 0) AS share_cents
  INTO v_rec
  FROM guest_credentials.claim_tokens ct
  JOIN guests g ON g.id = ct.guest_id
  JOIN expenses e ON e.id = g.expense_id
  JOIN expense_versions ev ON ev.expense_id = e.id AND ev.version_no = e.current_version_no
  JOIN groups grp ON grp.id = e.group_id
  LEFT JOIN expense_participants ep ON ep.expense_id = e.id AND ep.guest_id = g.id
  WHERE ct.token_digest = v_digest;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'guestId', NULL,
      'displayName', NULL,
      'expenseTitle', NULL,
      'groupName', NULL,
      'shareCents', NULL,
      'status', 'not_found'
    );
  END IF;

  IF v_rec.claimed_by IS NOT NULL THEN
    v_status := 'already_claimed';
  ELSE
    v_status := 'ready';
  END IF;

  RETURN jsonb_build_object(
    'guestId', v_rec.guest_id,
    'displayName', v_rec.display_name,
    'expenseTitle', v_rec.expense_title,
    'groupName', v_rec.group_name,
    'shareCents', v_rec.share_cents,
    'status', v_status
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'guestId', NULL,
    'displayName', NULL,
    'expenseTitle', NULL,
    'groupName', NULL,
    'shareCents', NULL,
    'status', 'not_found'
  );
END;
$$;

CREATE FUNCTION public.claim_guest(p_token text)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_digest bytea;
  v_rec RECORD;
  v_payload jsonb;
  v_new_participants jsonb;
  v_new_payload jsonb;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  v_digest := extensions.digest(convert_to(p_token, 'utf8'), 'sha256');

  SELECT ct.guest_id, g.expense_id, g.display_name, g.claimed_by, e.group_id, e.status AS expense_status, e.current_version_no
  INTO v_rec
  FROM guest_credentials.claim_tokens ct
  JOIN guests g ON g.id = ct.guest_id
  JOIN expenses e ON e.id = g.expense_id
  WHERE ct.token_digest = v_digest;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  PERFORM lock_group(v_rec.group_id);

  SELECT g.id, g.expense_id, g.display_name, g.claimed_by, e.group_id, e.status AS expense_status, e.current_version_no
  INTO v_rec
  FROM guests g
  JOIN expenses e ON e.id = g.expense_id
  WHERE g.id = v_rec.guest_id
  FOR UPDATE OF g, e;

  IF v_rec.claimed_by IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_claimed';
  END IF;

  IF v_rec.expense_status = 'deleted' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
  END IF;

  -- A guest dropped by a later edit keeps its row but no participant slot;
  -- redeeming that orphaned token would hand group membership to a stranger.
  IF NOT EXISTS (
    SELECT 1 FROM expense_participants
    WHERE expense_id = v_rec.expense_id AND guest_id = v_rec.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF EXISTS (
    SELECT 1 FROM expense_participants
    WHERE expense_id = v_rec.expense_id AND user_id = v_actor AND kind = 'user'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_participant';
  END IF;

  UPDATE guests
  SET claimed_by = v_actor,
      claimed_at = now()
  WHERE id = v_rec.id;

  UPDATE expense_participants
  SET kind = 'user',
      user_id = v_actor,
      guest_id = NULL
  WHERE expense_id = v_rec.expense_id AND guest_id = v_rec.id;

  SELECT payload INTO v_payload
  FROM expense_versions
  WHERE expense_id = v_rec.expense_id AND version_no = v_rec.current_version_no;

  SELECT jsonb_agg(
    CASE
      WHEN p->>'kind' = 'guest' AND p->>'guestId' = v_rec.id::text
      THEN jsonb_build_object('kind', 'user', 'userId', v_actor)
      ELSE p
    END
    ORDER BY ord
  )
  INTO v_new_participants
  FROM jsonb_array_elements(v_payload->'participants') WITH ORDINALITY AS t(p, ord);

  v_new_payload := jsonb_set(v_payload, '{participants}', v_new_participants);

  UPDATE expense_versions
  SET payload = v_new_payload
  WHERE expense_id = v_rec.expense_id AND version_no = v_rec.current_version_no;

  INSERT INTO group_members (group_id, user_id, status, accepted_at)
  VALUES (v_rec.group_id, v_actor, 'accepted', now())
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET status = 'accepted', accepted_at = COALESCE(group_members.accepted_at, now());

  v_ledger_version := recompute_group_balances(v_rec.group_id);

  v_event_id := emit_event(
    p_group_id => v_rec.group_id,
    p_kind => 'guest_claimed',
    p_actor => v_actor,
    p_expense_id => v_rec.expense_id,
    p_settlement_id => NULL,
    p_subject_user_id => v_actor,
    p_payload => jsonb_build_object('displayName', v_rec.display_name)
  );

  PERFORM broadcast_group(v_rec.group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', v_rec.expense_id,
    'groupId', v_rec.group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_guest_claim_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.issue_guest_claim_token(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_guest_claim_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_guest_claim_token(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.claim_guest(text) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_guest(text) TO authenticated;

-- ---- 09_realtime.sql ----
-- Topic ids are matched as uuids: a malformed topic yields a clean denial
-- instead of an "invalid input syntax for type uuid" during policy evaluation.
CREATE FUNCTION public.current_user_is_member(p_group_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = auth.uid() AND status = 'accepted'
  )
$$;

REVOKE ALL ON FUNCTION public.current_user_is_member(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.current_user_is_member(uuid) TO authenticated;

DROP POLICY IF EXISTS group_broadcast_authz ON realtime.messages;
CREATE POLICY group_broadcast_authz ON realtime.messages FOR SELECT TO authenticated
USING (
  CASE
    WHEN realtime.topic() LIKE 'user:%' THEN
      substring(realtime.topic() FROM '^user:([0-9a-fA-F-]{36})$')::uuid = auth.uid()
    ELSE
      public.current_user_is_member(
        substring(realtime.topic() FROM '^(?:group|chat):([0-9a-fA-F-]{36})$')::uuid
      )
  END
);

-- ---- 11_vendor_charges.sql ----
CREATE TABLE public.vendor_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999),
  description text CHECK (description IS NULL OR length(description) <= 160),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received')),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

ALTER TABLE public.vendor_charges ENABLE ROW LEVEL SECURITY;

CREATE INDEX vendor_charges_user_idx ON public.vendor_charges (user_id, created_at DESC);

CREATE FUNCTION public.record_vendor_charge(p_amount_cents integer, p_description text DEFAULT NULL)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_row vendor_charges;
BEGIN
  v_actor := current_user_id();

  IF p_amount_cents IS NULL OR p_amount_cents < 1 OR p_amount_cents > 99999999 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_description IS NOT NULL AND length(p_description) > 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  INSERT INTO vendor_charges (user_id, amount_cents, description, status, created_at)
  VALUES (v_actor, p_amount_cents, p_description, 'pending', now())
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'userId', v_row.user_id,
    'amountCents', v_row.amount_cents,
    'description', v_row.description,
    'status', v_row.status,
    'createdAt', to_jsonb(v_row.created_at),
    'confirmedAt', to_jsonb(v_row.confirmed_at)
  );
END;
$$;

CREATE FUNCTION public.confirm_vendor_charge(p_charge_id uuid)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_row vendor_charges;
BEGIN
  v_actor := current_user_id();

  IF p_charge_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT * INTO v_row
  FROM vendor_charges
  WHERE id = p_charge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'charge_not_found';
  END IF;

  IF v_row.user_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_owner';
  END IF;

  IF v_row.status = 'received' THEN
    RETURN jsonb_build_object(
      'id', v_row.id,
      'userId', v_row.user_id,
      'amountCents', v_row.amount_cents,
      'description', v_row.description,
      'status', v_row.status,
      'createdAt', to_jsonb(v_row.created_at),
      'confirmedAt', to_jsonb(v_row.confirmed_at)
    );
  END IF;

  UPDATE vendor_charges
  SET status = 'received', confirmed_at = now()
  WHERE id = p_charge_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'userId', v_row.user_id,
    'amountCents', v_row.amount_cents,
    'description', v_row.description,
    'status', v_row.status,
    'createdAt', to_jsonb(v_row.created_at),
    'confirmedAt', to_jsonb(v_row.confirmed_at)
  );
END;
$$;

CREATE FUNCTION public.get_vendor_charges(p_limit integer DEFAULT 50)
RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_result jsonb;
BEGIN
  v_actor := current_user_id();

  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 50;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', vc.id,
      'userId', vc.user_id,
      'amountCents', vc.amount_cents,
      'description', vc.description,
      'status', vc.status,
      'createdAt', to_jsonb(vc.created_at),
      'confirmedAt', to_jsonb(vc.confirmed_at)
    )
  ), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT *
    FROM vendor_charges
    WHERE user_id = v_actor
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit
  ) vc;

  RETURN v_result;
END;
$$;

REVOKE ALL ON TABLE public.vendor_charges FROM public, anon, authenticated;

REVOKE ALL ON FUNCTION public.record_vendor_charge(integer, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_vendor_charge(integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.confirm_vendor_charge(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.confirm_vendor_charge(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_vendor_charges(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_vendor_charges(integer) TO authenticated;

-- ---- 12_rate_limit.sql ----
CREATE TABLE public.rate_limit_counters (
  bucket text NOT NULL,
  subject text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (bucket, subject),
  CONSTRAINT rate_limit_counters_bucket_bounds
    CHECK (btrim(bucket) <> '' AND octet_length(bucket) BETWEEN 1 AND 64),
  CONSTRAINT rate_limit_counters_subject_bounds
    CHECK (btrim(subject) <> '' AND octet_length(subject) BETWEEN 1 AND 512),
  CONSTRAINT rate_limit_counters_count_bounds
    CHECK (count BETWEEN 1 AND 1001)
);
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.increment_rate_limit(
  p_bucket          text,
  p_subject         text,
  p_limit           integer,
  p_window_seconds  integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now   timestamptz := now();
  v_count integer;
BEGIN
  -- Validate before any cleanup or counter mutation. SQL is the trust
  -- boundary: the TypeScript wrapper performs the same checks first, but
  -- this function must not trust any caller.
  IF p_bucket IS NULL OR btrim(p_bucket) = '' OR octet_length(p_bucket) > 64
     OR p_subject IS NULL OR btrim(p_subject) = '' OR octet_length(p_subject) > 512
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1000
     OR p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400
  THEN
    RAISE EXCEPTION 'invalid_rate_limit_arguments' USING ERRCODE = '22023';
  END IF;

  -- Probabilistic cleanup: ~0.1% of calls purge stale rows (> 24 hours old).
  -- Runs only after argument validation, through the trusted function owner.
  IF random() < 0.001 THEN
    DELETE FROM public.rate_limit_counters
     WHERE window_start < v_now - INTERVAL '24 hours';
  END IF;

  -- One atomic UPSERT: no preliminary SELECT, so there is no absent-row gap
  -- for a second cold-start transaction to race into. The primary key
  -- constraint itself serializes concurrent inserts for the same key.
  INSERT INTO public.rate_limit_counters AS counters (bucket, subject, window_start, count)
  VALUES (p_bucket, p_subject, v_now, 1)
  ON CONFLICT (bucket, subject) DO UPDATE
    SET window_start =
          CASE
            WHEN counters.window_start <= v_now - (p_window_seconds * interval '1 second')
              THEN v_now
            ELSE counters.window_start
          END,
        count =
          CASE
            WHEN counters.window_start <= v_now - (p_window_seconds * interval '1 second')
              THEN 1
            WHEN counters.count < 1 OR counters.count >= p_limit
              THEN p_limit + 1
            ELSE counters.count + 1
          END
  RETURNING counters.count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_rate_limit_counters()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.rate_limit_counters
   WHERE window_start < now() - INTERVAL '24 hours';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_rate_limit(text, text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(text, text, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_expired_rate_limit_counters()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rate_limit_counters()
  TO service_role;

REVOKE ALL ON TABLE public.rate_limit_counters
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rate_limit_counters
  TO service_role;

-- ---- 13_auth_trigger.sql ----
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  generated_handle TEXT;
  email_local TEXT;
  user_name TEXT;
  suffix INT := 0;
BEGIN
  email_local := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9_]', '', 'g'));

  IF char_length(email_local) < 3 THEN
    email_local := email_local || 'user';
  END IF;
  IF char_length(email_local) > 30 THEN
    email_local := left(email_local, 30);
  END IF;

  generated_handle := email_local;

  WHILE EXISTS (SELECT 1 FROM public.users WHERE handle = generated_handle) LOOP
    suffix := suffix + 1;
    generated_handle := left(email_local, 30 - char_length(suffix::TEXT)) || suffix::TEXT;
  END LOOP;

  user_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(split_part(NEW.email, '@', 1), ''),
    'user'
  );
  user_name := left(user_name, 80);

  INSERT INTO public.users (id, email, handle, name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    generated_handle,
    user_name,
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_users_updated_at ON public.users;
CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM public, anon, authenticated;

-- ---- 14_rpc_nudge.sql ----
CREATE FUNCTION public.send_nudge(
  p_group_id uuid,
  p_user_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_amount_cents bigint;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_user_id = v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  IF NOT is_member(p_group_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'counterparty_not_member';
  END IF;

  SELECT amount_cents INTO v_amount_cents
  FROM group_transfers(p_group_id)
  WHERE from_id = p_user_id AND to_id = v_actor;

  IF v_amount_cents IS NULL OR v_amount_cents <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'no_debt';
  END IF;

  IF EXISTS (
    SELECT 1 FROM group_events
    WHERE group_id = p_group_id
      AND kind = 'nudge'
      AND actor_id = v_actor
      AND subject_user_id = p_user_id
      AND created_at > now() - interval '24 hours'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'nudge_cooldown';
  END IF;

  SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;

  v_event_id := emit_event(
    p_group_id,
    'nudge',
    v_actor,
    p_subject_user_id => p_user_id,
    p_payload => jsonb_build_object('amountCents', v_amount_cents)
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_nudge(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.send_nudge(uuid, uuid) TO authenticated;
