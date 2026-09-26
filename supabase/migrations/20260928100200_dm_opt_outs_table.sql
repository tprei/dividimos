-- declining a dm deletes the group, so this table records pairs that opted out of dm invites
SET lock_timeout = '5s';

CREATE TABLE public.dm_opt_outs (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  other_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, other_user_id),
  CHECK (user_id <> other_user_id)
);
ALTER TABLE public.dm_opt_outs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dm_opt_outs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dm_opt_outs TO service_role;
