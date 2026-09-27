SET lock_timeout = '5s';

ALTER TABLE public.users
  ADD COLUMN ai_consent_version integer,
  ADD COLUMN ai_consent_granted_at timestamptz;

ALTER TABLE public.users
  ADD CONSTRAINT users_ai_consent_pair_check CHECK (
    (ai_consent_version IS NULL AND ai_consent_granted_at IS NULL)
    OR (
      ai_consent_version IS NOT NULL
      AND ai_consent_version > 0
      AND ai_consent_granted_at IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE public.users
  VALIDATE CONSTRAINT users_ai_consent_pair_check;
