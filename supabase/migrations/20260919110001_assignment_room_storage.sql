SET lock_timeout = '5s';

CREATE TABLE public.assignment_rooms (
  id uuid PRIMARY KEY,
  host_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'finalized', 'cancelled')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  group_target jsonb NOT NULL CHECK (jsonb_typeof(group_target) = 'object'),
  header jsonb NOT NULL CHECK (jsonb_typeof(header) = 'object'),
  expense_id uuid UNIQUE REFERENCES public.expenses(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT assignment_rooms_closed_at_valid CHECK (
    (status = 'open' AND closed_at IS NULL) OR
    (status IN ('closed', 'finalized', 'cancelled'))
  )
);

CREATE INDEX assignment_rooms_host_created_idx
  ON public.assignment_rooms (host_user_id, created_at DESC, id DESC);

CREATE TABLE public.assignment_room_items (
  room_id uuid NOT NULL REFERENCES public.assignment_rooms(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0 AND ordinal < 100),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  description text NOT NULL CHECK (
    length(trim(description)) BETWEEN 1 AND 240
  ),
  quantity_milliunits integer NOT NULL CHECK (
    quantity_milliunits BETWEEN 1 AND 999999999
  ),
  unit_price_cents integer NOT NULL CHECK (
    unit_price_cents BETWEEN 0 AND 99999999
  ),
  total_price_cents integer NOT NULL CHECK (
    total_price_cents BETWEEN 0 AND 99999999
  ),
  PRIMARY KEY (room_id, id),
  UNIQUE (room_id, ordinal),
  CONSTRAINT assignment_room_items_line_total_exact CHECK (
    floor((quantity_milliunits::numeric * unit_price_cents::numeric + 500) / 1000)
      = total_price_cents::numeric
  )
);

CREATE TABLE public.assignment_room_participants (
  room_id uuid NOT NULL REFERENCES public.assignment_rooms(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  display_name text NOT NULL CHECK (
    length(trim(display_name)) BETWEEN 1 AND 80
  ),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  removed_at timestamptz,
  expense_participant_index integer CHECK (
    expense_participant_index IS NULL OR
    expense_participant_index BETWEEN 0 AND 49
  ),
  PRIMARY KEY (room_id, id),
  UNIQUE (room_id, ordinal)
);

CREATE UNIQUE INDEX assignment_room_participants_active_user_idx
  ON public.assignment_room_participants (room_id, user_id)
  WHERE user_id IS NOT NULL AND removed_at IS NULL;
CREATE INDEX assignment_room_participants_user_idx
  ON public.assignment_room_participants (user_id)
  WHERE user_id IS NOT NULL AND removed_at IS NULL;

CREATE TABLE public.assignment_room_claims (
  room_id uuid NOT NULL,
  item_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  ticks bigint NOT NULL CHECK (ticks BETWEEN 1 AND 119999999880),
  PRIMARY KEY (room_id, item_id, participant_id),
  FOREIGN KEY (room_id, item_id)
    REFERENCES public.assignment_room_items(room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, participant_id)
    REFERENCES public.assignment_room_participants(room_id, id) ON DELETE CASCADE
);
CREATE INDEX assignment_room_claims_participant_idx
  ON public.assignment_room_claims (room_id, participant_id);

CREATE TABLE guest_credentials.assignment_room_access (
  room_id uuid PRIMARY KEY REFERENCES public.assignment_rooms(id) ON DELETE CASCADE,
  join_digest bytea NOT NULL CHECK (octet_length(join_digest) = 32),
  join_expires_at timestamptz NOT NULL,
  broadcast_topic text NOT NULL UNIQUE CHECK (
    broadcast_topic ~ '^assignment-room:[A-Za-z0-9_-]{43}$'
  )
);

CREATE TABLE guest_credentials.assignment_room_members (
  room_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (room_id, participant_id),
  FOREIGN KEY (room_id, participant_id)
    REFERENCES public.assignment_room_participants(room_id, id) ON DELETE CASCADE
);
CREATE INDEX assignment_room_members_expiry_idx
  ON guest_credentials.assignment_room_members (expires_at)
  WHERE revoked_at IS NULL;

CREATE FUNCTION public.enforce_assignment_room_immutability() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
BEGIN
  IF TG_TABLE_NAME = 'assignment_rooms' AND (
    v_new->'id' IS DISTINCT FROM v_old->'id' OR
    v_new->'host_user_id' IS DISTINCT FROM v_old->'host_user_id' OR
    v_new->'group_target' IS DISTINCT FROM v_old->'group_target' OR
    v_new->'header' IS DISTINCT FROM v_old->'header' OR
    v_new->'created_at' IS DISTINCT FROM v_old->'created_at'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
  ELSIF TG_TABLE_NAME = 'assignment_room_items' AND (
    v_new->'room_id' IS DISTINCT FROM v_old->'room_id' OR
    v_new->'id' IS DISTINCT FROM v_old->'id' OR
    v_new->'ordinal' IS DISTINCT FROM v_old->'ordinal' OR
    v_new->'description' IS DISTINCT FROM v_old->'description' OR
    v_new->'quantity_milliunits' IS DISTINCT FROM v_old->'quantity_milliunits' OR
    v_new->'unit_price_cents' IS DISTINCT FROM v_old->'unit_price_cents' OR
    v_new->'total_price_cents' IS DISTINCT FROM v_old->'total_price_cents'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
  ELSIF TG_TABLE_NAME = 'assignment_room_participants' AND (
    v_new->'room_id' IS DISTINCT FROM v_old->'room_id' OR
    v_new->'id' IS DISTINCT FROM v_old->'id' OR
    v_new->'ordinal' IS DISTINCT FROM v_old->'ordinal' OR
    v_new->'display_name' IS DISTINCT FROM v_old->'display_name' OR
    (pg_trigger_depth() = 1 AND v_new->'user_id' IS DISTINCT FROM v_old->'user_id') OR
    ((v_old->>'ordinal')::integer = 0 AND v_new->'removed_at' IS DISTINCT FROM 'null'::jsonb)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assignment_rooms_immutable
  BEFORE UPDATE ON public.assignment_rooms
  FOR EACH ROW EXECUTE FUNCTION public.enforce_assignment_room_immutability();
CREATE TRIGGER assignment_room_items_immutable
  BEFORE UPDATE ON public.assignment_room_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_assignment_room_immutability();
CREATE TRIGGER assignment_room_participants_immutable
  BEFORE UPDATE ON public.assignment_room_participants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_assignment_room_immutability();

REVOKE ALL ON FUNCTION public.enforce_assignment_room_immutability()
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.assignment_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_room_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_room_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_room_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_credentials.assignment_room_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_credentials.assignment_room_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.assignment_rooms FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.assignment_room_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.assignment_room_participants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.assignment_room_claims FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE guest_credentials.assignment_room_access FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE guest_credentials.assignment_room_members FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assignment_rooms TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assignment_room_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assignment_room_participants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assignment_room_claims TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE guest_credentials.assignment_room_access TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE guest_credentials.assignment_room_members TO service_role;
