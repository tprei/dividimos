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
  deleted_by uuid REFERENCES public.users(id),
  chave_acesso text CHECK (chave_acesso IS NULL OR chave_acesso ~ '^[0-9]{44}$')
);
CREATE INDEX expenses_group_idx ON public.expenses (group_id, occurred_on DESC, created_at DESC);
-- Cursor order for history paging; occurred_on above still serves its own readers.
CREATE INDEX expenses_group_created_idx ON public.expenses (group_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX expenses_creator_chave_active_idx
  ON public.expenses (creator_id, chave_acesso)
  WHERE status = 'active' AND chave_acesso IS NOT NULL;

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
  endpoint_digest bytea NOT NULL,
  subscription_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint_digest)
);

CREATE TABLE guest_credentials.claim_tokens (
  guest_id uuid PRIMARY KEY REFERENCES public.guests(id) ON DELETE CASCADE,
  token_digest bytea NOT NULL UNIQUE,
  generation integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
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
