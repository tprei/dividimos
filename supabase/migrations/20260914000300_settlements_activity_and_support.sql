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
  PRIMARY KEY (group_id, kind, participant_id),
  CONSTRAINT group_balances_nonzero CHECK (net_cents <> 0)
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
CREATE INDEX chat_messages_group_idx ON public.chat_messages (group_id, created_at DESC, id DESC);

CREATE TABLE public.conversation_reads (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  last_read_message_id uuid REFERENCES public.chat_messages(id),
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('web', 'fcm')),
  -- One physical endpoint has exactly one owner: a device registered to a
  -- second account stops delivering to the first.
  endpoint_digest bytea NOT NULL UNIQUE,
  subscription_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guest_credentials.claim_tokens (
  guest_id uuid PRIMARY KEY REFERENCES public.guests(id) ON DELETE CASCADE,
  token_digest bytea NOT NULL UNIQUE,
  generation integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON TABLE guest_credentials.claim_tokens TO service_role;


ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_invite_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_member_exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_credentials.claim_tokens ENABLE ROW LEVEL SECURITY;
