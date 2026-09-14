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
  financial_history_shared_at timestamptz,
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

CREATE TABLE public.group_member_exclusions (
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  excluded_by uuid NOT NULL REFERENCES public.users(id),
  excluded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

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
